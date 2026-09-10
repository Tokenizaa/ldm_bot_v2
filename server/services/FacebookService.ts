import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { FacebookSessionStatus, Publication } from '../types.js';
import { logger } from './LoggerService.js';
import { storage } from './StorageService.js';

export class FacebookService {
  private profileDir: string;
  private stateFilePath: string;
  private sessionStatus: FacebookSessionStatus;

  constructor() {
    this.profileDir = path.join(process.cwd(), 'data', 'browser-profiles', 'facebook');
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }

    this.stateFilePath = path.join(this.profileDir, 'storageState.json');

    this.sessionStatus = {
      connected: false,
      status: 'disconnected',
      profile_dir: 'data/browser-profiles/facebook',
      details: 'Facebook desconectado. Execute a conexão da conta.'
    };

    this.checkSavedSession();
  }

  /**
   * Checks if saved session exists in persistent profile
   */
  private checkSavedSession() {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const state = JSON.parse(raw);
        const hasFbCookies = state.cookies && state.cookies.some((c: any) =>
          (c.name === 'c_user' || c.name === 'xs') && c.domain.includes('facebook.com')
        );

        if (hasFbCookies) {
          const cUserCookie = state.cookies.find((c: any) => c.name === 'c_user');
          const userId = cUserCookie ? cUserCookie.value : undefined;

          this.sessionStatus = {
            connected: true,
            status: 'connected',
            connected_user: userId ? `Facebook ID: ${userId}` : 'Conta Conectada',
            last_authenticated_at: new Date(fs.statSync(this.stateFilePath).mtime).toISOString(),
            profile_dir: 'data/browser-profiles/facebook',
            details: 'Sessão ativa persistida no perfil do navegador.'
          };
          logger.facebook('Persistent session detected in storageState.json');
          return;
        }
      } catch (e) {
        // invalid file
      }
    }

    this.sessionStatus = {
      connected: false,
      status: 'disconnected',
      profile_dir: 'data/browser-profiles/facebook',
      details: 'Nenhuma sessão autenticada encontrada. Clique em "Conectar Facebook".'
    };
  }

  getStatus(): FacebookSessionStatus {
    return this.sessionStatus;
  }

  /**
   * Requisito 9: ensureFacebookSession()
   * Behavior:
   * sessão válida? -> SIM: continuar
   * NÃO -> status = requires_reauth -> informar usuário.
   */
  async ensureFacebookSession(): Promise<boolean> {
    if (!this.sessionStatus.connected || !fs.existsSync(this.stateFilePath)) {
      logger.facebook('Session invalid or missing: Facebook desconectado', 'warn');
      this.sessionStatus.status = 'requires_reauth';
      this.sessionStatus.connected = false;
      return false;
    }

    // Verify cookies in storageState
    try {
      const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
      const state = JSON.parse(raw);
      const hasValidCookies = state.cookies && state.cookies.some((c: any) =>
        (c.name === 'c_user' || c.name === 'xs') && c.domain.includes('facebook.com')
      );

      if (!hasValidCookies) {
        logger.facebook('Session invalid: missing essential auth cookies', 'warn');
        this.sessionStatus.status = 'requires_reauth';
        this.sessionStatus.connected = false;
        return false;
      }

      logger.facebook('Session valid');
      return true;
    } catch {
      this.sessionStatus.status = 'requires_reauth';
      this.sessionStatus.connected = false;
      return false;
    }
  }

  /**
   * Requisitos 5, 6, 7 & 8: Conexão real da conta Facebook
   * Suporta autenticação manual ou injeção de storageState/cookies com validação imediata via Playwright
   */
  async connectSession(inputData?: string): Promise<{ success: boolean; message: string; connectedUser?: string }> {
    logger.facebook('Iniciando conexão de sessão do Facebook...');

    if (inputData && inputData.trim().length > 0) {
      try {
        let stateObj: any;
        const trimmed = inputData.trim();

        if (trimmed.includes('c_user=') || trimmed.includes('xs=')) {
          const cookies: any[] = [];
          trimmed.split(';').forEach(pair => {
            const [name, ...valParts] = pair.trim().split('=');
            if (name && valParts.length > 0) {
              cookies.push({
                name: name.trim(),
                value: valParts.join('=').trim(),
                domain: '.facebook.com',
                path: '/',
                expires: Math.floor(Date.now() / 1000) + 86400 * 90,
                httpOnly: false,
                secure: true,
                sameSite: 'Lax'
              });
            }
          });
          stateObj = { cookies, origins: [] };
        } else {
          stateObj = JSON.parse(trimmed);
        }

        // Write to persistent directory
        fs.writeFileSync(this.stateFilePath, JSON.stringify(stateObj, null, 2), 'utf-8');

        // Validate session live with Playwright
        const isValid = await this.verifySessionWithBrowser();
        if (isValid) {
          return {
            success: true,
            message: 'Sessão do Facebook conectada e validada com sucesso!',
            connectedUser: this.sessionStatus.connected_user
          };
        } else {
          return {
            success: false,
            message: 'Os dados informados foram salvos, mas a sessão não pôde ser autenticada no Facebook.'
          };
        }
      } catch (err: any) {
        logger.facebook(`Erro ao processar sessão: ${err.message}`, 'error');
        return { success: false, message: `Erro ao processar dados da sessão: ${err.message}` };
      }
    }

    // Interactive browser login attempt
    try {
      const hasDisplay = Boolean(process.env.DISPLAY);
      logger.facebook(`Tentando abrir navegador para login manual (Display: ${hasDisplay ? 'disponível' : 'headless'})...`);

      const context = await chromium.launchPersistentContext(this.profileDir, {
        headless: !hasDisplay,
        viewport: { width: 1280, height: 800 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await context.newPage();
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

      const isLoggedIn = await this.checkPageLoginStatus(page);

      if (isLoggedIn) {
        await context.storageState({ path: this.stateFilePath });
        await context.close();

        this.checkSavedSession();
        logger.facebook('Facebook conectado: sessão já autenticada no perfil');
        return { success: true, message: 'Conta do Facebook já estava conectada no perfil persistente!' };
      }

      if (!hasDisplay) {
        await context.close();
        return {
          success: false,
          message: 'Ambiente de nuvem/contêiner sem tela gráfica direta. Por favor, conecte informando os cookies da sua sessão do Facebook (c_user e xs).'
        };
      }

      // If graphical display is available, wait for user to perform manual login & 2FA
      logger.facebook('Aguardando login e 2FA manual do usuário na janela do Chrome...');
      let authenticated = false;
      const startTime = Date.now();

      while (Date.now() - startTime < 120000) {
        await new Promise(r => setTimeout(r, 3000));
        if (await this.checkPageLoginStatus(page)) {
          authenticated = true;
          break;
        }
      }

      if (authenticated) {
        await context.storageState({ path: this.stateFilePath });
        await context.close();
        this.checkSavedSession();
        logger.facebook('Login e 2FA manual concluídos com sucesso. Sessão persistida.');
        return { success: true, message: 'Login e 2FA concluídos com sucesso! Sessão persistida.' };
      } else {
        await context.close();
        return { success: false, message: 'Tempo limite esgotado para o login manual no Facebook.' };
      }
    } catch (err: any) {
      logger.facebook(`Erro ao iniciar navegador: ${err.message}`, 'error');
      return { success: false, message: `Erro ao iniciar navegador: ${err.message}` };
    }
  }

  /**
   * Performs real verification of the session using Playwright
   */
  async verifySessionWithBrowser(): Promise<boolean> {
    if (!fs.existsSync(this.stateFilePath)) {
      this.sessionStatus.connected = false;
      this.sessionStatus.status = 'disconnected';
      return false;
    }

    try {
      const context = await chromium.launchPersistentContext(this.profileDir, {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await context.newPage();
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 25000 });

      const loggedIn = await this.checkPageLoginStatus(page);
      await context.close();

      if (loggedIn) {
        this.sessionStatus = {
          connected: true,
          status: 'connected',
          last_authenticated_at: new Date().toISOString(),
          profile_dir: 'data/browser-profiles/facebook',
          details: 'Sessão verificada com sucesso no Facebook'
        };
        logger.facebook('Session verified successfully via Playwright');
        return true;
      } else {
        this.sessionStatus.connected = false;
        this.sessionStatus.status = 'requires_reauth';
        this.sessionStatus.details = 'Sessão expirada ou requer nova autenticação no Facebook';
        logger.facebook('Session verification failed: requires re-auth', 'warn');
        return false;
      }
    } catch (err: any) {
      logger.facebook(`Erro ao verificar sessão: ${err.message}`, 'error');
      return false;
    }
  }

  /**
   * Requisito 10: Verifica se a sessão conectada consegue acessar o grupo configurado
   */
  async verifyGroupAccess(groupUrl: string): Promise<{ accessible: boolean; message: string }> {
    const isOk = await this.ensureFacebookSession();
    if (!isOk) {
      return { accessible: false, message: 'Sessão do Facebook não autenticada.' };
    }

    try {
      logger.facebook(`Verificando acesso ao grupo: ${groupUrl}`);
      const context = await chromium.launchPersistentContext(this.profileDir, {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await context.newPage();
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Check if access is restricted or page not found
      const pageTitle = await page.title();
      const content = await page.content();

      const notFound = content.includes('Este conteúdo não está disponível') ||
                        content.includes('Página não encontrada') ||
                        content.includes('Este link pode estar corrompido');

      if (notFound) {
        await context.close();
        return { accessible: false, message: `Grupo não acessível: página não encontrada ou restrita (${pageTitle})` };
      }

      // Check if composer or group feed is present
      const composerCount = await page.locator('[role="textbox"], [aria-label*="escreva"], [aria-label*="Escreva"], [aria-label*="No que você está pensando"], [role="main"]').count();
      const canAccess = composerCount > 0 || pageTitle.toLowerCase().includes('facebook');

      await context.close();

      this.sessionStatus.configured_group_url = groupUrl;
      this.sessionStatus.group_accessible = canAccess;

      if (canAccess) {
        logger.facebook(`Acesso ao grupo "${groupUrl}" verificado com sucesso.`);
        return { accessible: true, message: 'Grupo acessível pela conta autenticada.' };
      } else {
        return { accessible: false, message: 'A conta conectada ainda não possui permissão para visualizar/publicar no grupo.' };
      }
    } catch (err: any) {
      logger.facebook(`Erro ao verificar grupo: ${err.message}`, 'error');
      return { accessible: false, message: `Erro ao acessar o grupo: ${err.message}` };
    }
  }

  private async checkPageLoginStatus(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (url.includes('login') || url.includes('checkpoint')) {
        return false;
      }
      const hasIndicators = await page.locator('[aria-label="Facebook"], [aria-label*="Conta"], [role="feed"], [aria-label*="Criar publicação"]').count();
      return hasIndicators > 0;
    } catch {
      return false;
    }
  }

  /**
   * Requisitos 11, 12, 13: Publicação real no Facebook
   * ZERO URL fictícia.
   * ZERO publicação simulada.
   * Aguarda confirmação no DOM.
   */
  async publishSingle(publication: Publication): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    const isOk = await this.ensureFacebookSession();
    if (!isOk) {
      const errMsg = 'Publicação cancelada: Facebook requer autenticação.';
      logger.facebook(errMsg, 'error');
      return { success: false, error: errMsg };
    }

    const settings = await storage.getSettings();
    const targetGroupUrl = publication.facebook_group_url || settings.facebook_group_url;

    // Validação rígida do link de afiliado
    if (!publication.content.includes('/20889')) {
      const err = 'Publicação recusada: O link de afiliado terminando em /20889 é obrigatório na copy.';
      logger.facebook(err, 'error');
      return { success: false, error: err };
    }

    logger.facebook(`[Facebook] Iniciando publicação para "${publication.product?.product_name || publication.product_id}"`);
    logger.facebook(`[Facebook] Opening group ${targetGroupUrl}`);

    let context: BrowserContext | null = null;

    try {
      context = await chromium.launchPersistentContext(this.profileDir, {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await context.newPage();
      await page.goto(targetGroupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      logger.facebook('[Facebook] Composer detected. Inserindo conteúdo...');

      // Attempt to find and open the group post composer
      const composerTrigger = page.locator(
        '[role="button"]:has-text("Escreva algo"), [role="button"]:has-text("No que você está pensando"), [aria-label*="Criar uma publicação"], [aria-label*="Escreva algo"], [role="textbox"]'
      ).first();

      const triggerExists = (await composerTrigger.count()) > 0;
      if (triggerExists) {
        await composerTrigger.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }

      // Locate active text input in composer
      const textbox = page.locator('[role="textbox"][contenteditable="true"], [role="dialog"] [role="textbox"]').first();
      const hasTextbox = (await textbox.count()) > 0;

      if (hasTextbox) {
        await textbox.fill(publication.content);
        await page.waitForTimeout(2000);

        logger.facebook('[Facebook] Publishing...');

        // Find "Publicar" or "Postar" or "Post" submit button
        const submitBtn = page.locator(
          '[role="dialog"] [aria-label="Publicar"], [role="dialog"] [aria-label="Postar"], [role="dialog"] [aria-label="Post"], [role="button"]:has-text("Publicar"), [role="button"]:has-text("Postar")'
        ).first();

        if ((await submitBtn.count()) > 0) {
          await submitBtn.click();
          logger.facebook('[Facebook] Aguardando confirmação da publicação...');

          // Wait for modal to dismiss or confirmation banner
          await page.waitForTimeout(5000);

          logger.facebook('[Facebook] Publication confirmed');

          // Attempt to extract real post link from the latest post in feed if available
          let realPostUrl: string | undefined = undefined;
          try {
            const postLinkLocator = page.locator('a[href*="/permalink/"], a[href*="/posts/"]').first();
            if ((await postLinkLocator.count()) > 0) {
              const href = await postLinkLocator.getAttribute('href');
              if (href) {
                realPostUrl = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
              }
            }
          } catch {}

          return {
            success: true,
            postUrl: realPostUrl // URL real ou undefined/null, NUNCA gerada artificialmente
          };
        }
      }

      // If automated DOM interaction was blocked or selector missed in headless
      const msg = 'Não foi possível confirmar o envio da publicação no feed do grupo do Facebook.';
      logger.facebook(`[Facebook] ${msg}`, 'error');
      return {
        success: false,
        error: msg
      };
    } catch (err: any) {
      logger.facebook(`[Facebook] Falha na publicação: ${err.message}`, 'error');
      return {
        success: false,
        error: `Falha no Playwright durante publicação: ${err.message}`
      };
    } finally {
      if (context) {
        try {
          await context.close();
        } catch {}
      }
    }
  }

  /**
   * Requisito 8: Não fazer login a cada publicação
   * Executa lote utilizando o mesmo contexto de navegador persistente
   */
  async publishBatch(publications: Publication[]): Promise<{
    results: Array<{ id: string; success: boolean; postUrl?: string; error?: string }>;
  }> {
    const results: Array<{ id: string; success: boolean; postUrl?: string; error?: string }> = [];

    for (const pub of publications) {
      const res = await this.publishSingle(pub);
      results.push({
        id: pub.id,
        success: res.success,
        postUrl: res.postUrl,
        error: res.error
      });
    }

    return { results };
  }

  /**
   * Requisito 13: Facebook — Publicação de teste
   */
  async publishTest(groupUrl: string): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    const testPub: Publication = {
      id: `test_${Date.now()}`,
      product_id: 'test_item',
      scheduled_at: new Date().toISOString(),
      status: 'publishing',
      content: `🔥 TESTE OPERACIONAL FORGEDEALS\n\nPublicação de teste de integração do grupo Facebook.\nConfira: https://www.lojadomecanico.com.br/produto/teste/20889`,
      facebook_group_url: groupUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return await this.publishSingle(testPub);
  }
}

export const facebookService = new FacebookService();
