import { FacebookSessionStatus } from '../types.js';
import { logger } from './LoggerService.js';
import { facebookBrowser } from './FacebookBrowserService.js';
import { storage } from './StorageService.js';
import { normalizeGroupUrl } from '../utils/idempotency.js';

export class FacebookSessionService {
  private status: FacebookSessionStatus = {
    connected: false,
    status: 'disconnected',
    profile_dir: facebookBrowser.getProfileDir(),
    details: 'Perfil persistente do Facebook configurado.'
  };

  private sessionLock: Promise<void> = Promise.resolve();

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionLock;
    let release!: () => void;
    this.sessionLock = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  getStatus(): FacebookSessionStatus {
    return { ...this.status };
  }

  private async hasSession(): Promise<boolean> {
    const cookies = await facebookBrowser.cookies();
    const hasCookies = cookies.some(c => c.name === 'c_user' && !!c.value) && cookies.some(c => c.name === 'xs' && !!c.value);
    if (!hasCookies) return false;
    return !(await this.isLoginPage());
  }

  private async isLoginPage(): Promise<boolean> {
    try {
      const page = await facebookBrowser.getOperationalPage();
      const currentUrl = page.url();
      if (/\/login|\/checkpoint|\/recover/i.test(currentUrl)) return true;
      const count = await page.locator('input[name="email"], input[name="pass"], form[action*="login"]').count().catch(() => 0);
      return count > 0;
    } catch {
      return false;
    }
  }

  private isGroupUrlMatch(currentUrl: string, targetGroupUrl: string): boolean {
    try {
      const currentObj = new URL(currentUrl);
      const targetObj = new URL(targetGroupUrl);
      return (
        currentObj.origin === targetObj.origin &&
        currentObj.pathname.replace(/\/+$/, '') === targetObj.pathname.replace(/\/+$/, '')
      );
    } catch {
      return false;
    }
  }

