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

  constructor() {
    this.profileDir = path.join(process.cwd(), 'data', 'browser-profiles', 'facebook');
    fs.mkdirSync(this.profileDir, { recursive: true });
    this.sessionStatus = {
      connected: false,
      status: 'disconnected',
      profile_dir: 'data/browser-profiles/facebook',
      details: 'Perfil persistente do Facebook configurado.'
    };
  }

  getStatus(): FacebookSessionStatus { return { ...this.sessionStatus }; }

  private async getOrCreateBrowserContext(): Promise<BrowserContext> {
    if (this.browserContext) return this.browserContext;
    if (this.contextPromise) return this.contextPromise;
    this.contextPromise = chromium.launchPersistentContext(this.profileDir, {
      channel: process.env.FACEBOOK_BROWSER_CHANNEL || 'chrome',
      headless: process.env.FACEBOOK_HEADLESS === 'true',
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
      const loginForm = await page.locator('input[name="email"], input[name="pass"], form[action*="login"]').count();
      if (loginForm > 0) return false;
      return await page.locator('[role="feed"], [aria-label*="Criar publicação"], [aria-label*="Escreva algo"], [aria-label*="Sua conta"], [href*="/profile.php"], [href*="/me/"]').count() > 0;
    } catch { return false; }
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
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!(await this.checkPageLoginStatus(page))) {
        this.sessionStatus = { ...this.sessionStatus, connected: false, status: 'requires_reauth', details: 'Facebook solicita autenticação manual.' };
        return false;
      }
      this.sessionStatus = { ...this.sessionStatus, connected: true, status: 'connected', connected_user: 'Conta Facebook autenticada', last_authenticated_at: new Date().toISOString(), details: 'Sessão ativa no perfil persistente.' };
      return true;
    } catch (error: any) {
      this.sessionStatus = { ...this.sessionStatus, connected: false, status: 'requires_reauth', details: error.message };
      logger.facebook(`Falha ao validar sessão: ${error.message}`, 'error');
      return false;
    }
  }

  async connectSession(): Promise<{ success: boolean; message: string; connectedUser?: string }> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectSessionInternal();
    try { return await this.connectPromise; } finally { this.connectPromise = null; }
  }

  private async connectSessionInternal(): Promise<{ success: boolean; message: string; connectedUser?: string }> {
    try {
      const context = await this.getOrCreateBrowserContext();
      const page = await this.getWorkingPage(context);
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (await this.checkPageLoginStatus(page)) {
        this.sessionStatus = { ...this.sessionStatus, connected: true, status: 'connected', connected_user: 'Conta Facebook autenticada', last_authenticated_at: new Date().toISOString() };
        return { success: true, message: 'Facebook já está autenticado no perfil persistente.', connectedUser: this.sessionStatus.connected_user };
      }
      if (process.env.FACEBOOK_HEADLESS === 'true') return { success: false, message: 'FACEBOOK_HEADLESS=true impede autenticação manual.' };
      this.sessionStatus = { ...this.sessionStatus, connected: false, status: 'connecting', details: 'Aguardando login e 2FA manuais.' };
      if (!(await this.waitForManualAuthentication(page))) return { success: false, message: 'Tempo limite aguardando autenticação manual.' };
      this.sessionStatus = { ...this.sessionStatus, connected: true, status: 'connected', connected_user: 'Conta Facebook autenticada', last_authenticated_at: new Date().toISOString(), details: 'Login e 2FA concluídos no perfil persistente.' };
      return { success: true, message: 'Login manual concluído. Perfil persistente mantido aberto.', connectedUser: this.sessionStatus.connected_user };
    } catch (error: any) {
      logger.facebook(`Erro no navegador Facebook: ${error.message}`, 'error');
      return { success: false, message: error.message };
    }
  }

  async verifySessionWithBrowser(): Promise<boolean> { return this.ensureFacebookSession(); }

  async verifyGroupAccess(groupUrl: string): Promise<{ accessible: boolean; message: string }> {
    if (!groupUrl || !groupUrl.includes('/groups/')) return { accessible: false, message: 'URL de grupo inválida.' };
    if (!(await this.ensureFacebookSession())) return { accessible: false, message: 'Sessão do Facebook não autenticada.' };
    try {
      const page = await this.getWorkingPage(await this.getOrCreateBrowserContext());
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);
      const blocked = /conteúdo não está disponível|página não encontrada|link pode estar corrompido/i.test(await page.content());
      const composer = await page.locator('[role="button"]:has-text("Escreva algo"), [aria-label*="Criar uma publicação"], [aria-label*="Escreva algo"]').count();
      const accessible = !blocked && page.url().includes('/groups/') && composer > 0;
      this.sessionStatus.configured_group_url = groupUrl;
      this.sessionStatus.group_accessible = accessible;
      return accessible ? { accessible: true, message: 'Grupo acessível e composer detectado.' } : { accessible: false, message: 'Grupo não pôde ser validado para publicação.' };
    } catch (error: any) { return { accessible: false, message: error.message }; }
  }

  private async openComposer(page: Page): Promise<boolean> {
    const trigger = page.locator('[role="button"]:has-text("Escreva algo"), [role="button"]:has-text("No que você está pensando"), [aria-label*="Criar uma publicação"], [aria-label*="Escreva algo"]').first();
    if (!(await trigger.count())) return false;
    await trigger.click({ timeout: 10000 });
    await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
    return await page.locator('[role="dialog"] [role="textbox"], [role="dialog"] [contenteditable="true"], [role="textbox"][contenteditable="true"]').count() > 0;
  }

  private async fillComposer(page: Page, content: string): Promise<boolean> {
    const textbox = page.locator('[role="dialog"] [role="textbox"], [role="dialog"] [contenteditable="true"], [role="textbox"][contenteditable="true"]').first();
    if (!(await textbox.count())) return false;
    await textbox.fill(content);
    return true;
  }

  private async openScheduling(page: Page): Promise<boolean> {
    const more = page.locator('[role="dialog"] [aria-label*="Mais opções"], [role="dialog"] [aria-label*="More options"]').first();
    if (!(await more.count())) return false;
    await more.click({ timeout: 10000 });
    const option = page.locator('[role="menuitem"]:has-text("Programar post"), [role="menuitem"]:has-text("Agendar post"), text=/Programar post/i, text=/Agendar post/i').first();
    if (!(await option.count())) return false;
    await option.click({ timeout: 10000 });
    return await page.locator('input[type="date"], input[type="time"]').count() >= 1;
  }

  async publishScheduledPublication(input: ScheduledPublicationInput): Promise<ScheduledPublicationResult> {
    if (!input.groupUrl?.includes('/groups/')) return { success: false, error: 'FACEBOOK_GROUP_ACCESS_FAILED: URL de grupo inválida.' };
    if (!input.content?.trim()) return { success: false, error: 'FACEBOOK_CONTENT_FIELD_NOT_FOUND: conteúdo vazio.' };
    if (!input.affiliateUrl || !/^https?:\/\//i.test(input.affiliateUrl) || !input.affiliateUrl.includes('/20889')) return { success: false, error: 'FACEBOOK_AFFILIATE_URL_INVALID' };
    if (!input.content.includes(input.affiliateUrl) || !input.content.includes('/20889')) return { success: false, error: 'FACEBOOK_AFFILIATE_URL_INVALID: link afiliado não está no conteúdo.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) return { success: false, error: 'FACEBOOK_DATE_FIELD_NOT_FOUND: data deve ser YYYY-MM-DD.' };
    if (!/^\d{2}:\d{2}$/.test(input.scheduledTime)) return { success: false, error: 'FACEBOOK_TIME_FIELD_NOT_FOUND: hora deve ser HH:mm.' };
    const scheduled = new Date(`${input.scheduledDate}T${input.scheduledTime}:00`);
    if (Number.isNaN(scheduled.getTime()) || scheduled.getHours() !== Number(input.scheduledTime.slice(0, 2)) || scheduled.getMinutes() !== Number(input.scheduledTime.slice(3))) return { success: false, error: 'FACEBOOK_DATE_FIELD_NOT_FOUND: data/hora inválidas.' };
    if (scheduled.getTime() <= Date.now()) return { success: false, error: 'FACEBOOK_SCHEDULE_IN_PAST' };

    if (!(await this.ensureFacebookSession())) return { success: false, error: 'FACEBOOK_REAUTH_REQUIRED' };
    const group = await this.verifyGroupAccess(input.groupUrl);
    if (!group.accessible) return { success: false, error: `FACEBOOK_GROUP_ACCESS_FAILED: ${group.message}` };

    try {
      const page = await this.getWorkingPage(await this.getOrCreateBrowserContext());
      await page.goto(input.groupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);
      if (!(await this.openComposer(page))) return { success: false, error: 'FACEBOOK_COMPOSER_NOT_FOUND' };
      if (!(await this.fillComposer(page, input.content))) return { success: false, error: 'FACEBOOK_CONTENT_FIELD_NOT_FOUND' };
      await page.waitForTimeout(2500);
      if (!(await this.openScheduling(page))) return { success: false, error: 'FACEBOOK_SCHEDULING_UNAVAILABLE' };

      const dateInput = page.locator('input[type="date"]').first();
      const timeInput = page.locator('input[type="time"]').first();
      if (!(await dateInput.count())) return { success: false, error: 'FACEBOOK_DATE_FIELD_NOT_FOUND' };
      if (!(await timeInput.count())) return { success: false, error: 'FACEBOOK_TIME_FIELD_NOT_FOUND' };
      await dateInput.fill(input.scheduledDate);
      await timeInput.fill(input.scheduledTime);
      await page.waitForTimeout(500);

      const actualDate = await dateInput.inputValue();
      const actualTime = await timeInput.inputValue();
      if (actualDate !== input.scheduledDate || actualTime !== input.scheduledTime) return { success: false, error: 'FACEBOOK_SCHEDULE_FIELDS_NOT_APPLIED' };

      const scheduleButton = page.locator('[role="dialog"] [aria-label*="Programar"], [role="dialog"] [aria-label*="Agendar"], [role="button"]:has-text("Programar"), [role="button"]:has-text("Agendar")').last();
      if (!(await scheduleButton.count())) return { success: false, error: 'FACEBOOK_SCHEDULE_BUTTON_NOT_FOUND' };
      if (await scheduleButton.isDisabled().catch(() => false) || (await scheduleButton.getAttribute('aria-disabled')) === 'true') return { success: false, error: 'FACEBOOK_SCHEDULE_BUTTON_DISABLED' };

      await scheduleButton.click({ timeout: 10000 });
      await page.waitForTimeout(2500);

      const successText = page.locator('text=/agendad|programad|scheduled/i').first();
      const dialogStillOpen = await page.locator('[role="dialog"]').count();
      const successVisible = await successText.isVisible().catch(() => false);
      if (!successVisible && dialogStillOpen > 0) {
        const remainingText = (await page.locator('[role="dialog"]').innerText().catch(() => '')).toLowerCase();
        if (!/agendad|programad|scheduled|postado|publicado/.test(remainingText)) return { success: false, error: 'FACEBOOK_SCHEDULE_CONFIRMATION_FAILED' };
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
    if (!(await this.ensureFacebookSession())) return { success: false, error: 'Facebook requer autenticação.' };
    if (!publication.content?.includes('/20889')) return { success: false, error: 'Publicação bloqueada: link afiliado /20889 ausente.' };
    const settings = await storage.getSettings();
    const targetGroupUrl = publication.facebook_group_url || settings.facebook_group_url;
    const group = await this.verifyGroupAccess(targetGroupUrl);
    if (!group.accessible) return { success: false, error: group.message };
    try {
      const page = await this.getWorkingPage(await this.getOrCreateBrowserContext());
      await page.goto(targetGroupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);
      if (!(await this.openComposer(page))) return { success: false, error: 'Composer real do grupo não foi encontrado.' };
      if (!(await this.fillComposer(page, publication.content))) return { success: false, error: 'Campo de conteúdo não encontrado.' };
      const submit = page.locator('[role="dialog"] [aria-label="Publicar"], [role="dialog"] [aria-label="Postar"], [role="button"]:has-text("Publicar"), [role="button"]:has-text("Postar")').first();
      if (!(await submit.count())) return { success: false, error: 'Botão real de publicação não foi encontrado.' };
      await submit.click();
      const confirmed = await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).then(() => true).catch(() => false);
      return confirmed ? { success: true } : { success: false, error: 'Publicação não foi confirmada pelo Facebook.' };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async publishBatch(publications: Publication[]): Promise<{ results: Array<{ id: string; success: boolean; postUrl?: string; error?: string }> }> {
    const results: Array<{ id: string; success: boolean; postUrl?: string; error?: string }> = [];
    if (!(await this.ensureFacebookSession())) return { results: publications.map(p => ({ id: p.id, success: false, error: 'Facebook requer autenticação.' })) };
    for (const publication of publications) results.push({ id: publication.id, ...(await this.publishSingle(publication)) });
    return { results };
  }

  async publishTest(groupUrl: string): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    if (!groupUrl) return { success: false, error: 'Grupo não configurado.' };
    if (!(await this.ensureFacebookSession())) return { success: false, error: 'Facebook requer autenticação.' };
    const page = await this.getWorkingPage(await this.getOrCreateBrowserContext());
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    if (!(await this.openComposer(page))) return { success: false, error: 'Composer não encontrado.' };
    const content = 'FORGEDEALS — TESTE DE CONEXÃO\n\nEsta é uma publicação de teste solicitada pelo operador. Não representa uma oferta comercial.';
    if (!(await this.fillComposer(page, content))) return { success: false, error: 'Campo de conteúdo não encontrado.' };
    const submit = page.locator('[role="dialog"] [aria-label="Publicar"], [role="dialog"] [aria-label="Postar"], [role="button"]:has-text("Publicar"), [role="button"]:has-text("Postar")').first();
    if (!(await submit.count())) return { success: false, error: 'Botão de publicação não encontrado.' };
    await submit.click();
    const confirmed = await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).then(() => true).catch(() => false);
    return confirmed ? { success: true } : { success: false, error: 'Teste não confirmado pelo Facebook.' };
  }
}

export const facebookService = new FacebookService();
