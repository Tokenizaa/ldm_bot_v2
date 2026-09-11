import type { Page, Locator } from 'playwright';
import { storage } from './StorageService.js';
import { logger } from './LoggerService.js';
import { facebookBrowser } from './FacebookBrowserService.js';
import { facebookSession } from './FacebookSessionService.js';

export interface FacebookScheduleInput {
  groupUrl: string;
  content: string;
  affiliateUrl: string;
  scheduledDate: string;
  scheduledTime: string;
}

export interface FacebookScheduleResult {
  success: boolean;
  scheduledAt?: string;
  postUrl?: string;
  error?: string;
}

class FacebookAutomationService {
  private chain: Promise<void> = Promise.resolve();

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private log(step: string, message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
    logger.facebook('STEP=' + step + ' ' + message, level);
  }

  private editor(page: Page): Locator {
    return page.locator(
      '[role="dialog"] [data-lexical-editor="true"][contenteditable="true"]:not([aria-label*="Comente" i]),' +
      '[role="dialog"] [contenteditable="true"][role="textbox"]:not([aria-label*="Comente" i]),' +
      '[role="dialog"] [contenteditable="true"][aria-placeholder*="Escreva" i]'
    ).last();
  }

  private async goToGroup(page: Page, groupUrl: string) {
    this.log('GROUP_NAVIGATION_START', 'url=' + groupUrl);
    await page.goto(groupUrl, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    this.log('GROUP_NAVIGATION_READY', 'url=' + page.url() + ' title=' + await page.title().catch(() => ''));
  }

  private async clickCanonical(locator: Locator, step: string): Promise<void> {
    if (!(await locator.count()) || !(await locator.isVisible().catch(() => false))) {
      throw new Error(step);
    }
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    try {
      await locator.click({ timeout: 10000 });
    } catch (firstError: any) {
      this.log(step, 'normal_click_failed=' + firstError.message, 'warn');
      await locator.click({ timeout: 5000, force: true });
    }
  }

  private async openComposer(page: Page) {
    this.log('COMPOSER_SEARCH', 'procurando controle canônico');
    const trigger = page.getByRole('button', {
      name: /Escreva algo|No que você está pensando|Criar uma publicação/i
    }).first();

    await this.clickCanonical(trigger, 'FACEBOOK_COMPOSER_NOT_FOUND');
    await page.waitForTimeout(800);

    const editor = this.editor(page);
    if (!(await editor.count()) || !(await editor.isVisible().catch(() => false))) {
      throw new Error('FACEBOOK_CONTENT_FIELD_NOT_FOUND');
    }
    this.log('COMPOSER_OPENED', 'editor detectado');
  }

  private async fillComposer(page: Page, content: string) {
    const editor = this.editor(page);
    await editor.focus();
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.insertText(content);
    await page.waitForTimeout(500);
    const actual = await editor.textContent().catch(() => '');
    if (!actual || !actual.includes(content.slice(0, Math.min(40, content.length)))) {
      throw new Error('FACEBOOK_CONTENT_INPUT_FAILED');
    }
    this.log('COPY_FILLED', 'chars=' + content.length);
  }

  private async generateLinkPreview(page: Page, copy: string, affiliateUrl: string) {
    this.log('PREVIEW_START', 'inserindo URL afiliada temporariamente');
    const editor = this.editor(page);
    await this.fillComposer(page, copy.trim() + '\n' + affiliateUrl);
    await page.waitForTimeout(4500);

    const withUrl = await editor.textContent().catch(() => '');
    if (!withUrl?.includes(affiliateUrl)) {
      throw new Error('FACEBOOK_LINK_PREVIEW_NOT_CREATED');
    }

    await editor.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(800);

    const withoutUrl = await editor.textContent().catch(() => '');
    if (withoutUrl?.includes(affiliateUrl)) {
      throw new Error('FACEBOOK_LINK_NOT_REMOVED_FROM_COPY');
    }
    this.log('PREVIEW_READY', 'URL removida do texto após tentativa de preview');
  }

  private async openScheduleMenu(page: Page) {
    this.log('MORE_OPTIONS_SEARCH', 'procurando Mais opções de post');
    const button = page.getByRole('button', {
      name: /Mais opções de post|Mais opções|More options(?: for post)?/i
    }).last();

    this.log('MORE_OPTIONS_STATE', 'count=' + await button.count() + ' visible=' + await button.isVisible().catch(() => false));
    if (!(await button.count()) || !(await button.isVisible().catch(() => false))) {
      const visibleButtons = await page.getByRole('button').evaluateAll(nodes => nodes.filter(node => {
        const el = node as HTMLElement;
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      }).map(node => ((node as HTMLElement).innerText || node.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(-20)).catch(() => []);
      this.log('MORE_OPTIONS_CANDIDATES', JSON.stringify(visibleButtons));
      throw new Error('FACEBOOK_MORE_OPTIONS_NOT_FOUND');
    }

    await this.clickCanonical(button, 'FACEBOOK_MORE_OPTIONS_CLICK_FAILED');
    await page.waitForTimeout(500);
    this.log('MORE_OPTIONS_OPENED', 'menu aberto');

    const schedule = page.getByRole('menuitem', {
      name: /Programar post|Agendar post|Schedule post/i
    }).last();

    if (await schedule.count() && await schedule.isVisible().catch(() => false)) {
      await this.clickCanonical(schedule, 'FACEBOOK_SCHEDULE_OPTION_CLICK_FAILED');
    } else {
      const textOption = page.getByText(/Programar post|Agendar post|Schedule post/i).last();
      await this.clickCanonical(textOption, 'FACEBOOK_SCHEDULE_OPTION_NOT_FOUND');
    }

    await page.waitForTimeout(700);
    this.log('SCHEDULE_FORM_OPENED', 'formulário de agendamento aberto');
  }

  private async setDate(page: Page, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID');
    const field = page.locator('input[type="date"]').last();
    if (!(await field.count()) || !(await field.isVisible().catch(() => false))) {
      throw new Error('FACEBOOK_DATE_FIELD_NOT_FOUND');
    }
    await field.fill(date);
    await field.press('Tab').catch(() => undefined);
    this.log('DATE_SET', 'date=' + date);
  }

  private async setTime(page: Page, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID');
    const field = page.locator('input[type="time"]').last();
    if (!(await field.count()) || !(await field.isVisible().catch(() => false))) {
      throw new Error('FACEBOOK_TIME_FIELD_NOT_FOUND');
    }
    await field.fill(time);
    await field.press('Tab').catch(() => undefined);
    this.log('TIME_SET', 'time=' + time);
  }

  private async confirmSchedule(page: Page) {
    const dialog = page.locator('[role="dialog"]').last();
    const button = dialog.getByRole('button', {
      name: /^(Programar|Agendar|Schedule)$/i
    }).last();

    if (!(await button.count())) throw new Error('FACEBOOK_SCHEDULE_BUTTON_NOT_FOUND');
    if (await button.isDisabled().catch(() => false) || (await button.getAttribute('aria-disabled')) === 'true') {
      throw new Error('FACEBOOK_SCHEDULE_BUTTON_DISABLED');
    }

    this.log('SCHEDULE_CONFIRM_CLICK', 'botão Programar habilitado');
    await this.clickCanonical(button, 'FACEBOOK_SCHEDULE_CONFIRM_CLICK_FAILED');
    await page.waitForTimeout(2500);

    const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    const dialogs = page.locator('[role="dialog"]:visible');
    const confirmed = /agendad|programad|scheduled/.test(body) || await dialogs.count() === 0;

    if (!confirmed) throw new Error('FACEBOOK_SCHEDULE_CONFIRMATION_FAILED');
    this.log('SCHEDULE_CONFIRMED', 'Facebook confirmou o fluxo de agendamento', 'success');
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      const startedAt = Date.now();
      this.log('SCHEDULE_START', 'date=' + input.scheduledDate + ' time=' + input.scheduledTime);

      try {
        if (!input.groupUrl?.includes('/groups/')) throw new Error('FACEBOOK_GROUP_URL_INVALID');
        if (!input.affiliateUrl?.includes('/20889')) throw new Error('FACEBOOK_AFFILIATE_URL_INVALID');
        if (!input.content?.trim() || /https?:\/\//i.test(input.content) || /R\$/i.test(input.content)) {
          throw new Error('FACEBOOK_CONTENT_INVALID');
        }

        const target = new Date(input.scheduledDate + 'T' + input.scheduledTime + ':00');
        if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) {
          throw new Error('FACEBOOK_SCHEDULE_IN_PAST');
        }

        await facebookSession.requireAuthenticated();
        this.log('SESSION_OK', 'sessão existente reutilizada');

        const page = await facebookBrowser.page();
        await this.goToGroup(page, input.groupUrl);
        await this.openComposer(page);
        await this.generateLinkPreview(page, input.content, input.affiliateUrl);
        await this.openScheduleMenu(page);
        await this.setDate(page, input.scheduledDate);
        await this.setTime(page, input.scheduledTime);
        await this.confirmSchedule(page);

        const scheduledAt = target.toISOString();
        this.log('SCHEDULE_SUCCESS', 'scheduledAt=' + scheduledAt + ' durationMs=' + (Date.now() - startedAt), 'success');
        return { success: true, scheduledAt };
      } catch (error: any) {
        this.log('SCHEDULE_FAILED', 'error=' + error.message + ' durationMs=' + (Date.now() - startedAt), 'error');
        return { success: false, error: error.message };
      }
    });
  }

