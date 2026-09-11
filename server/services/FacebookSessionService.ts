import { FacebookSessionStatus } from '../types.js';
import { logger } from './LoggerService.js';
import { facebookBrowser } from './FacebookBrowserService.js';

export class FacebookSessionService {
  private status: FacebookSessionStatus = {
    connected: false,
    status: 'disconnected',
    profile_dir: facebookBrowser.getProfileDir(),
    details: 'Perfil persistente do Facebook configurado.'
  };

  getStatus(): FacebookSessionStatus {
    return { ...this.status };
  }

  private async hasSession(): Promise<boolean> {
    const cookies = await facebookBrowser.cookies();
    return cookies.some(c => c.name === 'c_user' && !!c.value) && cookies.some(c => c.name === 'xs' && !!c.value);
  }

  private async isLoginPage(): Promise<boolean> {
    const page = await facebookBrowser.page();
    return /\/login|\/checkpoint|\/recover/i.test(page.url()) || await page.locator('input[name="email"], input[name="pass"], form[action*="login"]').count() > 0;
  }

  /** Called once by server startup. Opens the existing persistent browser and waits for manual login only if necessary. */
  async start(): Promise<FacebookSessionStatus> {
    try {
      const page = await facebookBrowser.page();
      if (await this.hasSession() && !(await this.isLoginPage())) {
        this.status = { ...this.status, connected: true, status: 'connected', connected_user: 'Conta Facebook autenticada', last_authenticated_at: new Date().toISOString(), details: 'Sessão recuperada do perfil persistente.' };
        return this.getStatus();
      }

      this.status = { ...this.status, connected: false, status: 'connecting', details: 'Aguardando autenticação manual no navegador persistente.' };
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        if (await this.hasSession() && !(await this.isLoginPage())) {
          this.status = { ...this.status, connected: true, status: 'connected', connected_user: 'Conta Facebook autenticada', last_authenticated_at: new Date().toISOString(), details: 'Autenticação concluída no navegador persistente.' };
          return this.getStatus();
        }
        await page.waitForTimeout(2000);
      }
      this.status = { ...this.status, connected: false, status: 'requires_reauth', details: 'Tempo limite aguardando login manual.' };
      return this.getStatus();
    } catch (error: any) {
      this.status = { ...this.status, connected: false, status: 'requires_reauth', details: error.message };
      logger.facebook(`Falha ao iniciar sessão Facebook: ${error.message}`, 'error');
      return this.getStatus();
    }
  }

  async refresh(): Promise<FacebookSessionStatus> {
    try {
      const authenticated = await this.hasSession();
      this.status = { ...this.status, connected: authenticated, status: authenticated ? 'connected' : 'requires_reauth', connected_user: authenticated ? 'Conta Facebook autenticada' : undefined, details: authenticated ? 'Sessão ativa no perfil persistente.' : 'Perfil persistente sem sessão autenticada.' };
    } catch (error: any) {
      this.status = { ...this.status, connected: false, status: 'requires_reauth', details: error.message };
    }
    return this.getStatus();
  }

  async connect(): Promise<{ success: boolean; message: string; connectedUser?: string }> {
    const status = await this.start();
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
