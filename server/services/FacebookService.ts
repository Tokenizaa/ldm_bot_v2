import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { Publication, FacebookSessionStatus } from '../types.js';
import { logger } from './LoggerService.js';
import { storage } from './StorageService.js';

/**
 * Facebook browser policy:
 * - The persistent Playwright user-data directory is the ONLY session source of truth.
 * - storageState.json/cookie injection is deliberately not used.
 * - Credentials and 2FA are always entered manually by the operator when Facebook asks.
 * - The application never closes the context during normal operation.
 * - One FacebookService instance owns one persistent context and serializes connection attempts.
 */
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
      details: 'Perfil persistente do Facebook configurado. A sessão será validada quando o navegador for aberto.'
    };
  }

  getStatus(): FacebookSessionStatus {
    return { ...this.sessionStatus };
  }

  private async getOrCreateBrowserContext(): Promise<BrowserContext> {
    if (this.browserContext) return this.browserContext;
    if (this.contextPromise) return this.contextPromise;

    this.contextPromise = (async () => {
      try {
        const context = await chromium.launchPersistentContext(this.profileDir, {
          // Use the user's installed Chrome channel rather than Playwright's disposable Chromium.
          // This does NOT reuse the user's everyday Chrome profile; profileDir remains isolated.
          channel: process.env.FACEBOOK_BROWSER_CHANNEL || 'chrome',
          headless: process.env.FACEBOOK_HEADLESS === 'true',
          viewport: { width: 1280, height: 800 },
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        this.browserContext = context;
        context.on('close', () => {
          this.browserContext = null;
          this.contextPromise = null;
          logger.facebook('Contexto persistente do Facebook foi encerrado.', 'warn');
          if (this.sessionStatus.connected) {
            this.sessionStatus.details = 'Navegador encerrado; a sessão permanece no perfil persistente e será reutilizada na próxima abertura.';
          }
        });

        return context;
      } catch (error) {
        this.contextPromise = null;
        throw error;
      }
    })();

    return this.contextPromise;
  }

  private async getWorkingPage(context: BrowserContext): Promise<Page> {
    const pages = context.pages();
    return pages[0] || context.newPage();
  }

  private async waitForManualAuthentication(page: Page): Promise<boolean> {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      if (await this.checkPageLoginStatus(page)) return true;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return false;
  }

  async ensureFacebookSession(): Promise<boolean> {
    try {
      const context = await this.getOrCreateBrowserContext();
      const page = await this.getWorkingPage(context);
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

      const loggedIn = await this.checkPageLoginStatus(page);
      if (!loggedIn) {
        this.sessionStatus = {
          connected: false,
          status: 'requires_reauth',
          profile_dir: 'data/browser-profiles/facebook',
          details: 'O perfil persistente existe, mas o Facebook está solicitando autenticação novamente.'
        };
        return false;
      }

      this.sessionStatus = {
        ...this.sessionStatus,
        connected: true,
        status: 'connected',
        connected_user: this.sessionStatus.connected_user || 'Conta Facebook autenticada',
        last_authenticated_at: new Date().toISOString(),
        details: 'Sessão ativa no perfil persistente do Facebook.'
      };
      return true;
    } catch (err: any) {
      logger.facebook(`Falha ao validar sessão: ${err.message}`, 'error');
      this.sessionStatus = {
        ...this.sessionStatus,
        connected: false,
        status: 'requires_reauth',
        details: `Não foi possível validar o perfil persistente: ${err.message}`
      };
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
    logger.facebook('Abrindo Chrome persistente com o perfil dedicado do Facebook. Nenhuma credencial será automatizada.');

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
          last_authenticated_at: new Date().toISOString(),
          details: 'Sessão já autenticada no perfil persistente. Não é necessário novo login.'
        };
        return { success: true, message: 'Facebook já está autenticado no perfil persistente. Nenhum novo login foi executado.', connectedUser: this.sessionStatus.connected_user };
      }

      if (process.env.FACEBOOK_HEADLESS === 'true') {
        return { success: false, message: 'FACEBOOK_HEADLESS=true impede autenticação manual. Use false para a primeira autenticação do perfil.' };
      }

      this.sessionStatus = {
        ...this.sessionStatus,
        connected: false,
        status: 'connecting',
        details: 'Aguardando autenticação manual no Facebook. Conclua login e 2FA no navegador aberto.'
      };

      const authenticated = await this.waitForManualAuthentication(page);
      if (!authenticated) {
        this.sessionStatus = {
          ...this.sessionStatus,
          connected: false,
          status: 'requires_reauth',
          details: 'Tempo limite aguardando autenticação manual no Facebook.'
        };
        return { success: false, message: 'Tempo limite de 5 minutos aguardando login/2FA no Facebook.' };
      }

      // Do NOT close the context and do NOT export cookies/state. The persistent profile
      // has already received the authenticated browser state and will be reused on restart.
      this.sessionStatus = {
        ...this.sessionStatus,
        connected: true,
        status: 'connected',
        connected_user: 'Conta Facebook autenticada',
        last_authenticated_at: new Date().toISOString(),
        details: 'Login e 2FA concluídos. O perfil persistente continuará sendo usado automaticamente.'
      };
      logger.facebook('Login e 2FA concluídos. Contexto persistente mantido aberto e sessão gravada no perfil do navegador.');
      return { success: true, message: 'Login e 2FA concluídos. A sessão ficará disponível no perfil persistente sem novo login em cada execução.', connectedUser: this.sessionStatus.connected_user };
    } catch (err: any) {
      logger.facebook(`Erro ao abrir Chrome persistente: ${err.message}`, 'error');
      this.sessionStatus = {
        ...this.sessionStatus,
        connected: false,
        status: 'requires_reauth',
        details: `Erro no navegador persistente: ${err.message}`
      };
      return { success: false, message: `Não foi possível abrir o Chrome persistente: ${err.message}` };
    }
  }

  async verifySessionWithBrowser(): Promise<boolean> {
    return this.ensureFacebookSession();
  }

  async verifyGroupAccess(groupUrl: string): Promise<{ accessible: boolean; message: string }> {
    if (!groupUrl || !groupUrl.includes('/groups/')) return { accessible: false, message: 'URL de grupo inválida.' };
    if (!(await this.ensureFacebookSession())) return { accessible: false, message: 'Sessão do Facebook não autenticada.' };

    try {
      const context = await this.getOrCreateBrowserContext();
      const page = await this.getWorkingPage(context);
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const url = page.url();
      const content = await page.content();
      const blocked = /conteúdo não está disponível|página não encontrada|link pode estar corrompido/i.test(content);
      const composer = await page.locator('[role="textbox"], [aria-label*="Criar publicação"], [aria-label*="Escreva algo"], [aria-label*="No que você está pensando"]').count();
      const accessible = !blocked && url.includes('/groups/') && composer > 0;
      this.sessionStatus.configured_group_url = groupUrl;
      this.sessionStatus.group_accessible = accessible;
      return accessible
        ? { accessible: true, message: 'Grupo real acessível e composer detectado.' }
        : { accessible: false, message: 'Grupo não pôde ser validado para publicação pela conta autenticada.' };
    } catch (err: any) {
      logger.facebook(`Erro ao validar grupo: ${err.message}`, 'error');
      return { accessible: false, message: err.message };
    }
  }

  private async checkPageLoginStatus(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (/\/login|\/checkpoint|\/recover/i.test(url)) return false;

      // Prefer positive authenticated signals and reject the login form explicitly.
      const loginForm = await page.locator('input[name="email"], input[name="pass"], form[action*="login"]').count();
      if (loginForm > 0) return false;

      const authIndicator = await page.locator('[role="feed"], [aria-label*="Criar publicação"], [aria-label*="Escreva algo"], [aria-label*="Sua conta"], [aria-label*="Conta"] , [href*="/profile.php"], [href*="/me/"]').count();
      return authIndicator > 0;
    } catch {
      return false;
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
      const context = await this.getOrCreateBrowserContext();
      const page = await this.getWorkingPage(context);
      await page.goto(targetGroupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(1500);

      const trigger = page.locator('[role="button"]:has-text("Escreva algo"), [role="button"]:has-text("No que você está pensando"), [aria-label*="Criar uma publicação"], [aria-label*="Escreva algo"]').first();
      if (await trigger.count()) await trigger.click({ timeout: 5000 });

      const textbox = page.locator('[role="dialog"] [role="textbox"], [role="textbox"][contenteditable="true"]').first();
      if (!(await textbox.count())) return { success: false, error: 'Composer real do grupo não foi encontrado.' };
      await textbox.fill(publication.content);

      const submit = page.locator('[role="dialog"] [aria-label="Publicar"], [role="dialog"] [aria-label="Postar"], [role="dialog"] [aria-label="Post"], [role="button"]:has-text("Publicar"), [role="button"]:has-text("Postar")').first();
      if (!(await submit.count())) return { success: false, error: 'Botão real de publicação não foi encontrado.' };
      await submit.click();

      const confirmed = await Promise.race([
        page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).then(() => true).catch(() => false),
        page.locator('a[href*="/permalink/"], a[href*="/posts/"]').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
      ]);

      if (!confirmed) return { success: false, error: 'Publicação não foi confirmada pelo DOM do Facebook.' };

      let postUrl: string | undefined;
      const link = page.locator('a[href*="/permalink/"], a[href*="/posts/"]').first();
      if (await link.count()) {
        const href = await link.getAttribute('href');
        if (href) postUrl = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
      }

      logger.facebook(`Publicação real confirmada para ${publication.product?.product_name || publication.product_id}`);
      return { success: true, postUrl };
    } catch (err: any) {
      logger.facebook(`Falha na publicação: ${err.message}`, 'error');
      return { success: false, error: err.message };
    }
  }

  async publishBatch(publications: Publication[]): Promise<{ results: Array<{ id: string; success: boolean; postUrl?: string; error?: string }> }> {
    const results = [] as Array<{ id: string; success: boolean; postUrl?: string; error?: string }>;
    if (!(await this.ensureFacebookSession())) return { results: publications.map(p => ({ id: p.id, success: false, error: 'Facebook requer autenticação.' })) };
    for (const publication of publications) {
      const result = await this.publishSingle(publication);
      results.push({ id: publication.id, ...result });
    }
    return { results };
  }

  async publishTest(groupUrl: string): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    if (!groupUrl) return { success: false, error: 'Grupo não configurado.' };
    if (!(await this.ensureFacebookSession())) return { success: false, error: 'Facebook requer autenticação.' };
    const context = await this.getOrCreateBrowserContext();
    const page = await this.getWorkingPage(context);
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    const testContent = `FORGEDEALS — TESTE DE CONEXÃO\n\nEsta é uma publicação de teste solicitada pelo operador. Não representa uma oferta comercial.`;
    const trigger = page.locator('[role="button"]:has-text("Escreva algo"), [aria-label*="Criar uma publicação"], [aria-label*="Escreva algo"]').first();
    if (await trigger.count()) await trigger.click();
    const textbox = page.locator('[role="dialog"] [role="textbox"], [role="textbox"][contenteditable="true"]').first();
    if (!(await textbox.count())) return { success: false, error: 'Composer não encontrado.' };
    await textbox.fill(testContent);
    const submit = page.locator('[role="dialog"] [aria-label="Publicar"], [role="dialog"] [aria-label="Postar"], [role="button"]:has-text("Publicar"), [role="button"]:has-text("Postar")').first();
    if (!(await submit.count())) return { success: false, error: 'Botão de publicação não encontrado.' };
    await submit.click();
    const confirmed = await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).then(() => true).catch(() => false);
    return confirmed ? { success: true } : { success: false, error: 'Teste não confirmado pelo Facebook.' };
  }
}

export const facebookService = new FacebookService();
