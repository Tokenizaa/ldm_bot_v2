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
    return page.locator("[aria-label='Escreva algo...'], [aria-label='No que você está pensando?'], [aria-label='Criar publicação']").filter({ visible: true }).first();
  }

  private editor(page: Page): Locator {
    return page.locator("div[role='dialog'] [role='textbox']").last();
  }

  private isGroupPage(page: Page, groupUrl: string): boolean {
    try {
      const expected = new URL(groupUrl), actual = new URL(page.url());
      return actual.origin === expected.origin && actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '');
    } catch { return false; }
  }

  private async waitForGroupReady(page: Page, groupUrl: string) {
    const deadline = Date.now() + 20000;
    let lastUrl = page.url();
    while (Date.now() < deadline) {
      lastUrl = page.url();
      if (this.isGroupPage(page, groupUrl)) {
        const title = await page.title().catch(() => '');
        if (/A Loja Do Mecânico/i.test(title) || await page.locator('main').count() > 0) {
          this.log('GROUP_READY', `url=${lastUrl} title=${title}`);
          return;
        }
      }
      await page.waitForTimeout(1000);
    }
    throw new Error('FACEBOOK_GROUP_NOT_READY');
  }

  private async goToGroup(page: Page, groupUrl: string) {
    if (!this.isGroupPage(page, groupUrl)) {
      this.log('GROUP_NAVIGATION', 'url=' + groupUrl);
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      this.log('GROUP_REUSE', 'browser já está exatamente na página do grupo; navegação evitada');
    }
    await this.waitForGroupReady(page, groupUrl);
  }

  private async composerDiagnostics(page: Page) {
    const buttons = await page.locator('[role="button"]:visible').evaluateAll(els => els.slice(0, 60).map(el => ({
      ariaLabel: el.getAttribute('aria-label'),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    }))).catch(() => []);
    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      composerExactCount: await page.locator("[aria-label='Escreva algo...']").count().catch(() => -1),
      composerFallbackCount: await page.locator("[aria-label='No que você está pensando?'], [aria-label='Criar publicação']").count().catch(() => -1),
      dialogCount: await page.locator('[role="dialog"]:visible').count().catch(() => -1),
      bodyChars: await page.locator('body').innerText().then(t => t.length).catch(() => -1),
      visibleButtons: buttons
    };
  }

  private async waitForComposer(page: Page): Promise<Locator> {
    const deadline = Date.now() + 20000;
    this.log('COMPOSER_WAIT', 'procurando gatilho real do compositor');

    while (Date.now() < deadline) {
      const exact = page.locator("[aria-label='Escreva algo...']:visible").first();
      if (await exact.count()) {
        this.log('COMPOSER_FOUND', "selector=[aria-label='Escreva algo...']");
        return exact;
      }

      const fallback = page.locator("[aria-label='No que você está pensando?']:visible, [aria-label='Criar publicação']:visible").first();
      if (await fallback.count()) {
        this.log('COMPOSER_FOUND', 'selector=accessibility-fallback');
        return fallback;
      }

      // Facebook sometimes hydrates the composer after the initial group shell.
      await page.waitForTimeout(1000);
    }

    const diagnostic = await this.composerDiagnostics(page);
    this.log('COMPOSER_DIAGNOSTIC', JSON.stringify(diagnostic), 'warn');

    // One bounded recovery only: reload the already authenticated group page and retry hydration.
    this.log('COMPOSER_RECOVERY', 'recarregando uma vez a página do grupo para recuperar o compositor', 'warn');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.waitForGroupReady(page, page.url());

    const recovered = page.locator("[aria-label='Escreva algo...']:visible, [aria-label='No que você está pensando?']:visible, [aria-label='Criar publicação']:visible").first();
    await recovered.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    if (await recovered.count() && await recovered.isVisible().catch(() => false)) {
      this.log('COMPOSER_RECOVERED', 'compositor encontrado após recuperação');
      return recovered;
    }

    this.log('COMPOSER_DIAGNOSTIC_FINAL', JSON.stringify(await this.composerDiagnostics(page)), 'error');
    throw new Error('FACEBOOK_COMPOSER_NOT_AVAILABLE');
  }

  private async openComposer(page: Page) {
    const trigger = await this.waitForComposer(page);
    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    this.log('COMPOSER_CLICK', `aria=${await trigger.getAttribute('aria-label').catch(() => '')}`);
    await trigger.click({ timeout: 15000 });

    const dialog = page.locator("div[role='dialog']").filter({ has: page.locator('[role="textbox"]') }).last();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    const editor = this.editor(page);
    await editor.waitFor({ state: 'visible', timeout: 15000 });
    this.log('COMPOSER_OPENED', 'dialog=visible textbox=visible');
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
    this.log('PREVIEW_START', 'URL afiliada adicionada temporariamente para gerar preview');

    const previewDeadline = Date.now() + 12000;
    while (Date.now() < previewDeadline) {
      const text = await editor.textContent().catch(() => '');
      const dialogText = await page.locator('[role="dialog"]:visible').innerText().catch(() => '');
      if (text?.includes(affiliateUrl) && (dialogText.includes('Loja') || dialogText.includes('R$') || dialogText.includes('mecânico') || await page.locator('[role="dialog"]:visible img').count() > 0)) break;
      await page.waitForTimeout(1000);
    }

    if (!(await editor.textContent().catch(() => ''))?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
    await editor.fill(copy.trim());
    await page.waitForTimeout(1500);
    if ((await editor.textContent().catch(() => ''))?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_REMAINED_IN_COPY');
    this.log('PREVIEW_READY', 'preview solicitado e URL removida da copy');
  }

  private async openScheduleDirect(page: Page) {
    const button = page.locator("[aria-label='Programar post']:visible").last();
    this.log('DIRECT_SCHEDULE_WAIT', "selector=[aria-label='Programar post']");
    await button.waitFor({ state: 'visible', timeout: 15000 });
    await button.click({ timeout: 15000 });
    const scheduleUi = page.locator("[role='dialog']:visible, [role='menu']:visible").last();
    await scheduleUi.waitFor({ state: 'visible', timeout: 15000 });
    this.log('SCHEDULE_PANEL_OPENED', 'interface nativa de programação confirmada');
  }

  private async setDate(page: Page, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID');
    const target = new Date(date + 'T12:00:00-03:00');
    const label = target.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const cell = page.locator("[role='gridcell']:visible").filter({ hasText: label }).last();
    this.log('DATE_WAIT', 'label=' + label);
    await cell.waitFor({ state: 'visible', timeout: 15000 });
    await cell.click({ timeout: 15000 });
    this.log('DATE_SELECTED', 'date=' + date);
  }

  private async setTime(page: Page, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID');
    const option = page.locator("[role='option']:visible").filter({ hasText: time }).last();
    this.log('TIME_WAIT', 'time=' + time);
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click({ timeout: 15000 });
    this.log('TIME_SELECTED', 'time=' + time);
  }

  private async confirmAndVerify(page: Page, groupUrl: string, content: string) {
    const button = page.locator("[aria-label='Programar']:visible").last();
    this.log('CONFIRM_WAIT', "selector=[aria-label='Programar']");
    await button.waitFor({ state: 'visible', timeout: 15000 });
    if (await button.isDisabled().catch(() => false) || await button.getAttribute('aria-disabled') === 'true') throw new Error('FACEBOOK_SCHEDULE_CONFIRM_DISABLED');
    await button.click({ timeout: 15000 });
    this.log('SCHEDULE_CLICKED', 'confirmação nativa enviada');
    await page.waitForTimeout(2500);

    const scheduledUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
    await page.goto(scheduledUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
        const expected = new URL(groupUrl), actual = new URL(page.url());
        const title = await page.title().catch(() => '');
        const accessible = actual.origin === expected.origin && actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '') && /A Loja Do Mecânico/i.test(title);
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