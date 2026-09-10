import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { FacebookSessionStatus, Publication } from '../types.js';
import { logger } from './LoggerService.js';
import { storage } from './StorageService.js';

export class FacebookService {
  private readonly profileDir: string;
  private readonly stateFilePath: string;
  private sessionStatus: FacebookSessionStatus;
  private browserContext: BrowserContext | null = null;

  constructor() {
    this.profileDir = path.join(process.cwd(), 'data', 'browser-profiles', 'facebook');
    fs.mkdirSync(this.profileDir, { recursive: true });
    this.stateFilePath = path.join(this.profileDir, 'storageState.json');
    this.sessionStatus = {
      connected: false,
      status: 'disconnected',
      profile_dir: 'data/browser-profiles/facebook',
      details: 'Facebook desconectado. Clique em Conectar Facebook para abrir o navegador.'
    };
    this.checkSavedSession();
  }

  private checkSavedSession() {
    try {
      if (!fs.existsSync(this.stateFilePath)) return;
      const state = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));
      const hasAuthCookie = Array.isArray(state.cookies) && state.cookies.some((c: any) =>
        (c.name === 'c_user' || c.name === 'xs') && String(c.domain || '').includes('facebook.com')
      );
      if (!hasAuthCookie) return;
      const cUser = state.cookies.find((c: any) => c.name === 'c_user');
      this.sessionStatus = {
        connected: true,
        status: 'connected',
        connected_user: cUser?.value ? `Facebook ID: ${cUser.value}` : 'Conta conectada',
        last_authenticated_at: new Date(fs.statSync(this.stateFilePath).mtime).toISOString(),
        profile_dir: 'data/browser-profiles/facebook',
        details: 'Sessão persistida encontrada. Será validada no Facebook antes da publicação.'
      };
    } catch {
      this.sessionStatus.connected = false;
      this.sessionStatus.status = 'requires_reauth';
    }
  }

  getStatus(): FacebookSessionStatus { return this.sessionStatus; }

  private async getOrCreateBrowserContext(headless: boolean): Promise<BrowserContext> {
    if (this.browserContext) return this.browserContext;
    this.browserContext = await chromium.launchPersistentContext(this.profileDir, {
      headless,
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.browserContext.on('close', () => { this.browserContext = null; });
    return this.browserContext;
  }

  async ensureFacebookSession(): Promise<boolean> {
    if (!this.sessionStatus.connected && !fs.existsSync(this.stateFilePath)) return false;
    try {
      const context = await this.getOrCreateBrowserContext(process.env.FACEBOOK_HEADLESS === 'true');
      const page = context.pages()[0] || await context.newPage();
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const loggedIn = await this.checkPageLoginStatus(page);
      if (!loggedIn) {
        this.sessionStatus = {
          connected: false,
          status: 'requires_reauth',
          profile_dir: 'data/browser-profiles/facebook',
          details: 'Sessão expirada ou Facebook solicitou nova autenticação.'
        };
        return false;
      }
      this.sessionStatus.connected = true;
      this.sessionStatus.status = 'connected';
      this.sessionStatus.last_authenticated_at = new Date().toISOString();
      return true;
    } catch (err: any) {
      logger.facebook(`Falha ao validar sessão: ${err.message}`, 'error');
      this.sessionStatus.connected = false;
      this.sessionStatus.status = 'requires_reauth';
      return false;
    }
  }

  async connectSession(): Promise<{ success: boolean; message: string; connectedUser?: string }> {
    logger.facebook('Abrindo Chrome persistente para login manual do Facebook. O usuário deverá concluir o 2FA.');
    try {
      const context = await this.getOrCreateBrowserContext(process.env.FACEBOOK_HEADLESS === 'true');
      const page = context.pages()[0] || await context.newPage();
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (await this.checkPageLoginStatus(page)) {
        await context.storageState({ path: this.stateFilePath });
        this.checkSavedSession();
        return { success: true, message: 'Facebook já estava autenticado. Sessão persistida e navegador reutilizável.', connectedUser: this.sessionStatus.connected_user };
      }

      if (process.env.FACEBOOK_HEADLESS === 'true') {
        return { success: false, message: 'FACEBOOK_HEADLESS=true impede login manual. Remova a variável ou defina false para abrir o Chrome.' };
      }

      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (await this.checkPageLoginStatus(page)) {
          await context.storageState({ path: this.stateFilePath });
          this.checkSavedSession();
          logger.facebook('Login e 2FA concluídos. O mesmo contexto do Chrome permanecerá aberto para o lote.');
          return { success: true, message: 'Login e 2FA concluídos. Sessão persistida; o navegador será reutilizado.', connectedUser: this.sessionStatus.connected_user };
        }
      }

      return { success: false, message: 'Tempo limite de 5 minutos excedido aguardando login/2FA no Facebook.' };
    } catch (err: any) {
      logger.facebook(`Erro ao abrir Chrome: ${err.message}`, 'error');
      return { success: false, message: `Não foi possível abrir o Chrome: ${err.message}` };
    }
  }

  async verifySessionWithBrowser(): Promise<boolean> {
    return this.ensureFacebookSession();
  }

  async verifyGroupAccess(groupUrl: string): Promise<{ accessible: boolean; message: string }> {
    if (!groupUrl || !groupUrl.includes('/groups/')) return { accessible: false, message: 'URL de grupo inválida.' };
    if (!(await this.ensureFacebookSession())) return { accessible: false, message: 'Sessão do Facebook não autenticada.' };

    try {
      const context = await this.getOrCreateBrowserContext(process.env.FACEBOOK_HEADLESS === 'true');
      const page = context.pages()[0] || await context.newPage();
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
      const authIndicator = await page.locator('[aria-label="Facebook"], [role="feed"], [aria-label*="Criar publicação"], [aria-label*="Sua conta"], [aria-label*="Conta"]').count();
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
      const context = await this.getOrCreateBrowserContext(process.env.FACEBOOK_HEADLESS === 'true');
      const page = context.pages()[0] || await context.newPage();
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
    const context = await this.getOrCreateBrowserContext(process.env.FACEBOOK_HEADLESS === 'true');
    const page = context.pages()[0] || await context.newPage();
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
