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

  /**
   * Called on startup or connect. Validates current persistent session.
   * If timeoutMs > 0 and not logged in, waits up to timeoutMs for user authentication.
   */
  async start(timeoutMs = 0): Promise<FacebookSessionStatus> {
    return this.withLock(async () => {
      try {
        const page = await facebookBrowser.getOperationalPage();
        if (await this.hasSession()) {
          this.status = {
            ...this.status,
            connected: true,
            status: 'connected',
            connected_user: 'Conta Facebook autenticada',
            last_authenticated_at: new Date().toISOString(),
            details: 'Sessão recuperada do perfil persistente.'
          };
          return this.getStatus();
        }

        if (timeoutMs <= 0) {
          this.status = {
            ...this.status,
            connected: false,
            status: 'requires_reauth',
            details: 'Facebook requer autenticação no navegador persistente.'
          };
          return this.getStatus();
        }

        this.status = {
          ...this.status,
          connected: false,
          status: 'connecting',
          details: 'Aguardando autenticação no navegador persistente.'
        };

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (await this.hasSession()) {
            this.status = {
              ...this.status,
              connected: true,
              status: 'connected',
              connected_user: 'Conta Facebook autenticada',
              last_authenticated_at: new Date().toISOString(),
              details: 'Autenticação concluída no navegador persistente.'
            };
            return this.getStatus();
          }
          await page.waitForTimeout(2000);
        }

        this.status = {
          ...this.status,
          connected: false,
          status: 'requires_reauth',
          details: 'Facebook requer autenticação no navegador.'
        };
        return this.getStatus();
      } catch (error: any) {
        this.status = {
          ...this.status,
          connected: false,
          status: 'requires_reauth',
          details: error.message
        };
        logger.facebook(`Falha ao verificar sessão Facebook: ${error.message}`, 'error');
        return this.getStatus();
      }
    });
  }

  async refresh(): Promise<FacebookSessionStatus> {
    return this.withLock(async () => {
      try {
        const authenticated = await this.hasSession();
        this.status = {
          ...this.status,
          connected: authenticated,
          status: authenticated ? 'connected' : 'requires_reauth',
          connected_user: authenticated ? 'Conta Facebook autenticada' : undefined,
          details: authenticated ? 'Sessão ativa no perfil persistente.' : 'Perfil persistente sem sessão autenticada.'
        };
      } catch (error: any) {
        this.status = { ...this.status, connected: false, status: 'requires_reauth', details: error.message };
      }
      return this.getStatus();
    });
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
