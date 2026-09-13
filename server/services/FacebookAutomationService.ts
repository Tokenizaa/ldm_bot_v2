import type { Page, Locator } from 'playwright';
import { logger } from './LoggerService.js';
import { facebookBrowser } from './FacebookBrowserService.js';
import { facebookSession } from './FacebookSessionService.js';

export interface FacebookScheduleInput {
  groupUrl: string;
  content: string;
  affiliateUrl: string;
  scheduledDate: string;
  scheduledTime: string;
  productName?: string;
  sku?: string;
  preCheckPlanner?: boolean;
}

export interface FacebookScheduleResult {
  success: boolean;
  scheduledAt?: string;
  postUrl?: string;
  plannerUrl?: string;
  submitted?: boolean;
  uncertain?: boolean;
  alreadyScheduled?: boolean;
  error?: string;
}

class FacebookAutomationService {
  private chain: Promise<void> = Promise.resolve();
  private readonly tokenActivationTimeoutMs = 5000;
  private readonly tokenStabilityPollMs = 75;
  private readonly tokenStabilityWindowMs = 250;
  private readonly tokenStabilityMaxWaitMs = 1500;
  private readonly tokenActivationDelayMs = 1200;
  private readonly previewTimeoutMs = 12000;
  private readonly previewFastTimeoutMs = 4000;
  private readonly calendarTimeoutMs = 10000;
  private readonly interactionTimeoutMs = 10000;

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private log(execId: string, step: string, message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
    logger.facebook(`[${execId}] STEP=${step} ${message}`, level);
  }

  private composer(page: Page): Locator {
    return page.locator("[aria-label='Escreva algo...']:visible,[aria-label='No que você está pensando?']:visible,[aria-label='Criar publicação']:visible")
      .or(page.locator('[role="button"]:visible').filter({ hasText: /Escreva algo|No que você está pensando|Criar publicação/ })).first();
  }

  private editor(page: Page): Locator {
    return page.locator('[role="dialog"] [data-lexical-editor="true"][contenteditable="true"]:not([aria-label*="Comente" i]),[role="dialog"] [contenteditable="true"][role="textbox"]:not([aria-label*="Comente" i]),div[role="dialog"] [role="textbox"]').first();
  }

