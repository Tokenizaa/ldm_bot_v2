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

interface PlannerCheckResult {
  found: boolean;
  plannerUrl: string;
  snippet?: string;
  verified: boolean;
}

class FacebookAutomationService {
  private chain: Promise<void> = Promise.resolve();
  private schedulesSincePlannerVerification = 0;
  private readonly plannerVerificationInterval = 5;
  private readonly tokenActivationTimeoutMs = 5000;
  private readonly tokenStabilityPollMs = 75;
  private readonly tokenStabilityWindowMs = 250;
  private readonly tokenStabilityMaxWaitMs = 1500;
  private readonly tokenActivationDelayMs = 180;
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

  private async typeComposerText(editor: Locator, text: string) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await editor.pressSequentially(lines[i]);
      if (i < lines.length - 1) await editor.press('Enter');
    }
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

  private async waitForComposer(execId: string, page: Page, groupUrl: string) {
    const trigger = this.composer(page);
    try {
      await trigger.waitFor({ state: 'visible', timeout: 12000 });
      return trigger;
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.waitForGroupReady(execId, page, groupUrl);
      const recovered = this.composer(page);
      await recovered.waitFor({ state: 'visible', timeout: 12000 });
      return recovered;
    }
  }

  private async openComposer(execId: string, page: Page, groupUrl: string) {
    const canonical = page.locator("div[role='dialog'][aria-label='Criar post']:visible");
    if (await canonical.count().catch(() => 0)) {
      await this.editor(page).waitFor({ state: 'visible', timeout: 3000 });
      this.log(execId, 'COMPOSER_READY', 'dialog canônico já renderizado');
      return;
    }

    const trigger = await this.waitForComposer(execId, page, groupUrl);
    await trigger.click({ timeout: 4000 }).catch(async () => {
      await page.keyboard.press('Escape').catch(() => undefined);
      await trigger.click({ timeout: 4000, force: true });
    });

    const dialog = page.locator("div[role='dialog']:visible").filter({ has: page.locator('[role="textbox"]') }).last();
    await dialog.waitFor({ state: 'visible', timeout: 8000 });
    await this.editor(page).waitFor({ state: 'visible', timeout: 8000 });
    this.log(execId, 'COMPOSER_READY', 'dialog canônico aberto');
  }

  private async waitForEditorTokenStability(page: Page, token: string, maxWaitMs = this.tokenStabilityMaxWaitMs, stableMs = this.tokenStabilityWindowMs) {
    const editor = this.editor(page);
    const started = Date.now();
    let lastText = '';
    let stableSince = 0;
    while (Date.now() - started < maxWaitMs) {
      const currentText = await editor.textContent().catch(() => '') || '';
      if (!currentText.includes(token)) {
        lastText = currentText;
        stableSince = Date.now();
      } else if (currentText !== lastText) {
        lastText = currentText;
        stableSince = Date.now();
      } else if (stableSince > 0 && Date.now() - stableSince >= stableMs) {
        return;
      }
      await page.waitForTimeout(this.tokenStabilityPollMs);
    }
  }

  private async activateMentionToken(execId: string, page: Page, token: string) {
    const options = page.locator("[role='option']:visible");
    const appeared = await options.first().waitFor({ state: 'visible', timeout: this.tokenActivationTimeoutMs }).then(() => true).catch(() => false);
    if (!appeared) throw new Error(`FACEBOOK_TOKEN_OPTION_NOT_FOUND:${token}`);
    await this.waitForEditorTokenStability(page, token, 900, 120);
    await page.waitForTimeout(this.tokenActivationDelayMs);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll("[role='option']:visible").length === 0, null, { timeout: 2000 }).catch(() => undefined);
    this.log(execId, 'TOKEN_ACTIVATED', `token=${token}`);
  }

  private async activateHashtagToken(execId: string, page: Page, token: string) {
    await this.waitForEditorTokenStability(page, token, 900, 120);
    await page.waitForTimeout(this.tokenActivationDelayMs);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll("[role='option']:visible").length === 0, null, { timeout: 1500 }).catch(() => undefined);
    this.log(execId, 'TOKEN_ACTIVATED', `token=${token}`);
  }

  private async waitForAffiliatePreview(page: Page, affiliateUrl: string, maxWaitMs = this.previewFastTimeoutMs) {
    const editor = this.editor(page);
    const dialog = page.locator("[role='dialog']:visible").last();
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      const text = await editor.textContent().catch(() => '') || '';
      const hrefCount = await dialog.locator("a[href*='lojadomecanico'],a[href*='mecanico']").count().catch(() => 0);
      const previewText = await dialog.textContent().catch(() => '') || '';
      if (text.includes(affiliateUrl) || hrefCount > 0) return true;
      if (/loja do mecânico|lojadomecanico|mecânico/i.test(previewText) && hrefCount > 0) return true;
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
      if (token.toLowerCase() === '@todos') await this.activateMentionToken(execId, page, token);
      else await this.activateHashtagToken(execId, page, token);
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

    if (!ready && !await this.waitForAffiliatePreview(page, affiliateUrl, this.previewFastTimeoutMs)) {
      throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
    }
    this.log(execId, 'LINK_PREVIEW_READY', `url=${affiliateUrl}`);
  }

  private async resolveMentionTypeahead(page: Page) {
    const options = page.locator("[role='option']:visible");
    if (!await options.count().catch(() => 0)) return;
    const todos = options.filter({ hasText: /todos|todos os membros|grupo público/i }).first();
    if (await todos.count().catch(() => 0)) {
      await todos.click({ timeout: 5000 }).catch(async () => { await todos.click({ timeout: 5000, force: true }).catch(() => undefined); });
    } else {
      await page.keyboard.press('Enter').catch(() => undefined);
    }
    await page.waitForFunction(() => document.querySelectorAll("[role='option']:visible").length === 0, null, { timeout: 3000 }).catch(() => undefined);
  }

  private async openScheduleDirect(execId: string, page: Page) {
    const button = page.locator("[aria-label='Programar post']:visible").last();
    await button.waitFor({ state: 'visible', timeout: 12000 });
    await this.resolveMentionTypeahead(page);
    await button.click({ timeout: 8000 }).catch(async () => { await button.click({ timeout: this.interactionTimeoutMs, force: true }); });
    const dialog = page.locator("[role='dialog']:visible").filter({ has: page.getByRole('combobox', { name: /Abrir seletor de data/ }) }).first();
    await dialog.waitFor({ state: 'visible', timeout: 12000 });
  }

  private async openDatePicker(page: Page, trigger: Locator) {
    if (await page.locator("[role='gridcell']:visible").count().catch(() => 0) > 0) return;
    await trigger.click({ timeout: this.interactionTimeoutMs }).catch(async () => { await trigger.click({ force: true, timeout: this.interactionTimeoutMs }); });
    await page.locator("[role='gridcell']:visible").first().waitFor({ state: 'visible', timeout: this.calendarTimeoutMs });
  }

  private async setDate(execId: string, page: Page, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID');
    const target = new Date(`${date}T12:00:00-03:00`);
    if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) throw new Error('FACEBOOK_SCHEDULE_IN_PAST');

    const day = String(target.getDate());
    const year = String(target.getFullYear());
    const monthLong = target.toLocaleDateString('pt-BR', { month: 'long' });
    const monthShort = target.toLocaleDateString('pt-BR', { month: 'short' }).replace(/\.$/, '');
    const canonicalLabel = `${day} de ${monthShort} de ${year}`;

    // Canonical Facebook control: when the editable field exists, type the
    // human-readable date exactly as the native UI expects (e.g. 15 de set de 2026).
    const trigger = page.getByRole('button', { name: /Abrir seletor de data/ })
      .or(page.getByRole('combobox', { name: /Abrir seletor de data/ })).first();
    await trigger.waitFor({ state: 'visible', timeout: 8000 });

    const dialog = page.locator("[role='dialog']:visible").last();
    const inputs = dialog.locator('input:visible');
    const inputCount = await inputs.count().catch(() => 0);
    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i);
      const type = await input.getAttribute('type').catch(() => null);
      const aria = await input.getAttribute('aria-label').catch(() => '') || '';
      const placeholder = await input.getAttribute('placeholder').catch(() => '') || '';
      const value = await input.inputValue().catch(() => '');
      if (type === 'date' || /data|date/i.test(`${aria} ${placeholder}`) || /\d{1,2} de \w+ de \d{4}/i.test(value)) {
        const formats = [canonicalLabel, `${day} de ${monthLong} de ${year}`, date];
        for (const formatted of formats) {
          try {
            await input.fill(formatted);
            await page.keyboard.press('Tab').catch(() => undefined);
            await page.waitForTimeout(250);
            const resulting = await input.inputValue().catch(() => '');
            if (resulting === date || resulting.toLowerCase().includes(monthShort.toLowerCase()) || resulting.includes(day)) {
              this.log(execId, 'DATE_READY', `date=${date} input="${formatted}" mode=canonical-input`);
              return;
            }
          } catch { /* try next canonical format */ }
        }
      }
    }

    // Only if Facebook exposes no editable date field, use the already mapped gridcell.
    await this.openDatePicker(page, trigger);
    const cells = page.locator("[role='gridcell']:visible");
    const pattern = new RegExp(`\\b${day} de (?:${monthLong}|${monthShort}) de ${year}\\b`, 'i');
    const count = await cells.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const cell = cells.nth(i);
      if (await cell.getAttribute('aria-disabled').catch(() => null) === 'true') continue;
      const aria = await cell.getAttribute('aria-label').catch(() => '') || '';
      const text = await cell.innerText().catch(() => '') || '';
      if (!pattern.test(`${aria} ${text}`)) continue;
      await cell.click({ timeout: this.interactionTimeoutMs });
      this.log(execId, 'DATE_READY', `date=${date} input="${canonicalLabel}" mode=canonical-gridcell`);
      return;
    }
    throw new Error('FACEBOOK_DATE_CELL_NOT_FOUND');
  }

  private async setTime(execId: string, page: Page, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID');
    const trigger = page.getByRole('button', { name: /Abrir seletor de hora/ })
      .or(page.getByRole('combobox', { name: /Abrir seletor de hora/ })).first();
    await trigger.waitFor({ state: 'visible', timeout: 12000 });
    await trigger.click({ timeout: this.interactionTimeoutMs }).catch(async () => { await trigger.click({ force: true, timeout: this.interactionTimeoutMs }); });
    const option = page.getByRole('option', { name: time, exact: true })
      .or(page.locator("[role='option']:visible").filter({ hasText: time }).last()).first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    if (await option.getAttribute('aria-disabled').catch(() => null) === 'true') throw new Error('FACEBOOK_TIME_OPTION_NOT_FOUND');
    await option.click({ timeout: this.interactionTimeoutMs });
    this.log(execId, 'TIME_READY', `time=${time}`);
  }

  private async checkPostInPlanner(page: Page, groupUrl: string, content: string, _date: string, _time: string, productName?: string): Promise<PlannerCheckResult> {
    const plannerUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
    try {
      await page.goto(plannerUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const hasBody = await page.waitForFunction(() => !!(document.body.innerText || '').trim(), null, { timeout: 10000 }).then(() => true).catch(() => false);
      if (!hasBody) return { found: false, plannerUrl, verified: false };
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (body.length < 20) return { found: false, plannerUrl, verified: false };
      const needle = content.replace(/\s+/g, ' ').trim().slice(0, 80);
      const name = productName?.trim().slice(0, 40) || '';
      if ((needle.length > 20 && body.includes(needle)) || (name.length > 10 && body.includes(name))) return { found: true, plannerUrl, verified: true, snippet: needle };
      return { found: false, plannerUrl, verified: true };
    } catch {
      return { found: false, plannerUrl, verified: false };
    }
  }

  private async confirmAndVerify(page: Page, groupUrl: string, content: string, date: string, time: string, productName?: string) {
    const button = page.locator("[aria-label='Programar']:visible").last();
    await button.waitFor({ state: 'visible', timeout: 12000 });
    if (await button.isDisabled().catch(() => false) || await button.getAttribute('aria-disabled') === 'true') throw new Error('FACEBOOK_SCHEDULE_CONFIRM_DISABLED');
    await button.click({ timeout: this.interactionTimeoutMs });
    const plannerUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
    const shouldVerify = ++this.schedulesSincePlannerVerification >= this.plannerVerificationInterval;
    if (!shouldVerify) return { success: true, plannerUrl, submitted: true };
    this.schedulesSincePlannerVerification = 0;
    const check = await this.checkPostInPlanner(page, groupUrl, content, date, time, productName);
    if (!check.verified) return { success: false, submitted: true, uncertain: true, plannerUrl, error: 'FACEBOOK_PLANNER_UNVERIFIED' };
    if (check.found) return { success: true, plannerUrl, submitted: true };
    const recheck = await this.checkPostInPlanner(page, groupUrl, content, date, time, productName);
    if (recheck.verified && recheck.found) return { success: true, plannerUrl, submitted: true };
    if (!recheck.verified) return { success: false, submitted: true, uncertain: true, plannerUrl, error: 'FACEBOOK_PLANNER_UNVERIFIED' };
    return { success: false, submitted: true, uncertain: true, plannerUrl, error: 'FACEBOOK_CONFIRMATION_UNCERTAIN: Planner confirmou ausência.' };
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      const target = new Date(`${input.scheduledDate}T${input.scheduledTime}:00-03:00`);
      let submitted = false;
      let plannerUrl: string | undefined;
      try {
        if (!input.groupUrl?.includes('/groups/')) throw new Error('FACEBOOK_GROUP_URL_INVALID');
        if (!input.affiliateUrl?.includes('/20889')) throw new Error('FACEBOOK_AFFILIATE_URL_INVALID');
        if (!input.content?.trim() || /https?:\/\//i.test(input.content) || /R\$/i.test(input.content)) throw new Error('FACEBOOK_CONTENT_INVALID');
        if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) throw new Error('FACEBOOK_SCHEDULE_IN_PAST');

        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.closeExtraPages();
        if (input.preCheckPlanner) {
          const check = await this.checkPostInPlanner(page, input.groupUrl, input.content, input.scheduledDate, input.scheduledTime, input.productName);
          if (!check.verified) return { success: false, submitted: false, uncertain: true, plannerUrl: check.plannerUrl, error: 'FACEBOOK_PLANNER_UNVERIFIED' };
          if (check.found) return { success: true, scheduledAt: target.toISOString(), plannerUrl: check.plannerUrl, alreadyScheduled: true };
        }

        await this.goToGroup('schedule', page, input.groupUrl);
        await this.openComposer('schedule', page, input.groupUrl);
        await this.generateLinkPreview('schedule', page, input.content, input.affiliateUrl);
        await this.openScheduleDirect('schedule', page);
        await this.setDate('schedule', page, input.scheduledDate);
        await this.setTime('schedule', page, input.scheduledTime);
        const result = await this.confirmAndVerify(page, input.groupUrl, input.content, input.scheduledDate, input.scheduledTime, input.productName);
        submitted = result.submitted ?? false;
        plannerUrl = result.plannerUrl;
        if (result.success) return { success: true, scheduledAt: target.toISOString(), plannerUrl: result.plannerUrl, submitted: true };
        return { success: false, submitted: true, uncertain: true, plannerUrl, error: result.error || 'FACEBOOK_CONFIRMATION_UNCERTAIN' };
      } catch (error: any) {
        if (!submitted) {
          const page = await facebookBrowser.getOperationalPage().catch(() => null);
          if (page) {
            await page.keyboard.press('Escape').catch(() => undefined);
            await page.locator("[role='dialog']:visible").last().evaluate((el: any) => el?.remove?.()).catch(() => undefined);
          }
        }
        return { submitted, success: false, uncertain: submitted, plannerUrl, error: submitted ? `FACEBOOK_CONFIRMATION_UNCERTAIN: ${error?.message || error}` : error?.message || String(error) };
      }
    });
  }

  async checkScheduledPost(groupUrl: string, content: string, date: string, time: string, productName?: string): Promise<{ found: boolean; plannerUrl: string }> {
    return this.serial(async () => {
      await facebookSession.requireAuthenticated();
      const page = await facebookBrowser.getOperationalPage();
      const check = await this.checkPostInPlanner(page, groupUrl, content, date, time, productName);
      if (!check.verified) throw new Error('FACEBOOK_PLANNER_UNVERIFIED');
      return { found: check.found, plannerUrl: check.plannerUrl };
    });
  }

  async publish(_input: any): Promise<FacebookScheduleResult> {
    return { success: false, error: 'FACEBOOK_IMMEDIATE_PUBLISH_DISABLED' };
  }

  async publishTest(_groupUrl: string) {
    return { success: false, message: 'FACEBOOK_TEST_PUBLISH_DISABLED: use o fluxo de agendamento real.' };
  }

  async verifyGroup(groupUrl: string) {
    return this.serial(async () => {
      try {
        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.getOperationalPage();
        await this.goToGroup('verify', page, groupUrl);
        const expected = new URL(groupUrl);
        const actual = new URL(page.url());
        const title = await page.title().catch(() => '');
        const accessible = actual.origin === expected.origin && actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '') && /A Loja Do Mecânico/i.test(title);
        return { accessible, message: accessible ? 'Grupo acessível.' : `Grupo não validado. url=${page.url()} title=${title}` };
      } catch (error: any) {
        return { accessible: false, message: error?.message || String(error) };
      }
    });
  }
}

export const facebookAutomation = new FacebookAutomationService();
export default facebookAutomation;
