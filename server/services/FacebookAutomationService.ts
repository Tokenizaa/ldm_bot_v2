import type { Page, Locator } from 'playwright';
import { logger } from './LoggerService.js';
import { facebookBrowser } from './FacebookBrowserService.js';
import { facebookSession } from './FacebookSessionService.js';

export interface FacebookScheduleInput { groupUrl: string; content: string; affiliateUrl: string; scheduledDate: string; scheduledTime: string; }
export interface FacebookScheduleResult { success: boolean; scheduledAt?: string; postUrl?: string; error?: string; }
export interface FacebookPublishInput { groupUrl: string; content: string; affiliateUrl: string; }

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

  private composer(page: Page): Locator {
    return page.locator("[aria-label='Escreva algo...']").first();
  }

  private editor(page: Page): Locator {
    return page.locator("div[role='dialog'][aria-label='Criar post'] [role='textbox']").last();
  }

  private isGroupPage(page: Page, groupUrl: string): boolean {
    try {
      const expected = new URL(groupUrl);
      const actual = new URL(page.url());
      return actual.origin === expected.origin && actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '');
    } catch { return false; }
  }

  private async goToGroup(page: Page, groupUrl: string) {
    if (this.isGroupPage(page, groupUrl)) {
      this.log('GROUP_REUSE', 'browser já está exatamente na página do grupo; navegação evitada');
      return;
    }
    this.log('GROUP_NAVIGATION', 'url=' + groupUrl);
    await page.goto(groupUrl, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(1500);
    this.log('GROUP_READY', 'url=' + page.url());
  }

  private async openComposer(page: Page) {
    const trigger = this.composer(page);
    this.log('COMPOSER_WAIT', "selector=[aria-label='Escreva algo...']");
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    await trigger.click({ timeout: 15000 });
    const editor = this.editor(page);
    await editor.waitFor({ state: 'visible', timeout: 15000 });
    this.log('COMPOSER_OPENED', "dialog=visible selector=div[role='dialog'][aria-label='Criar post'] [role='textbox']");
  }

  private async fillComposer(page: Page, content: string) {
    const editor = this.editor(page);
    await editor.fill(content);
    const actual = await editor.textContent().catch(() => '');
    if (!actual?.includes(content.slice(0, Math.min(40, content.length)))) throw new Error('FACEBOOK_CONTENT_INPUT_FAILED');
    this.log('COPY_FILLED', 'chars=' + content.length);
  }

  private async generateLinkPreview(page: Page, copy: string, affiliateUrl: string) {
    const editor = this.editor(page);
    await this.fillComposer(page, copy.trim() + '\n' + affiliateUrl);
    this.log('PREVIEW_START', 'URL afiliada adicionada temporariamente para o preview');
    await page.waitForTimeout(5000);
    if (!(await editor.textContent().catch(() => ''))?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
    await editor.fill(copy.trim());
    await page.waitForTimeout(1000);
    if ((await editor.textContent().catch(() => ''))?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_REMAINED_IN_COPY');
    this.log('PREVIEW_READY', 'preview solicitado e URL removida da copy');
  }

  private async openScheduleDirect(page: Page) {
    const button = page.locator("[aria-label='Programar post']").last();
    this.log('DIRECT_SCHEDULE_WAIT', "selector=[aria-label='Programar post']");
    await button.waitFor({ state: 'visible', timeout: 15000 });
    await button.click({ timeout: 15000 });
    await page.waitForTimeout(800);
  }

  private async setDate(page: Page, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID');
    const target = new Date(date + 'T12:00:00-03:00');
    const label = target.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const cell = page.locator("[role='gridcell']").filter({ hasText: label }).last();
    this.log('DATE_WAIT', 'label=' + label);
    await cell.waitFor({ state: 'visible', timeout: 15000 });
    await cell.click({ timeout: 15000 });
  }

  private async setTime(page: Page, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID');
    const option = page.locator("[role='option']").filter({ hasText: time }).last();
    this.log('TIME_WAIT', 'time=' + time);
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click({ timeout: 15000 });
  }

  private async confirmAndVerify(page: Page, groupUrl: string, content: string) {
    const button = page.locator("[aria-label='Programar']").last();
    this.log('CONFIRM_WAIT', "selector=[aria-label='Programar']");
    await button.waitFor({ state: 'visible', timeout: 15000 });
    if (await button.isDisabled().catch(() => false) || await button.getAttribute('aria-disabled') === 'true') throw new Error('FACEBOOK_SCHEDULE_CONFIRM_DISABLED');
    await button.click({ timeout: 15000 });
    await page.waitForTimeout(2500);

    const scheduledUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
    await page.goto(scheduledUrl, { waitUntil: 'commit', timeout: 60000 });
    await page.waitForTimeout(1800);
    const body = await page.locator('body').innerText().catch(() => '');
    const needle = content.replace(/\s+/g, ' ').trim().slice(0, 80);
    const found = body.replace(/\s+/g, ' ').includes(needle);
    this.log('FACEBOOK_PLANNER_VERIFY', 'url=' + page.url() + ' content_found=' + found);
    if (!found) throw new Error('FACEBOOK_SCHEDULE_NOT_VISIBLE_IN_PLANNER');
    return scheduledUrl;
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      const started = Date.now();
      this.log('SCHEDULE_START', `date=${input.scheduledDate} time=${input.scheduledTime}`);
      try {
        if (!input.groupUrl?.includes('/groups/')) throw new Error('FACEBOOK_GROUP_URL_INVALID');
        if (!input.affiliateUrl?.includes('/20889')) throw new Error('FACEBOOK_AFFILIATE_URL_INVALID');
        if (!input.content?.trim() || /https?:\/\//i.test(input.content) || /R\$/i.test(input.content)) throw new Error('FACEBOOK_CONTENT_INVALID');
        const target = new Date(input.scheduledDate + 'T' + input.scheduledTime + ':00-03:00');
        if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) throw new Error('FACEBOOK_SCHEDULE_IN_PAST');

        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.page();
        await this.goToGroup(page, input.groupUrl);
        await this.openComposer(page);
        await this.generateLinkPreview(page, input.content, input.affiliateUrl);
        await this.openScheduleDirect(page);
        await this.setDate(page, input.scheduledDate);
        await this.setTime(page, input.scheduledTime);
        const postUrl = await this.confirmAndVerify(page, input.groupUrl, input.content);
        const scheduledAt = target.toISOString();
        this.log('SCHEDULE_SUCCESS', 'scheduledAt=' + scheduledAt + ' durationMs=' + (Date.now() - started), 'success');
        return { success: true, scheduledAt, postUrl };
      } catch (error: any) {
        this.log('SCHEDULE_FAILED', 'error=' + error.message + ' durationMs=' + (Date.now() - started), 'error');
        return { success: false, error: error.message };
      }
    });
  }

  async publish(_input: FacebookPublishInput): Promise<FacebookScheduleResult> { return { success: false, error: 'FACEBOOK_IMMEDIATE_PUBLISH_DISABLED' }; }
  async publishTest(_groupUrl: string) { return { success: false, message: 'FACEBOOK_TEST_PUBLISH_DISABLED: use o fluxo de agendamento real.' }; }

  async verifyGroup(groupUrl: string) {
    return this.serial(async () => {
      try {
        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.page();
        await this.goToGroup(page, groupUrl);
        const expected = new URL(groupUrl);
        const actual = new URL(page.url());
        const expectedPath = expected.pathname.replace(/\/+$/, '');
        const actualPath = actual.pathname.replace(/\/+$/, '');
        const title = await page.title().catch(() => '');
        const accessible = actual.origin === expected.origin && actualPath === expectedPath && /A Loja Do Mecânico/i.test(title);
        this.log('GROUP_VERIFY', 'accessible=' + accessible + ' url=' + page.url() + ' title=' + title);
        return { accessible, message: accessible ? 'Grupo acessível.' : `Grupo não validado. url=${page.url()} title=${title}` };
      } catch (error: any) {
        this.log('GROUP_VERIFY_FAILED', 'error=' + error.message, 'error');
        return { accessible: false, message: error.message };
      }
    });
  }
}

export const facebookAutomation = new FacebookAutomationService();