  private isGroupPage(page: Page, groupUrl: string) {
    try {
      const expected = new URL(groupUrl);
      const actual = new URL(page.url());
      return actual.origin === expected.origin && actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '');
    } catch { return false; }
  }

  private async waitForGroupReady(execId: string, page: Page, groupUrl: string) {
    if (!this.isGroupPage(page, groupUrl)) {
      const expected = new URL(groupUrl);
      await page.waitForFunction(({ origin, pathname }) =>
        window.location.origin === origin &&
        window.location.pathname.replace(/\/+$/, '') === pathname &&
        (/A Loja Do Mecânico/i.test(document.title) || !!document.querySelector('main')),
        { origin: expected.origin, pathname: expected.pathname.replace(/\/+$/, '') },
        { timeout: 20000 }
      ).catch(() => { throw new Error('FACEBOOK_GROUP_NOT_READY'); });
    }
    this.log(execId, 'GROUP_READY', `url=${page.url()} title=${await page.title().catch(() => '')}`);
  }

  private async goToGroup(execId: string, page: Page, groupUrl: string) {
    if (!this.isGroupPage(page, groupUrl)) {
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await this.waitForGroupReady(execId, page, groupUrl);
  }

  private async closeResidualDialogs(page: Page) {
    const dialogs = page.locator("div[role='dialog']:visible");
    const count = await dialogs.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i--) {
      const dialog = dialogs.nth(i);
      const label = await dialog.getAttribute('aria-label').catch(() => '');
      if (label !== 'Criar post') {
        await page.keyboard.press('Escape').catch(() => undefined);
        break;
      }
    }
  }

  private async cleanupFailedSchedule(page: Page) {
    // A failed native Facebook step can leave the composer/dialog covering the group.
    // Close only the visible dialogs; successful scheduling closes the composer itself.
    for (let i = 0; i < 3; i++) {
      const visibleDialogs = await page.locator("div[role='dialog']:visible").count().catch(() => 0);
      if (!visibleDialogs) return;
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }

  private async openComposer(execId: string, page: Page, groupUrl: string) {
    const canonical = page.locator("div[role='dialog'][aria-label='Criar post']:visible");
    if (await canonical.count().catch(() => 0)) {
      await this.editor(page).waitFor({ state: 'visible', timeout: 5000 });
      this.log(execId, 'COMPOSER_READY', 'dialog canônico já renderizado');
      return;
    }
    await this.closeResidualDialogs(page);
    const trigger = this.composer(page);
    await trigger.waitFor({ state: 'visible', timeout: 12000 });
    await trigger.click({ timeout: this.interactionTimeoutMs });
    await page.locator("div[role='dialog'][aria-label='Criar post']:visible").waitFor({ state: 'visible', timeout: 12000 });
    await this.editor(page).waitFor({ state: 'visible', timeout: 12000 });
    this.log(execId, 'COMPOSER_READY', 'dialog canônico aberto');
  }

  private async waitForEditorStable(page: Page, token: string) {
    const editor = this.editor(page);
    const started = Date.now();
    let previous = '';
    let stableSince = 0;
    while (Date.now() - started < this.tokenStabilityMaxWaitMs) {
      const current = await editor.textContent().catch(() => '') || '';
      if (current !== previous) {
        previous = current;
        stableSince = Date.now();
      } else if (current.includes(token) && stableSince && Date.now() - stableSince >= this.tokenStabilityWindowMs) {
        return;
      }
      await page.waitForTimeout(this.tokenStabilityPollMs);
    }
    if (!(await editor.textContent().catch(() => '') || '').includes(token)) {
      throw new Error(`FACEBOOK_TOKEN_NOT_RENDERED:${token}`);
    }
  }

  private async waitForVisibleOptionsToClose(page: Page, timeoutMs: number) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const visibleOptions = await page.locator("[role='option']:visible").count().catch(() => 0);
      if (visibleOptions === 0) return;
      await page.waitForTimeout(100);
    }
  }

  private async activateToken(execId: string, page: Page, token: string, requireOption: boolean) {
    const options = page.locator("[role='option']:visible");
    if (requireOption) await options.first().waitFor({ state: 'visible', timeout: this.tokenActivationTimeoutMs });
    await this.waitForEditorStable(page, token);
    await page.waitForTimeout(this.tokenActivationDelayMs);
    const editor = this.editor(page);
    await editor.click({ position: { x: 4, y: 4 } });
    await editor.press('End').catch(() => undefined);
    await page.keyboard.press('Enter');
    if (requireOption) await this.waitForVisibleOptionsToClose(page, 3000);
    this.log(execId, 'TOKEN_ACTIVATED', `token=${token} delayMs=${this.tokenActivationDelayMs}`);
  }

  private async typeComposerText(editor: Locator, text: string) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await editor.pressSequentially(lines[i]);
      if (i < lines.length - 1) await editor.press('Enter');
    }
  }

  private async waitForAffiliatePreview(page: Page, affiliateUrl: string, maxWaitMs = this.previewFastTimeoutMs) {
    const editor = this.editor(page);
    const dialog = page.locator("div[role='dialog'][aria-label='Criar post']:visible");
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      const text = await editor.textContent().catch(() => '') || '';
      const hrefCount = await dialog.locator("a[href*='lojadomecanico'],a[href*='mecanico']").count().catch(() => 0);
      if (text.includes(affiliateUrl) || hrefCount > 0) return true;
      await page.waitForTimeout(150);
    }
    return false;
  }

  private async generateLinkPreview(execId: string, page: Page, copy: string, affiliateUrl: string) {
    const editor = this.editor(page);
    const finalText = copy.trim() + '\n\n' + affiliateUrl;
    await editor.click();
    await editor.fill('');
    const tokenPattern = /(@todos|#[\p{L}\p{N}_]+)/gu;
    let last = 0;
    for (const match of finalText.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      const plain = finalText.slice(last, index);
      if (plain) await this.typeComposerText(editor, plain);
      const token = match[0];
      await editor.pressSequentially(token);
      await this.activateToken(execId, page, token, token.toLowerCase() === '@todos');
      last = index + token.length;
    }
    const tail = finalText.slice(last);
    if (tail) {
      await this.typeComposerText(editor, tail);
      if (tail.trim() === affiliateUrl) {
        this.log(execId, 'LINK_TYPED', `url=${affiliateUrl}`);
        await page.waitForTimeout(500);
        await editor.press('Space');
        if (!await this.waitForAffiliatePreview(page, affiliateUrl)) throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
      }
    }
    const ready = await page.waitForFunction(url => {
      const dialogs = [...document.querySelectorAll("[role='dialog']")];
      const dialog = dialogs.at(-1);
      if (!dialog) return false;
      const textbox = dialog.querySelector('[role="textbox"]');
      const text = textbox?.textContent || '';
      const links = dialog.querySelectorAll("a[href*='lojadomecanico'],a[href*='mecanico']").length;
      const body = dialog.textContent || '';
      return text.includes(url) || links > 0 || (/loja do mecânico|lojadomecanico|mecânico/i.test(body) && dialog.querySelectorAll('img').length > 0);
    }, affiliateUrl, { timeout: this.previewTimeoutMs }).catch(() => false);
    if (!ready && !await this.waitForAffiliatePreview(page, affiliateUrl, this.previewFastTimeoutMs)) throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
    this.log(execId, 'LINK_PREVIEW_READY', `url=${affiliateUrl}`);
  }

  private async openScheduleDirect(execId: string, page: Page) {
    const button = page.locator("[aria-label='Programar post']:visible").last();
    await button.waitFor({ state: 'visible', timeout: 12000 });
    const options = page.locator("[role='option']:visible");
    if (await options.count().catch(() => 0)) {
      await page.keyboard.press('Enter');
      await this.waitForVisibleOptionsToClose(page, 3000);
    }
    await button.click({ timeout: this.interactionTimeoutMs });
    const dialog = page.locator("[role='dialog']:visible").filter({ has: page.getByRole('combobox', { name: /Abrir seletor de data/ }) }).first();
    await dialog.waitFor({ state: 'visible', timeout: 12000 });
  }

  private async setDate(execId: string, page: Page, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID');
    const target = new Date(`${date}T12:00:00-03:00`);
    if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) throw new Error('FACEBOOK_SCHEDULE_IN_PAST');
    const day = String(target.getDate());
    const monthLong = target.toLocaleDateString('pt-BR', { month: 'long' });
    const year = String(target.getFullYear());
    // Facebook exposes the complete date through the gridcell accessible name.
    // Use a real RegExp whitespace escape; do not double-escape it.
    const datePattern = new RegExp(`(?:domingo|segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado),?\s*${day} de ${monthLong} de ${year}`, 'i');
    const cell = page.getByRole('gridcell', { name: datePattern }).first();
    await cell.waitFor({ state: 'visible', timeout: this.calendarTimeoutMs });
    await cell.click({ timeout: this.interactionTimeoutMs });
    this.log(execId, 'DATE_READY', `date=${date} mode=canonical-gridcell`);
  }

  private async setTime(execId: string, page: Page, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID');
    const option = page.locator("[role='option']:visible").filter({ hasText: time }).first();
    await option.waitFor({ state: 'visible', timeout: this.calendarTimeoutMs });
    await option.click({ timeout: this.interactionTimeoutMs });
    this.log(execId, 'TIME_READY', `time=${time}`);
  }

  private async confirmSchedule(execId: string, page: Page) {
    const button = page.locator("[aria-label='Programar']:visible").last();
    await button.waitFor({ state: 'visible', timeout: 12000 });
    await button.click({ timeout: this.interactionTimeoutMs });
    await page.locator("div[role='dialog'][aria-label='Criar post']:visible").waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
    this.log(execId, 'SCHEDULE_CONFIRMED', 'Programar confirmado pelo fluxo canônico', 'success');
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      const execId = 'schedule';
      const page = await facebookBrowser.getOperationalPage();
      try {
        await facebookSession.requireAuthenticated();
        await this.goToGroup(execId, page, input.groupUrl);
        await this.openComposer(execId, page, input.groupUrl);
        await this.generateLinkPreview(execId, page, input.content, input.affiliateUrl);
        await this.openScheduleDirect(execId, page);
        await this.setDate(execId, page, input.scheduledDate);
        await this.setTime(execId, page, input.scheduledTime);
        await this.confirmSchedule(execId, page);
        return { success: true, scheduledAt: `${input.scheduledDate}T${input.scheduledTime}`, submitted: true };
      } catch (error: any) {
        await this.cleanupFailedSchedule(page).catch(() => undefined);
        return { success: false, error: error?.message || String(error) };
      }
    });
  }
}

export const facebookAutomation = new FacebookAutomationService();