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

export interface FacebookPublishInput {
  groupUrl: string;
  content: string;
  affiliateUrl: string;
}

class FacebookAutomationService {
  private chain: Promise<void> = Promise.resolve();

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private log(step: string, message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
    logger.facebook(`STEP=${step} ${message}`, level);
  }

  private editor(page: Page): Locator {
    return page.locator(
      '[role="dialog"] [data-lexical-editor="true"][contenteditable="true"],' +
      '[role="dialog"] [contenteditable="true"][role="textbox"],' +
      '[role="dialog"] [contenteditable="true"][aria-placeholder*="Escreva" i]'
    ).last();
  }

  private async goToGroup(page: Page, groupUrl: string) {
    const current = page.url();
    if (current.startsWith(groupUrl)) {
      this.log('GROUP_REUSE', 'browser já está no grupo; navegação evitada');
      return;
    }
    this.log('GROUP_NAVIGATION', 'url=' + groupUrl);
    await page.goto(groupUrl, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(1200);
    this.log('GROUP_READY', 'url=' + page.url() + ' title=' + await page.title().catch(() => ''));
  }

  private async clickCanonical(locator: Locator, step: string): Promise<void> {
    if (!(await locator.count()) || !(await locator.isVisible().catch(() => false))) throw new Error(step);
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await locator.click({ timeout: 15000 });
  }

  private async openComposer(page: Page) {
    const trigger = page.locator('[aria-label="Escreva algo..."]').first();
    this.log('COMPOSER_SEARCH', 'count=' + await trigger.count());
    await this.clickCanonical(trigger, 'FACEBOOK_COMPOSER_NOT_FOUND');
    await page.waitForTimeout(700);
    const editor = this.editor(page);
    if (!(await editor.count()) || !await editor.isVisible().catch(() => false)) throw new Error('FACEBOOK_CONTENT_FIELD_NOT_FOUND');
    this.log('COMPOSER_OPENED', 'dialog=visible');
  }

  private async fillComposer(page: Page, content: string) {
    const editor = this.editor(page);
    await editor.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(content);
    await page.waitForTimeout(500);
    const actual = await editor.textContent().catch(() => '');
    if (!actual?.includes(content.slice(0, Math.min(40, content.length)))) throw new Error('FACEBOOK_CONTENT_INPUT_FAILED');
    this.log('COPY_FILLED', 'chars=' + content.length);
  }

  private async generateLinkPreview(page: Page, copy: string, affiliateUrl: string) {
    const editor = this.editor(page);
    this.log('PREVIEW_START', 'URL afiliada adicionada temporariamente para o preview');
    await this.fillComposer(page, copy.trim() + '\n' + affiliateUrl);
    await page.waitForTimeout(5000);
    const text = await editor.textContent().catch(() => '');
    if (!text?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');

    // Remove only the URL line; the URL is never part of the final copy.
    await editor.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(1000);
    const clean = await editor.textContent().catch(() => '');
    if (clean?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_REMAINED_IN_COPY');
    this.log('PREVIEW_READY', 'preview solicitado e URL removida da copy');
  }

  private async openScheduleDirect(page: Page) {
    const dialog = page.locator('[role="dialog"][aria-label="Criar post"]').last();
    const scheduleButton = dialog.locator('[aria-label="Programar post"]').last();
    const publishButton = dialog.locator('[aria-label="Postar"]').last();

    this.log('DIRECT_SCHEDULE_SEARCH',
      'schedule=' + await scheduleButton.count() +
      ' publish=' + await publishButton.count() +
      ' more_options_clicked=false'
    );

    if (!(await scheduleButton.count()) || !await scheduleButton.isVisible().catch(() => false)) {
      const candidates = await dialog.getByRole('button').evaluateAll(nodes => nodes.map(node => ({
        ariaLabel: node.getAttribute('aria-label'),
        text: ((node as HTMLElement).innerText || '').trim(),
        disabled: (node as HTMLButtonElement).disabled,
        visible: !!node.getClientRects().length
      }))).catch(() => []);
      this.log('DIRECT_SCHEDULE_CANDIDATES', JSON.stringify(candidates), 'error');
      throw new Error('FACEBOOK_SCHEDULE_DIRECT_BUTTON_NOT_FOUND');
    }

    this.log('DIRECT_SCHEDULE_READY',
      'schedule_aria=' + await scheduleButton.getAttribute('aria-label') +
      ' publish_aria=' + await publishButton.getAttribute('aria-label').catch(() => null)
    );
    await this.clickCanonical(scheduleButton, 'FACEBOOK_SCHEDULE_DIRECT_BUTTON_CLICK_FAILED');
    await page.waitForTimeout(800);
  }

  private async setDate(page: Page, date: string) {
    const target = new Date(date + 'T12:00:00-03:00');
    const label = target.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const dialog = page.locator('[role="dialog"]').last();
    const cell = dialog.getByRole('gridcell', { name: label, exact: true }).last();
    this.log('DATE_SEARCH', 'label=' + label + ' count=' + await cell.count());
    if (!(await cell.count()) || !await cell.isVisible().catch(() => false)) throw new Error('FACEBOOK_DATE_CELL_NOT_FOUND');
    await this.clickCanonical(cell, 'FACEBOOK_DATE_CLICK_FAILED');
    this.log('DATE_SET', date);
  }

  private async setTime(page: Page, time: string) {
    const dialog = page.locator('[role="dialog"]').last();
    const option = dialog.getByRole('option', { name: time, exact: true }).last();
    this.log('TIME_SEARCH', 'time=' + time + ' count=' + await option.count());
    if (!(await option.count()) || !await option.isVisible().catch(() => false)) throw new Error('FACEBOOK_TIME_OPTION_NOT_FOUND');
    await this.clickCanonical(option, 'FACEBOOK_TIME_CLICK_FAILED');
    this.log('TIME_SET', time);
  }

  private async confirmAndVerify(page: Page, content: string) {
    const dialog = page.locator('[role="dialog"]').last();
    const button = dialog.locator('[aria-label="Programar"]').last();
    this.log('CONFIRM_SEARCH', 'count=' + await button.count());
    if (!(await button.count()) || !await button.isVisible().catch(() => false)) throw new Error('FACEBOOK_SCHEDULE_CONFIRM_NOT_FOUND');
    if (await button.isDisabled().catch(() => false) || await button.getAttribute('aria-disabled') === 'true') throw new Error('FACEBOOK_SCHEDULE_CONFIRM_DISABLED');

    await this.clickCanonical(button, 'FACEBOOK_SCHEDULE_CONFIRM_CLICK_FAILED');
    this.log('CONFIRM_CLICKED', 'aguardando confirmação real do Facebook');
    await page.waitForTimeout(2500);

    const scheduledUrl = page.url().includes('/scheduled_posts')
      ? page.url()
      : 'https://www.facebook.com/groups/tokeniza/scheduled_posts';

    await page.goto(scheduledUrl, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(1800);

    const body = await page.locator('body').innerText().catch(() => '');
    const needle = content.replace(/\s+/g, ' ').trim().slice(0, 80);
    const found = body.replace(/\s+/g, ' ').includes(needle);
    this.log('FACEBOOK_PLANNER_VERIFY', 'url=' + page.url() + ' content_found=' + found);

    if (!found) throw new Error('FACEBOOK_SCHEDULE_NOT_VISIBLE_IN_PLANNER');

    const postUrl = await page.locator('a[href*="/groups/tokeniza/"]').filter({ hasText: needle }).first().getAttribute('href').catch(() => null);
    return postUrl || undefined;
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      const started = Date.now();
      this.log('SCHEDULE_START', `date=${input.scheduledDate} time=${input.scheduledTime}`);
      try {
        if (!input.groupUrl?.includes('/groups/')) throw new Error('FACEBOOK_GROUP_URL_INVALID');
        if (!input.affiliateUrl?.includes('/20889')) throw new Error('FACEBOOK_AFFILIATE_URL_INVALID');
        if (!input.content?.trim() || /https?:\/\/i.test(input.content) || /R\$/i.test(input.content)) throw new Error('FACEBOOK_CONTENT_INVALID');

        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.page();
        await this.goToGroup(page, input.groupUrl);
        await this.openComposer(page);
        await this.generateLinkPreview(page, input.content, input.affiliateUrl);
        await this.openScheduleDirect(page);
        await this.setDate(page, input.scheduledDate);
        await this.setTime(page, input.scheduledTime);
        const postUrl = await this.confirmAndVerify(page, input.content);

        const scheduledAt = new Date(input.scheduledDate + 'T' + input.scheduledTime + ':00-03:00').toISOString();
        this.log('SCHEDULE_SUCCESS', 'scheduledAt=' + scheduledAt + ' durationMs=' + (Date.now() - started), 'success');
        return { success: true, scheduledAt, postUrl };
      } catch (error: any) {
        this.log('SCHEDULE_FAILED', 'error=' + error.message + ' durationMs=' + (Date.now() - started), 'error');
        return { success: false, error: error.message };
      }
    });
  }

  async publish(_input: FacebookPublishInput): Promise<FacebookScheduleResult> {
    return { success: false, error: 'FACEBOOK_IMMEDIATE_PUBLISH_DISABLED' };
  }

  async publishTest(_groupUrl: string) {
    return { success: false, message: 'FACEBOOK_TEST_PUBLISH_DISABLED: use o fluxo de agendamento real.' };
  }

  async verifyGroup(groupUrl: string) {
    return this.serial(async () => {
      try {
        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.page();
        await this.goToGroup(page, groupUrl);
        const composer = page.locator('[aria-label="Escreva algo..."]').first();
        const accessible = await composer.count() > 0 && await composer.isVisible().catch(() => false);
        this.log('GROUP_VERIFY', 'accessible=' + accessible + ' url=' + page.url());
        return { accessible, message: accessible ? 'Grupo acessível e composer detectado.' : 'Grupo não validado.' };
      } catch (error: any) {
        this.log('GROUP_VERIFY_FAILED', 'error=' + error.message, 'error');
        return { accessible: false, message: error.message };
      }
    });
  }
}

export const facebookAutomation = new FacebookAutomationService();
