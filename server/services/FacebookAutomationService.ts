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

  private log(execId: string, step: string, message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
    logger.facebook(`[${execId}] STEP=${step} ${message}`, level);
  }

  private composer(page: Page): Locator {
    return page.locator("[aria-label='Escreva algo...']:visible, [aria-label='No que você está pensando?']:visible, [aria-label='Criar publicação']:visible").first();
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

  private async waitForGroupReady(execId: string, page: Page, groupUrl: string) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (this.isGroupPage(page, groupUrl)) {
        const title = await page.title().catch(() => '');
        if (/A Loja Do Mecânico/i.test(title) || await page.locator('main').count() > 0) {
          this.log(execId, 'GROUP_READY', `url=${page.url()} title=${title}`);
          return;
        }
      }
      await page.waitForTimeout(1000);
    }
    throw new Error('FACEBOOK_GROUP_NOT_READY');
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

  private async waitForComposer(execId: string, page: Page, groupUrl: string): Promise<Locator> {
    const deadline = Date.now() + 20000;
    this.log(execId, 'COMPOSER_WAIT', 'procurando gatilho real do compositor');

    while (Date.now() < deadline) {
      const trigger = this.composer(page);
      if (await trigger.count() && await trigger.isVisible().catch(() => false)) {
        this.log(execId, 'COMPOSER_FOUND', `aria=${await trigger.getAttribute('aria-label').catch(() => '')}`);
        return trigger;
      }
      await page.waitForTimeout(1000);
    }

    this.log(execId, 'COMPOSER_DIAGNOSTIC', JSON.stringify(await this.composerDiagnostics(page)), 'warn');
    this.log(execId, 'COMPOSER_RECOVERY', 'recarregando uma vez a página do grupo para recuperar o compositor', 'warn');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.waitForGroupReady(execId, page, groupUrl);

    const recovered = this.composer(page);
    await recovered.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    if (await recovered.count() && await recovered.isVisible().catch(() => false)) {
      this.log(execId, 'COMPOSER_RECOVERED', `aria=${await recovered.getAttribute('aria-label').catch(() => '')}`);
      return recovered;
    }

    this.log(execId, 'COMPOSER_DIAGNOSTIC_FINAL', JSON.stringify(await this.composerDiagnostics(page)), 'error');
    throw new Error('FACEBOOK_COMPOSER_NOT_AVAILABLE');
  }

  private async openComposer(execId: string, page: Page, groupUrl: string) {
    const trigger = await this.waitForComposer(execId, page, groupUrl);
    await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
    this.log(execId, 'COMPOSER_CLICK', `aria=${await trigger.getAttribute('aria-label').catch(() => '')}`);
    await trigger.click({ timeout: 15000 });

    const dialog = page.locator("div[role='dialog']:visible").filter({ has: page.locator('[role="textbox"]') }).last();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    const editor = this.editor(page);
    await editor.waitFor({ state: 'visible', timeout: 15000 });
    this.log(execId, 'COMPOSER_OPENED', 'dialog=visible textbox=visible');
  }

  private async fillComposer(execId: string, page: Page, content: string) {
    const editor = this.editor(page);
    await editor.fill(content);
    const actual = await editor.textContent().catch(() => '');
    if (!actual?.includes(content.slice(0, Math.min(40, content.length)))) throw new Error('FACEBOOK_CONTENT_INPUT_FAILED');
    this.log(execId, 'COPY_FILLED', 'chars=' + content.length);
  }

  private async generateLinkPreview(execId: string, page: Page, copy: string, affiliateUrl: string) {
    const editor = this.editor(page);
    await this.fillComposer(execId, page, copy.trim() + '\n' + affiliateUrl);
    this.log(execId, 'PREVIEW_START', 'URL afiliada adicionada temporariamente para gerar preview');

    const previewDeadline = Date.now() + 12000;
    while (Date.now() < previewDeadline) {
      const text = await editor.textContent().catch(() => '');
      const dialogText = await page.locator('[role="dialog"]:visible').innerText().catch(() => '');
      if (text?.includes(affiliateUrl) && (dialogText.includes('Loja') || dialogText.includes('mecânico') || await page.locator('[role="dialog"]:visible img').count() > 0)) break;
      await page.waitForTimeout(1000);
    }

    if (!(await editor.textContent().catch(() => ''))?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
    await editor.fill(copy.trim());
    await page.waitForTimeout(1500);
    if ((await editor.textContent().catch(() => ''))?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_REMAINED_IN_COPY');
    this.log(execId, 'PREVIEW_READY', 'preview solicitado e URL removida da copy');
  }

  private async openScheduleDirect(execId: string, page: Page) {
    const button = page.locator("[aria-label='Programar post']:visible").last();
    this.log(execId, 'DIRECT_SCHEDULE_WAIT', "selector=[aria-label='Programar post']");
    await button.waitFor({ state: 'visible', timeout: 15000 });
    await button.click({ timeout: 15000 });

    // Validate that schedule UI with calendar/time pickers opened
    const scheduleUi = page.locator("[role='dialog']:visible, [role='menu']:visible").last();
    await scheduleUi.waitFor({ state: 'visible', timeout: 15000 });

    const hasScheduleControls = await page.locator("[role='gridcell'], [role='listbox'], input[type='text'], [aria-label*='Data'], [aria-label*='Hora']").count().catch(() => 0);
    if (hasScheduleControls === 0) {
      this.log(execId, 'SCHEDULE_PANEL_RETRY', 'Aguardando renderização completa dos controles de agendamento', 'warn');
      await page.waitForTimeout(1500);
    }
    this.log(execId, 'SCHEDULE_PANEL_OPENED', 'interface nativa de programação confirmada');
  }

  private async setDate(execId: string, page: Page, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID');
    const target = new Date(date + 'T12:00:00-03:00');
    const dayNumber = String(target.getDate());
    const ptLabel = target.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    const shortPtLabel = target.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });

    this.log(execId, 'DATE_WAIT', `label="${ptLabel}" day=${dayNumber}`);

    // Try multiple selector variants for resilient date matching
    const cellByLongLabel = page.locator("[role='gridcell']:visible").filter({ hasText: ptLabel }).last();
    if (await cellByLongLabel.count() > 0) {
      await cellByLongLabel.click({ timeout: 10000 });
      this.log(execId, 'DATE_SELECTED', 'via long label: ' + ptLabel);
      return;
    }

    const cellByShortLabel = page.locator("[role='gridcell']:visible").filter({ hasText: shortPtLabel }).last();
    if (await cellByShortLabel.count() > 0) {
      await cellByShortLabel.click({ timeout: 10000 });
      this.log(execId, 'DATE_SELECTED', 'via short label: ' + shortPtLabel);
      return;
    }

    // Try exact numeric day match inside calendar grid
    const cellByDay = page.locator("[role='gridcell']:visible").filter({ hasText: new RegExp(`^\\s*${dayNumber}\\s*$`) }).last();
    if (await cellByDay.count() > 0) {
      await cellByDay.click({ timeout: 10000 });
      this.log(execId, 'DATE_SELECTED', 'via gridcell day number: ' + dayNumber);
      return;
    }

    // Fallback: aria-label containing day number and month
    const cellByAria = page.locator(`[role='gridcell'][aria-label*='${dayNumber}']:visible`).last();
    await cellByAria.waitFor({ state: 'visible', timeout: 10000 });
    await cellByAria.click({ timeout: 10000 });
    this.log(execId, 'DATE_SELECTED', 'via aria-label fallback');
  }

  private async setTime(execId: string, page: Page, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID');
    this.log(execId, 'TIME_WAIT', 'time=' + time);

    // Scope search strictly to visible listbox or dropdown dialog
    const option = page.locator("[role='listbox']:visible [role='option']:visible, div[role='dialog'] [role='option']:visible, div[role='menu'] [role='option']:visible").filter({ hasText: time }).last();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click({ timeout: 15000 });
    this.log(execId, 'TIME_SELECTED', 'time=' + time);
  }

  /**
   * Inspects the group's /scheduled_posts planner to check if this publication
   * is already present (by content snippet, product identifier, or date/time).
   */
  async checkPostInPlanner(
    page: Page,
    groupUrl: string,
    content: string,
    scheduledDate: string,
    scheduledTime: string,
    productName?: string
  ): Promise<{ found: boolean; plannerUrl: string; snippet?: string }> {
    const plannerUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
    try {
      await page.goto(plannerUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);

      const bodyText = await page.locator('body').innerText().catch(() => '');
      const normalizedBody = bodyText.replace(/\s+/g, ' ');

      // Needles to check
      const needle80 = content.replace(/\s+/g, ' ').trim().slice(0, 80);
      const nameNeedle = productName ? productName.trim().slice(0, 40) : '';

      const contentFound = needle80.length > 20 && normalizedBody.includes(needle80);
      const nameFound = nameNeedle.length > 10 && normalizedBody.includes(nameNeedle);

      if (contentFound || nameFound) {
        return { found: true, plannerUrl, snippet: needle80 };
      }

      return { found: false, plannerUrl };
    } catch {
      return { found: false, plannerUrl };
    }
  }

  private async confirmAndVerify(
    execId: string,
    page: Page,
    groupUrl: string,
    content: string,
    scheduledDate: string,
    scheduledTime: string,
    productName?: string
  ): Promise<{ success: boolean; plannerUrl: string; submitted: boolean; uncertain?: boolean; error?: string }> {
    const button = page.locator("[aria-label='Programar']:visible").last();
    this.log(execId, 'CONFIRM_WAIT', "selector=[aria-label='Programar']");
    await button.waitFor({ state: 'visible', timeout: 15000 });

    if (await button.isDisabled().catch(() => false) || await button.getAttribute('aria-disabled') === 'true') {
      throw new Error('FACEBOOK_SCHEDULE_CONFIRM_DISABLED');
    }

    // CLICK "Programar"
    await button.click({ timeout: 15000 });
    this.log(execId, 'SCHEDULE_CLICKED', 'confirmação nativa enviada; submitted=true');
    const submitted = true;

    await page.waitForTimeout(3000);

    // Navigate to scheduled posts planner to verify
    const plannerUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
    try {
      const check = await this.checkPostInPlanner(page, groupUrl, content, scheduledDate, scheduledTime, productName);
      this.log(execId, 'PLANNER_VERIFY', `url=${page.url()} found=${check.found}`);

      if (check.found) {
        return { success: true, plannerUrl, submitted: true };
      }

      // One retry after 3 seconds in case of Facebook UI latency
      await page.waitForTimeout(3000);
      const recheck = await this.checkPostInPlanner(page, groupUrl, content, scheduledDate, scheduledTime, productName);
      if (recheck.found) {
        this.log(execId, 'PLANNER_VERIFY_RECHECK', 'Post encontrado na segunda verificação');
        return { success: true, plannerUrl, submitted: true };
      }

      // "Programar" was clicked, but planner hasn't shown it yet.
      // Flag as UNCERTAIN to prevent duplicate submissions!
      return {
        success: false,
        submitted: true,
        uncertain: true,
        plannerUrl,
        error: 'FACEBOOK_CONFIRMATION_UNCERTAIN: Clique de agendamento enviado, mas verificação no planner não confirmou a tempo.'
      };
    } catch (err: any) {
      return {
        success: false,
        submitted: true,
        uncertain: true,
        plannerUrl,
        error: `FACEBOOK_CONFIRMATION_UNCERTAIN: ${err.message}`
      };
    }
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      const execId = crypto.randomUUID().slice(0, 8);
      const started = Date.now();
      this.log(execId, 'SCHEDULE_START', `date=${input.scheduledDate} time=${input.scheduledTime} group=${input.groupUrl}`);

      let submitted = false;
      let plannerUrl: string | undefined = undefined;

      try {
        if (!input.groupUrl?.includes('/groups/')) throw new Error('FACEBOOK_GROUP_URL_INVALID');
        if (!input.affiliateUrl?.includes('/20889')) throw new Error('FACEBOOK_AFFILIATE_URL_INVALID');
        if (!input.content?.trim() || /https?:\/\//i.test(input.content) || /R\$/i.test(input.content)) throw new Error('FACEBOOK_CONTENT_INVALID');

        const target = new Date(`${input.scheduledDate}T${input.scheduledTime}:00-03:00`);
        if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) throw new Error('FACEBOOK_SCHEDULE_IN_PAST');

        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.getOperationalPage();

        // 1. Idempotency pre-check: Is it ALREADY in the planner?
        this.log(execId, 'PRE_CHECK_PLANNER', 'Verificando se publicação já existe em /scheduled_posts');
        const existingCheck = await this.checkPostInPlanner(page, input.groupUrl, input.content, input.scheduledDate, input.scheduledTime, input.productName);
        if (existingCheck.found) {
          this.log(execId, 'ALREADY_SCHEDULED', 'Publicação já confirmada no planner Facebook. Evitando reenvio.', 'success');
          return {
            success: true,
            scheduledAt: target.toISOString(),
            plannerUrl: existingCheck.plannerUrl,
            alreadyScheduled: true
          };
        }

        // 2. Main flow: Group -> Composer -> Link Preview -> Schedule -> Date -> Time -> Confirm
        await this.goToGroup(execId, page, input.groupUrl);
        await this.openComposer(execId, page, input.groupUrl);
        await this.generateLinkPreview(execId, page, input.content, input.affiliateUrl);
        await this.openScheduleDirect(execId, page);
        await this.setDate(execId, page, input.scheduledDate);
        await this.setTime(execId, page, input.scheduledTime);

        // 3. Confirm and verify
        plannerUrl = input.groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
        const confirmResult = await this.confirmAndVerify(
          execId,
          page,
          input.groupUrl,
          input.content,
          input.scheduledDate,
          input.scheduledTime,
          input.productName
        );

        submitted = confirmResult.submitted;
        if (confirmResult.plannerUrl) plannerUrl = confirmResult.plannerUrl;

        const scheduledAt = target.toISOString();
        if (confirmResult.success) {
          this.log(execId, 'SCHEDULE_SUCCESS', `scheduledAt=${scheduledAt} planner=${confirmResult.plannerUrl} durationMs=${Date.now() - started}`, 'success');
          return {
            success: true,
            scheduledAt,
            plannerUrl: confirmResult.plannerUrl,
            submitted: true
          };
        }

        // Click was submitted but confirmation was uncertain (e.g. planner verification timed out)
        if (confirmResult.uncertain || submitted) {
          this.log(execId, 'SCHEDULE_UNCERTAIN', confirmResult.error || 'Agendamento incerto.', 'warn');
          return {
            success: false,
            submitted: true,
            uncertain: true,
            plannerUrl,
            error: confirmResult.error || 'FACEBOOK_CONFIRMATION_UNCERTAIN: Clique de agendamento enviado, mas verificação no planner não confirmou a tempo.'
          };
        }

        throw new Error(confirmResult.error || 'FACEBOOK_SCHEDULE_CONFIRMATION_FAILED');
      } catch (error: any) {
        if (submitted) {
          // If "Programar" was already clicked before error occurred, treat as UNCERTAIN
          this.log(execId, 'SCHEDULE_ERROR_POST_SUBMIT', `Erro após clique de agendamento: ${error.message}`, 'warn');
          return {
            success: false,
            submitted: true,
            uncertain: true,
            plannerUrl,
            error: `FACEBOOK_CONFIRMATION_UNCERTAIN: ${error.message}`
          };
        }

        this.log(execId, 'SCHEDULE_FAILED', `error=${error.message} durationMs=${Date.now() - started}`, 'error');
        return {
          success: false,
          submitted: false,
          uncertain: false,
          error: error.message
        };
      }
    });
  }

  async checkScheduledPost(groupUrl: string, content: string, date: string, time: string, productName?: string): Promise<{ found: boolean; plannerUrl: string }> {
    return this.serial(async () => {
      await facebookSession.requireAuthenticated();
      const page = await facebookBrowser.getOperationalPage();
      return this.checkPostInPlanner(page, groupUrl, content, date, time, productName);
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
      const execId = crypto.randomUUID().slice(0, 8);
      try {
        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.getOperationalPage();
        await this.goToGroup(execId, page, groupUrl);
        const expected = new URL(groupUrl), actual = new URL(page.url());
        const title = await page.title().catch(() => '');
        const accessible = actual.origin === expected.origin && actual.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '') && /A Loja Do Mecânico/i.test(title);
        this.log(execId, 'GROUP_VERIFY', 'accessible=' + accessible + ' url=' + page.url() + ' title=' + title);
        return { accessible, message: accessible ? 'Grupo acessível.' : `Grupo não validado. url=${page.url()} title=${title}` };
      } catch (error: any) {
        this.log(execId, 'GROUP_VERIFY_FAILED', 'error=' + error.message, 'error');
        return { accessible: false, message: error.message };
      }
    });
  }
}

export const facebookAutomation = new FacebookAutomationService();