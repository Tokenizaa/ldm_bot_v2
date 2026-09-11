import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { Publication, FacebookSessionStatus } from '../types.js';
import { logger } from './LoggerService.js';
import { storage } from './StorageService.js';

export interface ScheduledPublicationInput {
  groupUrl: string;
  content: string;
  affiliateUrl: string;
  scheduledDate: string;
  scheduledTime: string;
}

export interface ScheduledPublicationResult {
  success: boolean;
  postUrl?: string;
  scheduledAt?: string;
  error?: string;
}

/** Facebook automation uses only the dedicated persistent browser profile. */
export class FacebookService {
  private readonly profileDir: string;
  private sessionStatus: FacebookSessionStatus;
  private browserContext: BrowserContext | null = null;
  private contextPromise: Promise<BrowserContext> | null = null;
  private connectPromise: Promise<{ success: boolean; message: string; connectedUser?: string }> | null = null;
  private automationQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.profileDir = path.join(process.cwd(), 'data', 'browser-profiles', 'facebook');
    if (!fs.existsSync(this.profileDir)) {
      throw new Error('Perfil persistente do Facebook não existe: data/browser-profiles/facebook. NÃO recrie nem apague o perfil automaticamente.');
    }
    this.sessionStatus = {
      connected: false,
      status: 'disconnected',
      profile_dir: 'data/browser-profiles/facebook',
      details: 'Perfil persistente do Facebook configurado.'
    };
  }

  getStatus(): FacebookSessionStatus {
    return { ...this.sessionStatus };
  }

  /**
   * Reconstruct application connection state from the persistent browser profile.
   * This does not navigate, log in, log out, or destroy the browser context.
   */
  async refreshPersistentSessionStatus(): Promise<FacebookSessionStatus> {
    try {
      const context = await this.getOrCreateBrowserContext();
      const cookies = await context.cookies('https://www.facebook.com');
      const authenticated =
        cookies.some(cookie => cookie.name === 'c_user' && !!cookie.value) &&
        cookies.some(cookie => cookie.name === 'xs' && !!cookie.value);

      if (authenticated) {
        this.sessionStatus = {
          ...this.sessionStatus,
          connected: true,
          status: 'connected',
          connected_user: this.sessionStatus.connected_user || 'Conta Facebook autenticada',
          details: 'Sessão recuperada do perfil persistente.'
        };
      } else if (this.sessionStatus.status === 'connected') {
        this.sessionStatus = {
          ...this.sessionStatus,
          connected: false,
          status: 'requires_reauth',
          details: 'O perfil persistente não possui cookies de sessão válidos.'
        };
      }
    } catch (error: any) {
      logger.facebook(`Falha ao recuperar sessão persistente: ${error.message}`, 'warn');
    }
    return this.getStatus();
  }

  private async getOrCreateBrowserContext(): Promise<BrowserContext> {
    if (this.browserContext) return this.browserContext;
    if (this.contextPromise) return this.contextPromise;

    this.contextPromise = chromium.launchPersistentContext(this.profileDir, {
      channel: process.env.FACEBOOK_BROWSER_CHANNEL || 'chrome',
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }).then(context => {
      this.browserContext = context;
      context.on('close', () => {
        this.browserContext = null;
        this.contextPromise = null;
        logger.facebook('Contexto persistente do Facebook encerrado.', 'warn');
      });
      return context;
    }).catch(error => {
      this.contextPromise = null;
      throw error;
    });

    return this.contextPromise;
  }

  private async getWorkingPage(context: BrowserContext): Promise<Page> {
    return context.pages()[0] || await context.newPage();
  }

  private async checkPageLoginStatus(page: Page): Promise<boolean> {
    try {
      if (/\/login|\/checkpoint|\/recover/i.test(page.url())) return false;

      const cookies = await page.context().cookies('https://www.facebook.com');
      const hasSessionCookies =
        cookies.some(cookie => cookie.name === 'c_user' && !!cookie.value) &&
        cookies.some(cookie => cookie.name === 'xs' && !!cookie.value);

      if (hasSessionCookies) return true;

      const loginForm = await page.locator(
        'input[name="email"], input[name="pass"], form[action*="login"]'
      ).count();
      if (loginForm > 0) return false;

      return await page.locator(
        '[role="feed"], [aria-label*="Criar publicação"], [aria-label*="Escreva algo"], [aria-label*="Sua conta"], [href*="/profile.php"], [href*="/me/"]'
      ).count() > 0;
    } catch {
      return false;
    }
  }

  private async withAutomationLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.automationQueue;
    let release!: () => void;
    this.automationQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  }

  private async waitForManualAuthentication(page: Page): Promise<boolean> {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      if (await this.checkPageLoginStatus(page)) return true;
      await page.waitForTimeout(3000);
    }
    return false;
  }

  async ensureFacebookSession(): Promise<boolean> {
    try {
      const context = await this.getOrCreateBrowserContext();
      const page = await this.getWorkingPage(context);
      const cookies = await context.cookies('https://www.facebook.com');
      const authenticated = cookies.some(cookie => cookie.name === 'c_user' && !!cookie.value)
        && cookies.some(cookie => cookie.name === 'xs' && !!cookie.value);

      // Session validation is cookie/DOM based. Do not navigate to the group here:
      // group navigation is an interaction step and can legitimately timeout/abort.
      if (!authenticated && !(await this.checkPageLoginStatus(page))) {
        this.sessionStatus = {
          ...this.sessionStatus,
          connected: false,
          status: 'requires_reauth',
          details: 'Facebook solicita autenticação manual.'
        };
        return false;
      }

      this.sessionStatus = {
        ...this.sessionStatus,
        connected: true,
        status: 'connected',
        connected_user: 'Conta Facebook autenticada',
        last_authenticated_at: new Date().toISOString(),
        details: 'Sessão ativa no perfil persistente.'
      };
      return true;
    } catch (error: any) {
      this.sessionStatus = {
        ...this.sessionStatus,
        connected: false,
        status: 'requires_reauth',
        details: error.message
      };
      logger.facebook(`Falha ao validar sessão: ${error.message}`, 'error');
      return false;
    }
  }

  async connectSession(): Promise<{ success: boolean; message: string; connectedUser?: string }> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectSessionInternal();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connectSessionInternal(): Promise<{ success: boolean; message: string; connectedUser?: string }> {
    try {
      const context = await this.getOrCreateBrowserContext();
      const page = await this.getWorkingPage(context);
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (await this.checkPageLoginStatus(page)) {
        this.sessionStatus = {
          ...this.sessionStatus,
          connected: true,
          status: 'connected',
          connected_user: 'Conta Facebook autenticada',
          last_authenticated_at: new Date().toISOString()
        };
        return {
          success: true,
          message: 'Facebook já está autenticado no perfil persistente.',
          connectedUser: this.sessionStatus.connected_user
        };
      }

      this.sessionStatus = {
        ...this.sessionStatus,
        connected: false,
        status: 'connecting',
        details: 'Aguardando login e 2FA manuais.'
      };

      if (!(await this.waitForManualAuthentication(page))) {
        return { success: false, message: 'Tempo limite aguardando autenticação manual.' };
      }

      this.sessionStatus = {
        ...this.sessionStatus,
        connected: true,
        status: 'connected',
        connected_user: 'Conta Facebook autenticada',
        last_authenticated_at: new Date().toISOString(),
        details: 'Login e 2FA concluídos no perfil persistente.'
      };
      return {
        success: true,
        message: 'Login manual concluído. Perfil persistente mantido aberto.',
        connectedUser: this.sessionStatus.connected_user
      };
    } catch (error: any) {
      logger.facebook(`Erro no navegador Facebook: ${error.message}`, 'error');
      return { success: false, message: error.message };
    }
  }

  async verifySessionWithBrowser(): Promise<boolean> {
    return this.ensureFacebookSession();
  }

  async verifyGroupAccess(groupUrl: string): Promise<{ accessible: boolean; message: string }> {
    if (!groupUrl || !groupUrl.includes('/groups/')) {
      return { accessible: false, message: 'URL de grupo inválida.' };
    }
    if (!(await this.ensureFacebookSession())) {
      return { accessible: false, message: 'Sessão do Facebook não autenticada.' };
    }

    try {
      const page = await this.getWorkingPage(await this.getOrCreateBrowserContext());
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);

      const html = await page.content();
      const blocked = /conteúdo não está disponível|página não encontrada|link pode estar corrompido/i.test(html);
      const composer = await page.locator(
        '[role="button"]:has-text("Escreva algo"), [role="button"]:has-text("No que você está pensando"), [aria-label*="Criar uma publicação" i], [aria-label*="Escreva algo" i]'
      ).filter({ hasNotText: /Comente como/i }).count();
      const accessible = !blocked && /\/groups\//i.test(page.url()) && composer > 0;

      this.sessionStatus.configured_group_url = groupUrl;
      this.sessionStatus.group_accessible = accessible;
      return accessible
        ? { accessible: true, message: 'Grupo acessível e composer detectado.' }
        : { accessible: false, message: 'Grupo não pôde ser validado para publicação.' };
    } catch (error: any) {
      return { accessible: false, message: error.message };
    }
  }

  async getAuthenticatedPage(): Promise<Page> {
    const context = await this.getOrCreateBrowserContext();
    const page = await this.getWorkingPage(context);
    if (!(await this.checkPageLoginStatus(page))) throw new Error('Facebook requer autenticação.');
    return page;
  }

  async isGroupComposerAvailable(page: Page): Promise<boolean> {
    return await page.locator('[role="button"]:has-text("Escreva algo"), [aria-label*="Criar uma publicação"], [aria-label*="Escreva algo"]').count() > 0;
  }

  private async openComposer(page: Page): Promise<boolean> {
    const triggers = [
      page.getByRole('button', { name: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first(),
      page.locator('[role="button"][aria-label*="Criar uma publicação" i]').first(),
      page.locator('[role="button"][aria-label*="Escreva algo" i]').first(),
      page.locator('[role="button"]').filter({ hasText: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first(),
      page.locator('div[role="button"]').filter({ hasText: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first(),
      page.getByText(/Escreva algo|No que você está pensando|Criar uma publicação/i, { exact: false }).first()
    ];
    for (const trigger of triggers) {
      if (!(await trigger.count().catch(() => 0))) continue;
      if (!(await trigger.isVisible().catch(() => false))) continue;
      await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
      try {
        await trigger.click({ timeout: 10000 });
      } catch {
        const box = await trigger.boundingBox().catch(() => null);
        if (!box) continue;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await page.waitForTimeout(1200);
      const textbox = page.locator(
        '[role="dialog"] [contenteditable="true"][role="textbox"], ' +
        '[role="dialog"] [contenteditable="true"], ' +
        '[role="dialog"] textarea, ' +
        '[role="dialog"] input[role="textbox"]'
      ).first();
      if (await textbox.count().catch(() => 0) && await textbox.isVisible().catch(() => false)) return true;
    }
    return false;
  }

  private async fillCopyAndBuildLinkPreview(page: Page, copy: string, affiliateUrl: string): Promise<boolean> {
    const textbox = page.locator(
      '[role="dialog"] [role="textbox"], [role="dialog"] [contenteditable="true"], [role="textbox"][contenteditable="true"]'
    ).first();
    if (!(await textbox.count())) return false;

    await textbox.click({ timeout: 10000 });
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.insertText(copy.trim() + '\n' + affiliateUrl);
    await page.waitForTimeout(4500);

    const textBefore = await textbox.textContent().catch(() => '');
    if (!textBefore.includes(affiliateUrl)) return false;

    await textbox.click({ timeout: 10000 });
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace').catch(() => undefined);
    await page.waitForTimeout(800);

    const textAfter = await textbox.textContent().catch(() => '');
    return !textAfter.includes(affiliateUrl);
  }

  private async fillComposer(page: Page, content: string): Promise<boolean> {
    const textbox = page.locator(
      '[role="dialog"] [role="textbox"], [role="dialog"] [contenteditable="true"], [role="textbox"][contenteditable="true"]'
    ).first();
    if (!(await textbox.count())) return false;
    await textbox.fill(content);
    return true;
  }

  private async openScheduling(page: Page): Promise<boolean> {
    const dialog = page.locator('[role="dialog"]').last();
    const more = dialog.locator(
      'button[aria-label="Mais opções de post"], button[aria-label*="Mais opções"], button[aria-label*="More options"]'
    ).first();
    if (!(await more.count())) return false;

    await more.click({ timeout: 10000 });
    const option = page.getByRole('menuitem', { name: /Programar post|Agendar post/i }).first();
    if (!(await option.count())) return false;
    await option.click({ timeout: 10000 });

    return await page.getByRole('button', { name: 'Abrir seletor de data' }).count() > 0
      && await page.getByRole('button', { name: 'Abrir seletor de hora' }).count() > 0;
  }

  private async selectFacebookDate(page: Page, date: string): Promise<boolean> {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return false;

    const picker = page.getByRole('button', { name: 'Abrir seletor de data' }).last();
    if (!(await picker.count())) return false;
    await picker.click({ timeout: 10000 });

    const target = new Date(year, month - 1, day);
    const normalizedTarget = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(target).toLowerCase();

    const cells = await page.getByRole('gridcell').all();
    for (const cell of cells) {
      const name = ((await cell.getAttribute('aria-label')) || (await cell.innerText().catch(() => ''))).trim().toLowerCase();
      if (!name) continue;
      const exact = name === normalizedTarget || name.includes(normalizedTarget);
      const sameDate = name.includes(String(day)) && name.includes(String(year)) && name.includes(
        new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(target).toLowerCase()
      );
      if ((exact || sameDate) && !(await cell.isDisabled().catch(() => false))) {
        await cell.click({ timeout: 10000 });
        return true;
      }
    }
    return false;
  }

  private async selectFacebookTime(page: Page, time: string): Promise<boolean> {
    const picker = page.getByRole('button', { name: 'Abrir seletor de hora' }).last();
    if (!(await picker.count())) return false;
    await picker.click({ timeout: 10000 });

    const exact = page.getByRole('option', { name: time, exact: true }).first();
    if (await exact.count()) {
      await exact.click({ timeout: 10000 });
      return true;
    }

    const escaped = time.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fallback = page.locator('[role="option"]').filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) }).first();
    if (!(await fallback.count())) return false;
    await fallback.click({ timeout: 10000 });
    return true;
  }

  private async clickScheduleButton(page: Page): Promise<boolean> {
    const dialog = page.locator('[role="dialog"]').last();
    const button = dialog.getByRole('button', { name: /^(Programar|Agendar)$/i }).last();
    if (!(await button.count())) return false;
    if (await button.isDisabled().catch(() => false)) return false;
    if ((await button.getAttribute('aria-disabled')) === 'true') return false;
    await button.click({ timeout: 10000 });
    return true;
  }

  async publishScheduledPublication(input: ScheduledPublicationInput): Promise<ScheduledPublicationResult> {
    return this.withAutomationLock(() => this.publishScheduledPublicationInternal(input));
  }

  private async publishScheduledPublicationInternal(input: ScheduledPublicationInput): Promise<ScheduledPublicationResult> {
    if (!input.groupUrl?.includes('/groups/')) return { success: false, error: 'FACEBOOK_GROUP_ACCESS_FAILED: URL de grupo inválida.' };
    if (!input.content?.trim()) return { success: false, error: 'FACEBOOK_CONTENT_FIELD_NOT_FOUND: conteúdo vazio.' };
    if (!input.affiliateUrl || !/^https?:\/\//i.test(input.affiliateUrl) || !input.affiliateUrl.includes('/20889')) return { success: false, error: 'FACEBOOK_AFFILIATE_URL_INVALID' };
    if (/https?:\/\//i.test(input.content) || /R\$/i.test(input.content)) return { success: false, error: 'FACEBOOK_CONTENT_INVALID: copy não deve conter URL nem preço.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) return { success: false, error: 'FACEBOOK_DATE_FIELD_NOT_FOUND: data deve ser YYYY-MM-DD.' };
    if (!/^\d{2}:\d{2}$/.test(input.scheduledTime)) return { success: false, error: 'FACEBOOK_TIME_FIELD_NOT_FOUND: hora deve ser HH:mm.' };

    const scheduled = new Date(`${input.scheduledDate}T${input.scheduledTime}:00`);
    const hour = Number(input.scheduledTime.slice(0, 2));
    const minute = Number(input.scheduledTime.slice(3));
    if (Number.isNaN(scheduled.getTime()) || scheduled.getHours() !== hour || scheduled.getMinutes() !== minute) {
      return { success: false, error: 'FACEBOOK_DATE_FIELD_NOT_FOUND: data/hora inválidas.' };
    }
    if (scheduled.getTime() <= Date.now()) return { success: false, error: 'FACEBOOK_SCHEDULE_IN_PAST' };

    if (!(await this.ensureFacebookSession())) return { success: false, error: 'FACEBOOK_REAUTH_REQUIRED' };
    const group = await this.verifyGroupAccess(input.groupUrl);
    if (!group.accessible) return { success: false, error: `FACEBOOK_GROUP_ACCESS_FAILED: ${group.message}` };

    try {
      const page = await this.getWorkingPage(await this.getOrCreateBrowserContext());
      await page.goto(input.groupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);
      if (!(await this.openComposer(page))) return { success: false, error: 'FACEBOOK_COMPOSER_NOT_FOUND' };
      if (!(await this.fillCopyAndBuildLinkPreview(page, input.content, input.affiliateUrl))) return { success: false, error: 'FACEBOOK_CONTENT_OR_LINK_PREVIEW_FAILED' };
      await page.waitForTimeout(2500);
      if (!(await this.openScheduling(page))) return { success: false, error: 'FACEBOOK_SCHEDULING_UNAVAILABLE' };
      if (!(await this.selectFacebookDate(page, input.scheduledDate))) return { success: false, error: 'FACEBOOK_DATE_FIELD_NOT_FOUND' };
      if (!(await this.selectFacebookTime(page, input.scheduledTime))) return { success: false, error: 'FACEBOOK_TIME_FIELD_NOT_FOUND' };
      await page.waitForTimeout(500);

      if (!(await this.clickScheduleButton(page))) return { success: false, error: 'FACEBOOK_SCHEDULE_BUTTON_DISABLED' };
      await page.waitForTimeout(2500);

      const dialog = page.locator('[role="dialog"]').last();
      const confirmation = page.getByText(/agendad|programad|scheduled/i).first();
      const confirmedByText = await confirmation.isVisible().catch(() => false);
      const dialogVisible = await dialog.isVisible().catch(() => false);
      if (!confirmedByText && dialogVisible) {
        const text = (await dialog.innerText().catch(() => '')).toLowerCase();
        if (!/agendad|programad|scheduled|postado|publicado/.test(text)) {
          return { success: false, error: 'FACEBOOK_SCHEDULE_CONFIRMATION_FAILED' };
        }
      }

      const scheduledAt = scheduled.toISOString();
      logger.facebook(`Publicação agendada no Facebook para ${scheduledAt}.`);
      return { success: true, scheduledAt };
    } catch (error: any) {
      logger.facebook(`Falha no agendamento Facebook: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async publishSingle(publication: Publication): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    return this.withAutomationLock(() => this.publishSingleInternal(publication));
  }

  private async publishSingleInternal(publication: Publication): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    if (!(await this.ensureFacebookSession())) return { success: false, error: 'Facebook requer autenticação.' };
    const product = await storage.getProductById(publication.product_id);
    if (!product?.affiliate_url?.includes('/20889')) return { success: false, error: 'Publicação bloqueada: produto sem link afiliado /20889 válido.' };
    if (/https?:\/\//i.test(publication.content) || /R\$/i.test(publication.content)) return { success: false, error: 'Publicação bloqueada: copy contém URL ou preço.' };

    const settings = await storage.getSettings();
    const targetGroupUrl = publication.facebook_group_url || settings.facebook_group_url;
    const group = await this.verifyGroupAccess(targetGroupUrl);
    if (!group.accessible) return { success: false, error: group.message };

    try {
      const page = await this.getWorkingPage(await this.getOrCreateBrowserContext());
      await page.goto(targetGroupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);
      if (!(await this.openComposer(page))) return { success: false, error: 'FACEBOOK_COMPOSER_NOT_FOUND' };
      if (!(await this.fillCopyAndBuildLinkPreview(page, publication.content, product.affiliate_url))) return { success: false, error: 'FACEBOOK_CONTENT_OR_LINK_PREVIEW_FAILED' };
      await page.waitForTimeout(2000);

      const dialog = page.locator('[role="dialog"]').last();
      const publishButton = dialog.getByRole('button', { name: /^(Publicar|Postar)$/i }).last();
      if (!(await publishButton.count())) return { success: false, error: 'FACEBOOK_PUBLISH_BUTTON_NOT_FOUND' };
      if (await publishButton.isDisabled().catch(() => false)) return { success: false, error: 'FACEBOOK_PUBLISH_BUTTON_DISABLED' };

      await publishButton.click({ timeout: 10000 });
      await page.waitForTimeout(2500);

      const postLink = page.locator('a[href*="/posts/"], a[href*="/permalink/"]').first();
      const postUrl = await postLink.getAttribute('href').catch(() => null);
      return { success: true, postUrl: postUrl || undefined };
    } catch (error: any) {
      logger.facebook(`Falha na publicação Facebook: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }
}

export const facebookService = new FacebookService();