  async publishTest(groupUrl: string) {
    return this.serial(async () => {
      const startedAt = Date.now();
      try {
        await facebookSession.requireAuthenticated();
        const product = (await storage.getProducts(true))
          .find(p => p.active && p.affiliate_url.includes('/20889') && p.facebook_copy?.trim());

        if (!product) {
          return { success: false, message: 'Nenhum produto real com facebook_copy e afiliado /20889 disponível.' };
        }

        const generated = { content: product.facebook_copy!.trim(), affiliateUrl: product.affiliate_url };
        const page = await facebookBrowser.page();
        await this.goToGroup(page, groupUrl);
        await this.openComposer(page);
        await this.generateLinkPreview(page, generated.content, generated.affiliateUrl);

        const dialog = page.locator('[role="dialog"]').last();
        const publish = dialog.getByRole('button', { name: /^(Publicar|Postar)$/i }).last();
        if (!(await publish.count()) || await publish.isDisabled().catch(() => false)) {
          throw new Error('FACEBOOK_PUBLISH_BUTTON_NOT_READY');
        }

        await this.clickCanonical(publish, 'FACEBOOK_PUBLISH_CLICK_FAILED');
        await page.waitForTimeout(2000);
        this.log('TEST_PUBLISH_SUCCESS', 'product=' + product.id + ' durationMs=' + (Date.now() - startedAt), 'success');
        return { success: true, message: 'Teste publicado com produto ' + product.id + '.', productId: product.id };
      } catch (error: any) {
        this.log('TEST_PUBLISH_FAILED', 'error=' + error.message + ' durationMs=' + (Date.now() - startedAt), 'error');
        return { success: false, message: error.message };
      }
    });
  }

  async verifyGroup(groupUrl: string) {
    return this.serial(async () => {
      try {
        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.page();
        await this.goToGroup(page, groupUrl);
        const composer = page.getByRole('button', {
          name: /Escreva algo|No que você está pensando|Criar uma publicação/i
        }).first();
        const accessible = /\/groups\//i.test(page.url()) &&
          await composer.count() > 0 &&
          await composer.isVisible().catch(() => false);
        this.log('GROUP_VERIFY', 'accessible=' + accessible + ' url=' + page.url());
        return { accessible, message: accessible ? 'Grupo acessível e composer detectado.' : 'Grupo não validado. URL atual: ' + page.url() };
      } catch (error: any) {
        this.log('GROUP_VERIFY_FAILED', 'error=' + error.message, 'error');
        return { accessible: false, message: error.message };
      }
    });
  }
}

export const facebookAutomation = new FacebookAutomationService();
