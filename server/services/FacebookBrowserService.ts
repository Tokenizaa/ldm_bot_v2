import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { logger } from './LoggerService.js';

/** Single owner of the persistent Facebook browser. It never logs in or resets the profile. */
export class FacebookBrowserService {
  private readonly profileDir = path.join(process.cwd(), 'data', 'browser-profiles', 'facebook');
  private context: BrowserContext | null = null;
  private startPromise: Promise<BrowserContext> | null = null;

  constructor() {
    if (!fs.existsSync(this.profileDir)) {
      throw new Error('Perfil persistente do Facebook não existe: data/browser-profiles/facebook.');
    }
  }

  async start(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.startPromise) return this.startPromise;

    this.startPromise = chromium.launchPersistentContext(this.profileDir, {
      channel: process.env.FACEBOOK_BROWSER_CHANNEL || 'chrome',
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }).then(context => {
      this.context = context;
      context.on('close', () => {
        this.context = null;
        this.startPromise = null;
        logger.facebook('Browser persistente do Facebook encerrado.', 'warn');
      });
      return context;
    }).catch(error => {
      this.startPromise = null;
      throw error;
    });

    return this.startPromise;
  }

  async page(): Promise<Page> {
    const context = await this.start();
    const existing = context.pages().find(page => !page.isClosed());
    return existing || await context.newPage();
  }

  async facebookPage(): Promise<Page> {
    const page = await this.page();
    const url = page.url();
    if (url && url !== 'about:blank' && /(^https?:\/\/)?(www\.)?facebook\.com/i.test(url)) {
      return page;
    }
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    return page;
  }

  async cookies() {
    const context = await this.start();
    return context.cookies('https://www.facebook.com');
  }

  async close(): Promise<void> {
    if (!this.context) return;
    await this.context.close();
    this.context = null;
    this.startPromise = null;
  }

  getProfileDir(): string {
    return 'data/browser-profiles/facebook';
  }
}

export const facebookBrowser = new FacebookBrowserService();
