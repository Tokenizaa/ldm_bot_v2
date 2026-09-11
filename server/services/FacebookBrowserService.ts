import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { logger } from './LoggerService.js';

/** Single owner of the persistent Facebook browser: one context and one operational page. */
export class FacebookBrowserService {
  private readonly profileDir = path.join(process.cwd(), 'data', 'browser-profiles', 'facebook');
  private context: BrowserContext | null = null;
  private startPromise: Promise<BrowserContext> | null = null;
  private operationalPage: Page | null = null;

  constructor() {
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }
  }

  async start(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.startPromise) return this.startPromise;

    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }

    const isHeadless = process.env.HEADLESS !== 'false' && !process.env.DISPLAY;
    const launchOptions: any = {
      headless: isHeadless,
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };

    if (process.env.FACEBOOK_BROWSER_CHANNEL) {
      launchOptions.channel = process.env.FACEBOOK_BROWSER_CHANNEL;
    }

    this.startPromise = (async () => {
      try {
        const context = await chromium.launchPersistentContext(this.profileDir, launchOptions);
        this.context = context;
        this.setupContext(context);
        return context;
      } catch (err: any) {
        // If channel specified failed, retry once without channel
        if (launchOptions.channel) {
          logger.facebook(`Falha com channel=${launchOptions.channel}, tentando chromium padrão: ${err.message}`, 'warn');
          delete launchOptions.channel;
          const context = await chromium.launchPersistentContext(this.profileDir, launchOptions);
          this.context = context;
          this.setupContext(context);
          return context;
        }
        this.startPromise = null;
        throw err;
      }
    })();

    return this.startPromise;
  }

  private setupContext(context: BrowserContext): void {
    // Obtain and set the single initial operational page
    const available = context.pages().filter(p => !p.isClosed());
    const initialPage = available[0] || null;
    if (initialPage) {
      this.operationalPage = initialPage;
      this.bindPageEvents(initialPage);
      // Close any extraneous pages opened at browser start
      for (const extra of available.slice(1)) {
        extra.close().catch(() => undefined);
      }
    }

    // Intercept any auxiliary/popup tabs and close them immediately
    context.on('page', async (newPage) => {
      if (this.operationalPage && newPage !== this.operationalPage && !newPage.isClosed()) {
        logger.facebook(`Popup ou aba secundária interceptada (${newPage.url()}). Fechando para manter aba operacional única.`);
        await newPage.close().catch(() => undefined);
        if (this.operationalPage && !this.operationalPage.isClosed()) {
          await this.operationalPage.bringToFront().catch(() => undefined);
        }
      }
    });

    context.on('close', () => {
      this.context = null;
      this.startPromise = null;
      this.operationalPage = null;
      logger.facebook('Browser persistente do Facebook encerrado.', 'warn');
    });
  }

  private bindPageEvents(page: Page): void {
    page.on('close', () => {
      if (this.operationalPage === page) {
        this.operationalPage = null;
        logger.facebook('operationalPage fechada. Referência limpa.', 'warn');
      }
    });

    page.on('crash', () => {
      if (this.operationalPage === page) {
        this.operationalPage = null;
        logger.facebook('operationalPage sofreu crash. Referência limpa.', 'error');
      }
    });
  }

  /**
   * Explicitly manages and returns the single, validated operational page.
   * Ensures all automation and session checks interact with the exact same tab.
   */
  async getOperationalPage(): Promise<Page> {
    const context = await this.start();

    // 1. If operationalPage is already assigned and not closed, verify responsiveness
    if (this.operationalPage && !this.operationalPage.isClosed()) {
      try {
        await this.operationalPage.evaluate(() => document.readyState);

        // Close any auxiliary tabs that may have opened accidentally (popups, redirects)
        const otherPages = context.pages().filter(p => p !== this.operationalPage && !p.isClosed());
        for (const extra of otherPages) {
          await extra.close().catch(() => undefined);
        }

        await this.operationalPage.bringToFront().catch(() => undefined);
        return this.operationalPage;
      } catch (err: any) {
        logger.facebook(`operationalPage não respondeu (${err.message}). Recriando referência.`, 'warn');
        this.operationalPage = null;
      }
    }

    // 2. Obtain primary page from context or create a new one
    const availablePages = context.pages().filter(p => !p.isClosed());
    const page = availablePages[0] || await context.newPage();
    this.operationalPage = page;
    this.bindPageEvents(page);

    // Close any extraneous tabs in the context
    for (const extra of availablePages.slice(1)) {
      await extra.close().catch(() => undefined);
    }

    await page.bringToFront().catch(() => undefined);
    return page;
  }

  /**
   * Alias for backward compatibility that returns the validated operationalPage.
   */
  async page(): Promise<Page> {
    return this.getOperationalPage();
  }

  /**
   * Explicitly sets the operational page reference.
   */
  setOperationalPage(page: Page): void {
    this.operationalPage = page;
  }

  /**
   * Safely closes and resets the operational page reference.
   */
  async resetOperationalPage(): Promise<void> {
    if (this.operationalPage && !this.operationalPage.isClosed()) {
      await this.operationalPage.close().catch(() => undefined);
    }
    this.operationalPage = null;
  }

  async cookies() {
    const context = await this.start();
    return context.cookies('https://www.facebook.com');
  }

  async close(): Promise<void> {
    if (!this.context) return;
    this.operationalPage = null;
    await this.context.close();
    this.context = null;
    this.startPromise = null;
  }

  getProfileDir(): string {
    return 'data/browser-profiles/facebook';
  }
}

export const facebookBrowser = new FacebookBrowserService();