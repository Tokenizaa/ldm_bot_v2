import type { Locator, Page } from 'playwright';
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

const GROUP_PATH = '/groups/tokeniza';
const AFFILIATE_ID = '/20889';
const PLANNER_SUFFIX = '/scheduled_posts';

class FacebookAutomationService {
  private execution: Promise<void> = Promise.resolve();
  private plannerChecks = 0;

  private readonly tokenActivationDelayMs = 1200;
  private readonly tokenStabilityPollMs = 75;
  private readonly tokenStabilityWindowMs = 250;
  private readonly tokenStabilityTimeoutMs = 1500;
  private readonly interactionTimeoutMs = 10000;
  private readonly stepTimeoutMs = 12000;
  private readonly calendarTimeoutMs = 10000;
  private readonly previewTimeoutMs = 12000;

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.execution;
    let release!: () => void;
    this.execution = new Promise<void>((resolve) => { release = resolve; });

    return previous.then(operation).finally(release);
  }

  private log(step: string, message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    logger.facebook(`[schedule] STEP=${step} ${message}`, level);
  }

  private groupUrlIsCanonical(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.origin === 'https://www.facebook.com'
        && parsed.pathname.replace(/\/+$/, '') === GROUP_PATH;
    } catch {
      return false;
    }
  }

  private isOnGroup(page: Page, groupUrl: string): boolean {
    try {
      const current = new URL(page.url());
      const target = new URL(groupUrl);
      return current.origin === target.origin
        && current.pathname.replace(/\/+$/, '') === target.pathname.replace(/\/+$/, '');
    } catch {
      return false;
    }
  }

  private composer(page: Page): Locator {
    return page.locator("[aria-label='Escreva algo...']").first();
  }

  private composerDialog(page: Page): Locator {
    return page.locator("div[role='dialog'][aria-label='Criar post']:visible").first();
  }

  private editor(page: Page): Locator {
    return page.locator("div[role='dialog'][aria-label='Criar post'] [role='textbox']").first();
  }

  private scheduleDialog(page: Page): Locator {
    return page.locator("[role='dialog']:visible")
      .filter({ has: page.getByRole('combobox', { name: /Abrir seletor de data/ }) })
      .first();
  }

  private plannerUrl(groupUrl: string): string {
    return groupUrl.replace(/\/+$/, '') + PLANNER_SUFFIX;
  }

  private async goToGroup(page: Page, groupUrl: string): Promise<void> {
    if (!this.groupUrlIsCanonical(groupUrl)) {
      throw new Error('FACEBOOK_GROUP_URL_INVALID');
    }

    if (!this.isOnGroup(page, groupUrl)) {
      await page.goto(groupUrl, { waitUntil: 'commit', timeout: 60000 });
    }

    const current = page.url();
    if (!this.isOnGroup(page, groupUrl) || /\/login|\/checkpoint|\/recover/i.test(current)) {
      throw new Error('FACEBOOK_GROUP_NOT_READY');
    }

    this.log('GROUP_READY', `url=${current} title=${await page.title().catch(() => '')}`);
  }

  private async closeOpenDialogs(page: Page): Promise<void> {
    const dialog = page.locator("div[role='dialog']:visible").last();
    if (await dialog.count().catch(() => 0)) {
      await page.keyboard.press('Escape').catch(() => undefined);
      await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined);
    }
  }

  private async openComposer(page: Page): Promise<void> {
    await this.closeOpenDialogs(page);

    const trigger = this.composer(page);
    await trigger.waitFor({ state: 'visible', timeout: this.stepTimeoutMs })
      .catch(() => { throw new Error('FACEBOOK_COMPOSER_NOT_AVAILABLE'); });
    await trigger.click({ timeout: this.interactionTimeoutMs });

    const dialog = this.composerDialog(page);
    await dialog.waitFor({ state: 'visible', timeout: this.stepTimeoutMs })
      .catch(() => { throw new Error('FACEBOOK_COMPOSER_DIALOG_NOT_FOUND'); });

    const editor = this.editor(page);
    await editor.waitFor({ state: 'visible', timeout: this.stepTimeoutMs })
      .catch(() => { throw new Error('FACEBOOK_CONTENT_FIELD_NOT_FOUND'); });
    await editor.click({ timeout: this.interactionTimeoutMs });

    this.log('COMPOSER_READY', 'dialog canônico e textbox canônico disponíveis');
  }

  private async waitForTokenStability(page: Page, token: string): Promise<void> {
    const editor = this.editor(page);
    const started = Date.now();
    let previous = '';
    let stableSince = 0;

    while (Date.now() - started < this.tokenStabilityTimeoutMs) {
      const current = (await editor.textContent().catch(() => '')) || '';
      if (current !== previous) {
        previous = current;
        stableSince = Date.now();
      } else if (current.includes(token) && stableSince > 0 && Date.now() - stableSince >= this.tokenStabilityWindowMs) {
        return;
      }
      await page.waitForTimeout(this.tokenStabilityPollMs);
    }

    const finalText = (await editor.textContent().catch(() => '')) || '';
    if (!finalText.includes(token)) {
      throw new Error(`FACEBOOK_TOKEN_NOT_RENDERED:${token}`);
    }
  }

  private async activateToken(page: Page, token: string): Promise<void> {
    await this.waitForTokenStability(page, token);
    await page.waitForTimeout(this.tokenActivationDelayMs);

    const editor = this.editor(page);
    await editor.click({ position: { x: 4, y: 4 }, timeout: this.interactionTimeoutMs });
    await editor.press('End').catch(() => undefined);
    await page.keyboard.press('Enter');

    this.log('TOKEN_ACTIVATED', `token=${token} delayMs=${this.tokenActivationDelayMs}`);
  }

  private async typePlainText(editor: Locator, text: string): Promise<void> {
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index]) await editor.pressSequentially(lines[index]);
      if (index < lines.length - 1) await editor.press('Enter');
    }
  }

  private async typePublicationContent(page: Page, content: string, affiliateUrl: string): Promise<void> {
    const editor = this.editor(page);
    await editor.click({ timeout: this.interactionTimeoutMs });
    await editor.fill('');

    const finalText = `${content.trim()}\n\n${affiliateUrl}`;
    const tokenPattern = /(@todos|#[\p{L}\p{N}_]+)/gu;
    let cursor = 0;

    for (const match of finalText.matchAll(tokenPattern)) {
      const index = match.index ?? cursor;
      const plainText = finalText.slice(cursor, index);
      if (plainText) await this.typePlainText(editor, plainText);

      const token = match[0];
      await editor.pressSequentially(token);
      await this.activateToken(page, token);
      cursor = index + token.length;
    }

    const tail = finalText.slice(cursor);
    if (tail) await this.typePlainText(editor, tail);

    this.log('CONTENT_READY', `copy preservada + URL afiliada adicionada`);
  }

  private async waitForLinkPreview(page: Page, affiliateUrl: string): Promise<void> {
    const dialog = this.composerDialog(page);
    const editor = this.editor(page);
    const started = Date.now();

    while (Date.now() - started < this.previewTimeoutMs) {
      const editorText = (await editor.textContent().catch(() => '')) || '';
      const previewLinks = await dialog.locator("a[href*='lojadomecanico'],a[href*='mecanico']").count().catch(() => 0);
      if (editorText.includes(affiliateUrl) || previewLinks > 0) {
        this.log('LINK_PREVIEW_READY', `url=${affiliateUrl}`);
        return;
      }
      await page.waitForTimeout(150);
    }

    throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
  }

  private async prepareLinkPreview(page: Page, affiliateUrl: string): Promise<void> {
    const editor = this.editor(page);
    await editor.press('End').catch(() => undefined);
    await page.waitForTimeout(500);
    await editor.press('Space');
    await this.waitForLinkPreview(page, affiliateUrl);
  }

  private async openScheduleDialog(page: Page): Promise<void> {
    const button = this.composerDialog(page).locator("[aria-label='Programar post']").first();
    await button.waitFor({ state: 'visible', timeout: this.stepTimeoutMs })
      .catch(() => { throw new Error('FACEBOOK_SCHEDULE_BUTTON_NOT_FOUND'); });
    await button.click({ timeout: this.interactionTimeoutMs });

    await this.scheduleDialog(page).waitFor({ state: 'visible', timeout: this.stepTimeoutMs })
      .catch(() => { throw new Error('FACEBOOK_SCHEDULE_DIALOG_NOT_FOUND'); });
  }

  private async selectDate(page: Page, date: string): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID');

    const target = new Date(`${date}T12:00:00-03:00`);
    if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) {
      throw new Error('FACEBOOK_SCHEDULE_IN_PAST');
    }

    const day = String(target.getDate());
    const month = target.toLocaleDateString('pt-BR', { month: 'long' });
    const year = String(target.getFullYear());
    const pattern = new RegExp(`${day} de ${month} de ${year}`, 'i');
    const dialog = this.scheduleDialog(page);
    const cell = dialog.getByRole('gridcell', { name: pattern }).first();

    await cell.waitFor({ state: 'visible', timeout: this.calendarTimeoutMs })
      .catch(() => { throw new Error('FACEBOOK_DATE_CELL_NOT_FOUND'); });
    await cell.click({ timeout: this.interactionTimeoutMs });
    this.log('DATE_READY', `date=${date}`);
  }

  private async selectTime(page: Page, time: string): Promise<void> {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID');

    const dialog = this.scheduleDialog(page);
    const option = dialog.locator("[role='option']:visible").filter({ hasText: time }).first();
    await option.waitFor({ state: 'visible', timeout: this.calendarTimeoutMs })
      .catch(() => { throw new Error('FACEBOOK_TIME_OPTION_NOT_FOUND'); });
    await option.click({ timeout: this.interactionTimeoutMs });
    this.log('TIME_READY', `time=${time}`);
  }

  private async confirmSchedule(page: Page): Promise<void> {
    const button = page.locator("[aria-label='Programar']:visible").last();
    await button.waitFor({ state: 'visible', timeout: this.stepTimeoutMs })
      .catch(() => { throw new Error('FACEBOOK_SCHEDULE_CONFIRM_NOT_FOUND'); });
    if (await button.isDisabled().catch(() => false) || await button.getAttribute('aria-disabled') === 'true') {
      throw new Error('FACEBOOK_SCHEDULE_CONFIRM_DISABLED');
    }
    await button.click({ timeout: this.interactionTimeoutMs });
    this.log('SCHEDULE_CONFIRMED', 'Facebook aceitou o comando Programar');
  }

  private async checkPlanner(page: Page, groupUrl: string, content: string, productName?: string): Promise<PlannerCheckResult> {
    const plannerUrl = this.plannerUrl(groupUrl);
    try {
      await page.goto(plannerUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => Boolean((document.body.innerText || '').trim()), null, { timeout: 10000 });

      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
      if (body.length < 20) return { found: false, plannerUrl, verified: false };

      const contentNeedle = content.replace(/\s+/g, ' ').trim().slice(0, 80);
      const nameNeedle = productName?.trim().slice(0, 40) || '';
      const found = (contentNeedle.length > 20 && body.includes(contentNeedle))
        || (nameNeedle.length > 10 && body.includes(nameNeedle));

      return { found, plannerUrl, verified: true, snippet: contentNeedle };
    } catch {
      return { found: false, plannerUrl, verified: false };
    }
  }

  private async optionalPlannerVerification(page: Page, input: FacebookScheduleInput): Promise<FacebookScheduleResult | null> {
    this.plannerChecks += 1;
    if (this.plannerChecks < 5) return null;
    this.plannerChecks = 0;

    const check = await this.checkPlanner(page, input.groupUrl, input.content, input.productName);
    if (!check.verified) {
      return {
        success: false,
        submitted: true,
        uncertain: true,
        plannerUrl: check.plannerUrl,
        error: 'FACEBOOK_PLANNER_UNVERIFIED',
      };
    }

    if (!check.found) {
      const recheck = await this.checkPlanner(page, input.groupUrl, input.content, input.productName);
      if (!recheck.verified) {
        return {
          success: false,
          submitted: true,
          uncertain: true,
          plannerUrl: recheck.plannerUrl,
          error: 'FACEBOOK_PLANNER_UNVERIFIED',
        };
      }
      if (!recheck.found) {
        return {
          success: false,
          submitted: true,
          uncertain: true,
          plannerUrl: recheck.plannerUrl,
          error: 'FACEBOOK_CONFIRMATION_UNCERTAIN',
        };
      }
    }

    return { success: true, submitted: true, plannerUrl: check.plannerUrl };
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      const target = new Date(`${input.scheduledDate}T${input.scheduledTime}:00-03:00`);
      let submitted = false;

      try {
        if (!this.groupUrlIsCanonical(input.groupUrl)) throw new Error('FACEBOOK_GROUP_URL_INVALID');
        if (!input.affiliateUrl?.includes(AFFILIATE_ID)) throw new Error('FACEBOOK_AFFILIATE_URL_INVALID');
        if (!input.content?.trim() || /https?:\/\//i.test(input.content) || /R\$/i.test(input.content)) {
          throw new Error('FACEBOOK_CONTENT_INVALID');
        }
        if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) {
          throw new Error('FACEBOOK_SCHEDULE_IN_PAST');
        }

        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.closeExtraPages();

        if (input.preCheckPlanner) {
          const check = await this.checkPlanner(page, input.groupUrl, input.content, input.productName);
          if (!check.verified) return { success: false, uncertain: true, plannerUrl: check.plannerUrl, error: 'FACEBOOK_PLANNER_UNVERIFIED' };
          if (check.found) return { success: true, alreadyScheduled: true, scheduledAt: target.toISOString(), plannerUrl: check.plannerUrl };
        }

        await this.goToGroup(page, input.groupUrl);
        await this.openComposer(page);
        await this.typePublicationContent(page, input.content, input.affiliateUrl);
        await this.prepareLinkPreview(page, input.affiliateUrl);
        await this.openScheduleDialog(page);
        await this.selectDate(page, input.scheduledDate);
        await this.selectTime(page, input.scheduledTime);
        await this.confirmSchedule(page);
        submitted = true;

        const verification = await this.optionalPlannerVerification(page, input);
        if (verification) return { ...verification, scheduledAt: target.toISOString() };

        return {
          success: true,
          submitted: true,
          scheduledAt: target.toISOString(),
          plannerUrl: this.plannerUrl(input.groupUrl),
        };
      } catch (error: any) {
        const message = error?.message || String(error);
        return {
          success: false,
          submitted,
          uncertain: submitted,
          plannerUrl: this.plannerUrl(input.groupUrl),
          error: submitted ? `FACEBOOK_CONFIRMATION_UNCERTAIN: ${message}` : message,
        };
      }
    });
  }

  async checkScheduledPost(groupUrl: string, content: string, _date: string, _time: string, productName?: string): Promise<{ found: boolean; plannerUrl: string }> {
    return this.serial(async () => {
      await facebookSession.requireAuthenticated();
      const page = await facebookBrowser.getOperationalPage();
      const check = await this.checkPlanner(page, groupUrl, content, productName);
      if (!check.verified) throw new Error('FACEBOOK_PLANNER_UNVERIFIED');
      return { found: check.found, plannerUrl: check.plannerUrl };
    });
  }

  async verifyGroup(groupUrl: string): Promise<{ success: boolean; url: string; title?: string; error?: string }> {
    return this.serial(async () => {
      try {
        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.getOperationalPage();
        await this.goToGroup(page, groupUrl);
        return { success: true, url: page.url(), title: await page.title().catch(() => '') };
      } catch (error: any) {
        return { success: false, url: groupUrl, error: error?.message || String(error) };
      }
    });
  }

  async publish(_input: unknown): Promise<FacebookScheduleResult> {
    return { success: false, error: 'FACEBOOK_IMMEDIATE_PUBLISH_DISABLED' };
  }

  async publishTest(_groupUrl: string): Promise<{ success: false; message: string }> {
    return { success: false, message: 'FACEBOOK_TEST_PUBLISH_DISABLED: use o fluxo de agendamento real.' };
  }
}

export const facebookAutomation = new FacebookAutomationService();
