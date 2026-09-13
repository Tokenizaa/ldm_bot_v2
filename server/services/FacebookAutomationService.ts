import crypto from 'crypto';
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
  private readonly previewTimeoutMs = 12000;

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
    return page.locator("[aria-label='Escreva algo...']:visible, [aria-label='No que você está pensando?']:visible, [aria-label='Criar publicação']:visible")
      .or(page.locator('[role="button"]:visible').filter({ hasText: /Escreva algo|No que você está pensando|Criar publicação/ })).first();
  }

  private editor(page: Page): Locator {
    return page.locator('[role="dialog"] [data-lexical-editor="true"][contenteditable="true"]:not([aria-label*="Comente" i]), [role="dialog"] [contenteditable="true"][role="textbox"]:not([aria-label*="Comente" i]), div[role="dialog"] [role="textbox"]').first();
  }

  private isGroupPage(page: Page, groupUrl: string): boolean {
    try {
      const expected = new URL(groupUrl), actual = new URL(page.url());
      return actual.origin === expected.origin && actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '');
    } catch { return false; }
  }

  private async waitForGroupReady(execId: string, page: Page, groupUrl: string) {
    if (!this.isGroupPage(page, groupUrl)) {
      const expected = new URL(groupUrl);
      await page.waitForFunction(({ origin, pathname }) => {
        const samePath = window.location.origin === origin && window.location.pathname.replace(/\/+$/, '') === pathname;
        return samePath && (/A Loja Do Mecânico/i.test(document.title) || !!document.querySelector('main'));
      }, { origin: expected.origin, pathname: expected.pathname.replace(/\/+$/, '') }, { timeout: 20000 }).catch(() => { throw new Error('FACEBOOK_GROUP_NOT_READY'); });
    }
    this.log(execId, 'GROUP_READY', `url=${page.url()} title=${await page.title().catch(() => '')}`);
  }

  private async goToGroup(execId: string, page: Page, groupUrl: string) {
    if (!this.isGroupPage(page, groupUrl)) {
      this.log(execId, 'GROUP_NAVIGATION', 'url=' + groupUrl);
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      this.log(execId, 'GROUP_REUSE', 'browser já está exatamente na página do grupo; navegação evitada');
    }
    await this.waitForGroupReady(execId, page, groupUrl);
  }

  private async composerDiagnostics(page: Page) {
    const buttons = await page.locator('[role="button"]:visible').evaluateAll(els => els.slice(0, 60).map(el => ({ ariaLabel: el.getAttribute('aria-label'), text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) }))).catch(() => []);
    return { url: page.url(), title: await page.title().catch(() => ''), composerExactCount: await page.locator("[aria-label='Escreva algo...']").count().catch(() => -1), composerFallbackCount: await page.locator("[aria-label='No que você está pensando?'], [aria-label='Criar publicação']").count().catch(() => -1), dialogCount: await page.locator('[role="dialog"]:visible').count().catch(() => -1), bodyChars: await page.locator('body').innerText().then(t => t.length).catch(() => -1), visibleButtons: buttons };
  }

  private async waitForComposer(execId: string, page: Page, groupUrl: string): Promise<Locator> {
    this.log(execId, 'COMPOSER_WAIT', 'procurando gatilho real do compositor');
    const trigger = this.composer(page);
    try { await trigger.first().waitFor({ state: 'visible', timeout: 20000 }); this.log(execId, 'COMPOSER_FOUND', `aria=${await trigger.getAttribute('aria-label').catch(() => '')}`); return trigger; } catch {}
    this.log(execId, 'COMPOSER_DIAGNOSTIC', JSON.stringify(await this.composerDiagnostics(page)), 'warn');
    this.log(execId, 'COMPOSER_RECOVERY', 'recarregando uma vez a página do grupo para recuperar o compositor', 'warn');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.waitForGroupReady(execId, page, groupUrl);
    const recovered = this.composer(page);
    await recovered.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    if (await recovered.count() && await recovered.isVisible().catch(() => false)) { this.log(execId, 'COMPOSER_RECOVERED', `aria=${await recovered.getAttribute('aria-label').catch(() => '')}`); return recovered; }
    this.log(execId, 'COMPOSER_DIAGNOSTIC_FINAL', JSON.stringify(await this.composerDiagnostics(page)), 'error');
    throw new Error('FACEBOOK_COMPOSER_NOT_AVAILABLE');
  }

  private async openComposer(execId: string, page: Page, groupUrl: string) {
    const trigger = await this.waitForComposer(execId, page, groupUrl);
    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    await trigger.click({ timeout: 15000 });
    const dialog = page.locator("div[role='dialog']:visible").filter({ has: page.locator('[role="textbox"]') }).last();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await this.editor(page).waitFor({ state: 'visible', timeout: 15000 });
    this.log(execId, 'COMPOSER_OPENED', 'dialog=visible textbox=visible');
  }

  private copyTokenStats(copy: string): { hashtags: string[]; mentions: string[] } { return { hashtags: copy.match(/#\w+/g) || [], mentions: copy.match(/@\w+/g) || [] }; }

  private async waitForEditorTokenStability(execId: string, page: Page, token: string, maxWaitMs = this.tokenStabilityMaxWaitMs, stableMs = this.tokenStabilityWindowMs): Promise<number> {
    const editor = this.editor(page); const started = Date.now(); let lastText = ''; let stableSince = 0;
    while (Date.now() - started < maxWaitMs) {
      const currentText = (await editor.textContent().catch(() => '')) || '';
      if (!currentText.includes(token)) { lastText = currentText; stableSince = Date.now(); }
      else if (currentText !== lastText) { lastText = currentText; stableSince = Date.now(); }
      else if (stableSince > 0 && Date.now() - stableSince >= stableMs) { return Date.now() - started; }
      await page.waitForTimeout(this.tokenStabilityPollMs);
    }
    return Date.now() - started;
  }

  private async activateMentionToken(execId: string, page: Page, token: string): Promise<boolean> {
    const options = page.locator("[role='option']:visible");
    const appeared = await options.first().waitFor({ state: 'visible', timeout: this.tokenActivationTimeoutMs }).then(() => true).catch(() => false);
    if (appeared) {
      const todos = options.filter({ hasText: /todos|todos os membros|grupo público/i }).first();
      if (await todos.count().catch(() => 0)) {
        try { await todos.click({ timeout: 5000 }); }
        catch { try { await todos.click({ timeout: 5000, force: true }); } catch { await this.waitForEditorTokenStability(execId, page, token); await page.keyboard.press('Enter').catch(() => undefined); } }
      } else { await this.waitForEditorTokenStability(execId, page, token); await page.keyboard.press('Enter').catch(() => undefined); }
    } else { await this.waitForEditorTokenStability(execId, page, token); await page.keyboard.press('Enter').catch(() => undefined); }
    await page.waitForFunction(() => document.querySelectorAll("[role='option']:visible").length === 0, null, { timeout: this.tokenActivationTimeoutMs }).catch(() => undefined);
    return appeared;
  }

  private async activateHashtagToken(execId: string, page: Page, token: string): Promise<void> {
    const waitedMs = await this.waitForEditorTokenStability(execId, page, token);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForFunction(() => document.querySelectorAll("[role='option']:visible").length === 0, null, { timeout: 1500 }).catch(() => undefined);
  }

  private async generateLinkPreview(execId: string, page: Page, copy: string, affiliateUrl: string) {
    const editor = this.editor(page); const finalText = copy.trim() + '\n\n' + affiliateUrl; const tokens = this.copyTokenStats(copy);
    await editor.click(); await editor.fill(''); const tokenPattern = /(@todos|#[\p{L}\p{N}_]+)/gu; let last = 0;
    for (const match of finalText.matchAll(tokenPattern)) { const index = match.index ?? 0; const plain = finalText.slice(last, index); if (plain) await editor.pressSequentially(plain); const token = match[0]; await editor.pressSequentially(token); if (token.toLowerCase() === '@todos') await this.activateMentionToken(execId, page, token); else if (token.startsWith('#')) await this.activateHashtagToken(execId, page, token); last = index + token.length; }
    const tail = finalText.slice(last); if (tail) { await editor.pressSequentially(tail); if (tail.trim() === affiliateUrl) await editor.press('Space'); }
    const actual = await editor.textContent().catch(() => ''); if (!actual?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
    await page.waitForFunction((url) => { const ed = document.querySelector("div[role='dialog'] [role='textbox']"); const dlg = [...document.querySelectorAll("[role='dialog']")].at(-1); const txt = ed?.textContent || ''; const dl = dlg?.textContent || ''; const links = dlg?.querySelectorAll("a[href*='lojadomecanico'], a[href*='mecanico']").length || 0; const imgs = dlg?.querySelectorAll('img').length || 0; return txt.includes(url) && (dl.includes('Loja') || dl.includes('mecânico') || links > 0 || imgs > 0); }, affiliateUrl, { timeout: this.previewTimeoutMs }).catch(() => undefined);
  }

  private async resolveMentionTypeahead(execId: string, page: Page): Promise<boolean> { const options = page.locator("[role='option']:visible"); const count = await options.count().catch(() => 0); if (count === 0) return false; const todos = options.filter({ hasText: /todos|todos os membros|grupo público/i }).first(); if (await todos.count().catch(() => 0)) { try { await todos.click({ timeout: 5000 }); } catch { try { await todos.click({ timeout: 5000, force: true }); } catch {} } } else await page.keyboard.press('Enter').catch(() => undefined); await page.waitForFunction(() => document.querySelectorAll("[role='option']").length === 0, null, { timeout: 5000 }).catch(() => undefined); return true; }

  private async openScheduleDirect(execId: string, page: Page) {
    const button = page.locator("[aria-label='Programar post']:visible").last(); await button.waitFor({ state: 'visible', timeout: 15000 }); await this.resolveMentionTypeahead(execId, page); try { await button.click({ timeout: 8000 }); } catch { await button.click({ timeout: 10000, force: true }); }
    const scheduleDialog = page.locator("[role='dialog']:visible").filter({ has: page.getByRole('combobox', { name: /Abrir seletor de data/ }) }).first(); await scheduleDialog.waitFor({ state: 'visible', timeout: 15000 });
  }

  private async setDate(execId: string, page: Page, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID'); const target = new Date(date + 'T12:00:00-03:00'); const dayNumber = String(target.getDate()); const monthLong = target.toLocaleDateString('pt-BR', { month: 'long' }); const year = String(target.getFullYear());
    const dateTrigger = page.getByRole('button', { name: /Abrir seletor de data/ }).or(page.getByRole('combobox', { name: /Abrir seletor de data/ })).first(); await dateTrigger.waitFor({ state: 'visible', timeout: 15000});
    if (await page.locator("[role='gridcell']:visible").count().catch(() => 0) === 0) { try { await dateTrigger.click({ timeout: 8000 }); } catch { await dateTrigger.click({ timeout: 10000, force: true }); } await page.locator("[role='gridcell']").first().waitFor({ state: 'visible', timeout: 15000 }); }
    const targetCell = () => page.getByRole('gridcell', { name: new RegExp(dayNumber + ' de ' + monthLong + ' de ' + year, 'i') }).first(); let cell = targetCell(); let found = await cell.count().catch(() => 0) > 0;
    if (!found) { for (let i = 0; i < 12 && !found; i++) { const next = page.getByRole('button', { name: 'Próximo mês' }).first(); const prev = page.getByRole('button', { name: 'Mês anterior' }).first(); const navButton = (await next.count().catch(() => 0) > 0 ? next : prev); await navButton.click({ timeout: 10000 }).catch(() => undefined); cell = targetCell(); found = await cell.count().catch(() => 0) > 0; } }
    if (!found) throw new Error('FACEBOOK_DATE_CELL_NOT_FOUND'); await cell.click({ timeout: 10000 });
  }

  private async setTime(execId: string, page: Page, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID'); const timeTrigger = page.getByRole('button', { name: /Abrir seletor de hora/ }).or(page.getByRole('combobox', { name: /Abrir seletor de hora/ })).first(); await timeTrigger.waitFor({ state: 'visible', timeout: 15000 }); try { await timeTrigger.click({ timeout: 8000 }); } catch { await timeTrigger.click({ timeout: 10000, force: true }); } const option = page.getByRole('option', { name: time, exact: true }).or(page.locator("[role='option']:visible").filter({ hasText: time }).last()); await option.first().waitFor({ state: 'visible', timeout: 15000 }); await option.first().click({ timeout: 15000 });
  }

  private async checkPostInPlanner(page: Page, groupUrl: string, content: string, scheduledDate: string, scheduledTime: string, productName?: string): Promise<PlannerCheckResult> {
    const plannerUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
    try {
      await page.goto(plannerUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const hasBody = await page.waitForFunction(() => (document.body.innerText || '').trim().length > 0, null, { timeout: 10000 }).then(() => true).catch(() => false);
      if (!hasBody) return { found: false, plannerUrl, verified: false };
      const bodyText = await page.locator('body').innerText().catch(() => ''); const normalizedBody = bodyText.replace(/\s+/g, ' ').trim();
      if (normalizedBody.length < 20) return { found: false, plannerUrl, verified: false };
      const needle80 = content.replace(/\s+/g, ' ').trim().slice(0, 80); const nameNeedle = productName ? productName.trim().slice(0, 40) : '';
      const contentFound = needle80.length > 20 && normalizedBody.includes(needle80); const nameFound = nameNeedle.length > 10 && normalizedBody.includes(nameNeedle);
      if (contentFound || nameFound) return { found: true, plannerUrl, snippet: needle80, verified: true };
      return { found: false, plannerUrl, verified: true };
    } catch { return { found: false, plannerUrl, verified: false }; }
  }

  private async confirmAndVerify(execId: string, page: Page, groupUrl: string, content: string, scheduledDate: string, scheduledTime: string, productName?: string): Promise<{ success: boolean; plannerUrl: string; submitted: boolean; uncertain?: boolean; error?: string }> {
    const button = page.locator("[aria-label='Programar']:visible").last(); await button.waitFor({ state: 'visible', timeout: 15000 }); if (await button.isDisabled().catch(() => false) || await button.getAttribute('aria-disabled') === 'true') throw new Error('FACEBOOK_SCHEDULE_CONFIRM_DISABLED'); await button.click({ timeout: 15000 }); const submitted = true;
    await page.waitForFunction(() => ![...document.querySelectorAll("[role='dialog']")].some(d => d.getAttribute('aria-label') === 'Programar post'), null, { timeout: 8000 }).catch(() => undefined);
    const plannerUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts'; const shouldVerifyPlanner = ++this.schedulesSincePlannerVerification >= this.plannerVerificationInterval;
    if (!shouldVerifyPlanner) return { success: true, plannerUrl, submitted: true };
    this.schedulesSincePlannerVerification = 0;
    try {
      const check = await this.checkPostInPlanner(page, groupUrl, content, scheduledDate, scheduledTime, productName);
      if (!check.verified) return { success: false, submitted: true, uncertain: true, plannerUrl, error: 'FACEBOOK_PLANNER_UNVERIFIED: não foi possível validar a página do Planner.' };
      if (check.found) return { success: true, plannerUrl, submitted: true };
      const recheck = await this.checkPostInPlanner(page, groupUrl, content, scheduledDate, scheduledTime, productName);
      if (recheck.verified && recheck.found) return { success: true, plannerUrl, submitted: true };
      if (!recheck.verified) return { success: false, submitted: true, uncertain: true, plannerUrl, error: 'FACEBOOK_PLANNER_UNVERIFIED: segunda verificação não pôde validar o Planner.' };
      return { success: false, submitted: true, uncertain: true, plannerUrl, error: 'FACEBOOK_CONFIRMATION_UNCERTAIN: Clique de agendamento enviado, mas o Planner confirmou ausência.' };
    } catch (err: any) { return { success: false, submitted: true, uncertain: true, plannerUrl, error: `FACEBOOK_CONFIRMATION_UNCERTAIN: ${err.message}` }; }
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      const execId = crypto.randomUUID().slice(0, 8); const started = Date.now(); let submitted = false; let plannerUrl: string | undefined;
      try {
        if (!input.groupUrl?.includes('/groups/')) throw new Error('FACEBOOK_GROUP_URL_INVALID'); if (!input.affiliateUrl?.includes('/20889')) throw new Error('FACEBOOK_AFFILIATE_URL_INVALID'); if (!input.content?.trim() || /https?:\/\//i.test(input.content) || /R\$/i.test(input.content)) throw new Error('FACEBOOK_CONTENT_INVALID');
        const target = new Date(`${input.scheduledDate}T${input.scheduledTime}:00-03:00`); if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) throw new Error('FACEBOOK_SCHEDULE_IN_PAST');
        await facebookSession.requireAuthenticated(); const page = await facebookBrowser.closeExtraPages();
        if (input.preCheckPlanner) {
          const existingCheck = await this.checkPostInPlanner(page, input.groupUrl, input.content, input.scheduledDate, input.scheduledTime, input.productName);
          if (!existingCheck.verified) return { success: false, submitted: false, uncertain: true, plannerUrl: existingCheck.plannerUrl, error: 'FACEBOOK_PLANNER_UNVERIFIED: pré-checagem não pôde validar o Planner.' };
          if (existingCheck.found) return { success: true, scheduledAt: target.toISOString(), plannerUrl: existingCheck.plannerUrl, alreadyScheduled: true };
        }
        await this.goToGroup(execId, page, input.groupUrl); await this.openComposer(execId, page, input.groupUrl); await this.generateLinkPreview(execId, page, input.content, input.affiliateUrl); await this.openScheduleDirect(execId, page); await this.setDate(execId, page, input.scheduledDate); await this.setTime(execId, page, input.scheduledTime); plannerUrl = input.groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
        const confirmResult = await this.confirmAndVerify(execId, page, input.groupUrl, input.content, input.scheduledDate, input.scheduledTime, input.productName); submitted = confirmResult.submitted; if (confirmResult.plannerUrl) plannerUrl = confirmResult.plannerUrl;
        const scheduledAt = target.toISOString(); if (confirmResult.success) return { success: true, scheduledAt, plannerUrl: confirmResult.plannerUrl, submitted: true }; if (confirmResult.uncertain || submitted) return { success: false, submitted: true, uncertain: true, plannerUrl, error: confirmResult.error || 'FACEBOOK_CONFIRMATION_UNCERTAIN' }; throw new Error(confirmResult.error || 'FACEBOOK_SCHEDULE_CONFIRMATION_FAILED');
      } catch (error: any) {
        if (submitted) return { success: false, submitted: true, uncertain: true, plannerUrl, error: `FACEBOOK_CONFIRMATION_UNCERTAIN: ${error.message}` };
        return { success: false, submitted: false, uncertain: false, plannerUrl, error: error.message };
      }
    });
  }

  async checkScheduledPost(groupUrl: string, content: string, date: string, time: string, productName?: string): Promise<PlannerCheckResult> {
    return this.serial(async () => { await facebookSession.requireAuthenticated(); const page = await facebookBrowser.getOperationalPage(); return this.checkPostInPlanner(page, groupUrl, content, date, time, productName); });
  }

  async publish(_input: FacebookPublishInput): Promise<FacebookScheduleResult> { return { success: false, error: 'FACEBOOK_IMMEDIATE_PUBLISH_DISABLED' }; }
  async publishTest(_groupUrl: string) { return { success: false, message: 'FACEBOOK_TEST_PUBLISH_DISABLED: use o fluxo de agendamento real.' }; }

  async verifyGroup(groupUrl: string) {
    return this.serial(async () => {
      try { await facebookSession.requireAuthenticated(); const page = await facebookBrowser.getOperationalPage(); await this.goToGroup(crypto.randomUUID().slice(0, 8), page, groupUrl); const expected = new URL(groupUrl), actual = new URL(page.url()); const title = await page.title().catch(() => ''); const accessible = actual.origin === expected.origin && actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '') && /A Loja Do Mecânico/i.test(title); return { accessible, message: accessible ? 'Grupo acessível.' : `Grupo não validado. url=${page.url()} title=${title}` }; } catch (error: any) { return { accessible: false, message: error.message }; }
    });
  }
}

export const facebookAutomation = new FacebookAutomationService();