  /**
   * Called on startup or connect. Validates current persistent session.
   * Rigorously verifies that the single operational page is navigated to and
   * confirmed inside the target Facebook group, closing any extra tabs.
   * If timeoutMs > 0 and not logged in, waits up to timeoutMs for user authentication.
   */
  async start(timeoutMs = 0): Promise<FacebookSessionStatus> {
    return this.withLock(async () => {
      try {
        // 1. Enforce strictly a single operational page and close any extra tabs
        const page = await facebookBrowser.closeExtraPages();
        const settings = await storage.getSettings().catch(() => ({ facebook_group_url: '' }));
        const targetUrl = settings?.facebook_group_url ? normalizeGroupUrl(settings.facebook_group_url) : '';

        // 2. Check basic session cookie validity
        const cookies = await facebookBrowser.cookies();
        const hasCookies = cookies.some(c => c.name === 'c_user' && !!c.value) && cookies.some(c => c.name === 'xs' && !!c.value);

        if (!hasCookies) {
          // If browser is on blank page, navigate to login or group
          if (!page.url() || page.url() === 'about:blank') {
            const dest = targetUrl || 'https://www.facebook.com';
            logger.facebook(`[Startup] Navegando página operacional para ${dest} para login...`);
            await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(err => {
              logger.facebook(`Aviso na navegação inicial de login: ${err.message}`, 'warn');
            });
            await facebookBrowser.closeExtraPages();
          }

          if (timeoutMs <= 0) {
            this.status = {
              ...this.status,
              connected: false,
              status: 'requires_reauth',
              configured_group_url: targetUrl || undefined,
              group_accessible: false,
              details: 'Facebook requer autenticação no navegador persistente (cookies c_user e xs ausentes).'
            };
            return this.getStatus();
          }

          this.status = {
            ...this.status,
            connected: false,
            status: 'connecting',
            configured_group_url: targetUrl || undefined,
            group_accessible: false,
            details: 'Aguardando autenticação no navegador persistente.'
          };

          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            await page.waitForTimeout(2500);
            await facebookBrowser.closeExtraPages();
            const freshCookies = await facebookBrowser.cookies();
            const authed = freshCookies.some(c => c.name === 'c_user' && !!c.value) && freshCookies.some(c => c.name === 'xs' && !!c.value);
            if (authed && !(await this.isLoginPage())) {
              break;
            }
          }

          const recheckCookies = await facebookBrowser.cookies();
          const isAuthed = recheckCookies.some(c => c.name === 'c_user' && !!c.value) && recheckCookies.some(c => c.name === 'xs' && !!c.value);
          if (!isAuthed || await this.isLoginPage()) {
            this.status = {
              ...this.status,
              connected: false,
              status: 'requires_reauth',
              configured_group_url: targetUrl || undefined,
              group_accessible: false,
              details: 'Tempo limite esgotado. Facebook requer autenticação no navegador.'
            };
            return this.getStatus();
          }
        }

        // 3. Rigorous target group positioning and verification
        if (targetUrl) {
          logger.facebook(`[Startup] Verificando posicionamento e acesso no grupo alvo: ${targetUrl}`);
          const currentUrl = page.url();

          // If not currently in the target group, navigate there directly
          if (!this.isGroupUrlMatch(currentUrl, targetUrl)) {
            logger.facebook(`[Startup] Navegando página operacional única para o grupo: ${targetUrl}`);
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await facebookBrowser.closeExtraPages();
          }

          // Check for login / checkpoint redirection
          const afterNavUrl = page.url();
          if (/\/login|\/checkpoint|\/recover/i.test(afterNavUrl)) {
            this.status = {
              ...this.status,
              connected: false,
              status: 'requires_reauth',
              configured_group_url: targetUrl,
              group_accessible: false,
              details: `Redirecionado para tela de autenticação/checkpoint (${afterNavUrl}).`
            };
            logger.facebook(`[Startup] Redirecionamento para checkpoint detectado: ${afterNavUrl}`, 'warn');
            return this.getStatus();
          }

          // Check if group is accessible
          let groupAccessible = false;
          let details = `Sessão ativa e confirmada no grupo alvo: ${targetUrl}`;

          try {
            const bodyText = await page.locator('body').innerText().then(t => t.slice(0, 1200)).catch(() => '');
            if (/Este conteúdo não está disponível/i.test(bodyText) || /This content isn't available/i.test(bodyText)) {
              groupAccessible = false;
              details = `Conta autenticada, mas o grupo alvo está inacessível (não encontrado ou permissão insuficiente).`;
              logger.facebook(`[Startup] Conteúdo indisponível no grupo: ${targetUrl}`, 'warn');
            } else {
              // Look for composer triggers, feed, or group structure
              const composerCount = await page.locator("[aria-label='Escreva algo...']:visible, [aria-label='No que você está pensando?']:visible, [aria-label='Criar publicação']:visible").count().catch(() => 0);
              const mainCount = await page.locator('main, [role="main"], [role="feed"]').count().catch(() => 0);
              if (composerCount > 0 || mainCount > 0 || /Facebook/i.test(await page.title().catch(() => ''))) {
                groupAccessible = true;
              }
            }
          } catch (e: any) {
            logger.facebook(`[Startup] Aviso ao verificar elementos do grupo: ${e.message}`, 'warn');
          }

          // Close any extra tabs that might have opened
          await facebookBrowser.closeExtraPages();

          this.status = {
            ...this.status,
            connected: true,
            status: 'connected',
            configured_group_url: targetUrl,
            group_accessible: groupAccessible,
            connected_user: 'Conta Facebook autenticada',
            last_authenticated_at: new Date().toISOString(),
            details
          };
          logger.facebook(`[Startup] Verificação de sessão concluída. Grupo acessível: ${groupAccessible}`, groupAccessible ? 'success' : 'warn');
          return this.getStatus();
        }

        // Target URL not configured, but cookies valid
        if (!page.url() || page.url() === 'about:blank') {
          await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
          await facebookBrowser.closeExtraPages();
        }

        this.status = {
          ...this.status,
          connected: true,
          status: 'connected',
          configured_group_url: undefined,
          group_accessible: false,
          connected_user: 'Conta Facebook autenticada',
          last_authenticated_at: new Date().toISOString(),
          details: 'Facebook autenticado. Configure o URL do grupo nas configurações.'
        };
        return this.getStatus();
      } catch (error: any) {
        this.status = {
          ...this.status,
          connected: false,
          status: 'requires_reauth',
          details: error.message
        };
        logger.facebook(`Falha na verificação de sessão de startup: ${error.message}`, 'error');
        return this.getStatus();
      }
    });
  }

  async refresh(): Promise<FacebookSessionStatus> {
    return this.start(0);
  }

  async connect(): Promise<{ success: boolean; message: string; connectedUser?: string }> {
    const status = await this.start(60000);
    return status.connected
      ? { success: true, message: 'Facebook conectado no navegador persistente.', connectedUser: status.connected_user }
      : { success: false, message: status.details || 'Facebook requer autenticação.' };
  }

  async requireAuthenticated(): Promise<void> {
    const status = await this.refresh();
    if (!status.connected) throw new Error('FACEBOOK_REAUTH_REQUIRED');
  }
}

export const facebookSession = new FacebookSessionService();
