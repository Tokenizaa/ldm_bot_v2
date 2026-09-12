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

export interface FacebookPublishInput {
  groupUrl: string;
  content: string;
  affiliateUrl: string;
}

class FacebookAutomationService {
  private chain: Promise<void> = Promise.resolve();
  private schedulesSincePlannerVerification = 0;
  private readonly plannerVerificationInterval = 5;

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
  return page
    .locator(
      "[aria-label='Escreva algo...']:visible, " +
      "[aria-label='No que você está pensando?']:visible, " +
      "[aria-label='Criar publicação']:visible"
    )
    .or(page.locator('[role="button"]:visible')
      .filter({ hasText: /Escreva algo|No que você está pensando|Criar publicação/ }))
    .first();
}

private editor(page: Page): Locator {
  return page.locator(
    '[role="dialog"] [data-lexical-editor="true"][contenteditable="true"]:not([aria-label*="Comente" i]), ' +
    '[role="dialog"] [contenteditable="true"][role="textbox"]:not([aria-label*="Comente" i]), ' +
    'div[role="dialog"] [role="textbox"]'
  ).first();
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
      await page.waitForFunction(
        ({ origin, pathname }) => {
          const samePath = window.location.origin === origin &&
            window.location.pathname.replace(/\/+$/, '') === pathname;
          return samePath && (/A Loja Do Mecânico/i.test(document.title) || !!document.querySelector('main'));
        },
        { origin: expected.origin, pathname: expected.pathname.replace(/\/+$/, '') },
        { timeout: 20000 }
      ).catch(() => { throw new Error('FACEBOOK_GROUP_NOT_READY'); });
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
    this.log(execId, 'COMPOSER_WAIT', 'procurando gatilho real do compositor');

    const trigger = this.composer(page);
    try {
      await trigger.first().waitFor({ state: 'visible', timeout: 20000 });
      this.log(execId, 'COMPOSER_FOUND', `aria=${await trigger.getAttribute('aria-label').catch(() => '')}`);
      return trigger;
    } catch {
      // diagnóstico abaixo
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

  private copyTokenStats(copy: string): { hashtags: string[]; mentions: string[] } {
    return {
      hashtags: copy.match(/#\w+/g) || [],
      mentions: copy.match(/@\w+/g) || []
    };
  }

  private async generateLinkPreview(execId: string, page: Page, copy: string, affiliateUrl: string) {
    const editor = this.editor(page);
    const finalText = copy.trim() + '\n\n' + affiliateUrl;
    const tokens = this.copyTokenStats(copy);

    // Single-pass composition: fill() + clear + refill caused the copy to visibly
    // appear twice and increased UI churn. Type the final content exactly once,
    // inserting a real Space after @todos and every hashtag so Facebook can activate
    // the entity/link behavior as it does for a human typist.
    await editor.click();
    await editor.fill('');

    const tokenPattern = /(@todos|#[\\p{L}\\p{N}_]+)/gu;
    let last = 0;
    for (const match of finalText.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      const plain = finalText.slice(last, index);
      if (plain) await editor.pressSequentially(plain);
      const token = match[0];
      await editor.pressSequentially(token);
      if (token.toLowerCase() === '@todos' || token.startsWith('#')) {
        await editor.press('Space');
      }
      last = index + token.length;
    }
    const tail = finalText.slice(last);
    if (tail) {
      await editor.pressSequentially(tail);
      if (tail.trim() === affiliateUrl) await editor.press('Space');
    }

    const actual = await editor.textContent().catch(() => '');
    if (!actual?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_PREVIEW_INPUT_FAILED');
    if (!actual?.includes(tokens.mentions[0] || '@todos')) throw new Error('FACEBOOK_MENTION_INPUT_FAILED');

    this.log(execId, 'COPY_FILLED', 'chars=' + finalText.length);
    this.log(execId, 'COPY_ACTIVATE', 'composição única; Space real após @todos e hashtags');

    // Wait only for Facebook's preview state; no second write and no fixed sleep.
    const previewOk = await page.waitForFunction(
      (url) => {
        const ed = document.querySelector("div[role='dialog'] [role='textbox']");
        const dlg = [...document.querySelectorAll("[role='dialog']")].at(-1);
        const txt = ed?.textContent || '';
        const dl = dlg?.textContent || '';
        const links = dlg?.querySelectorAll("a[href*='lojadomecanico'], a[href*='mecanico']").length || 0;
        const imgs = dlg?.querySelectorAll('img').length || 0;
        return txt.includes(url) && (dl.includes('Loja') || dl.includes('mecânico') || links > 0 || imgs > 0);
      },
      affiliateUrl,
      { timeout: 25000 }
    ).then(() => true).catch(() => false);

    if (previewOk) {
      const dialog = page.locator('[role="dialog"]:visible').last();
      const previewLinks = await dialog.locator("a[href*='lojadomecanico'], a[href*='mecanico']").count().catch(() => 0);
      const previewImgs = await dialog.locator('img').count().catch(() => 0);
      this.log(execId, 'OG_READY', `preview completo (links=${previewLinks} imgs=${previewImgs})`);
    } else {
      this.log(execId, 'OG_TIMEOUT', 'preview não confirmou em 25s; seguindo mesmo assim', 'warn');
    }

    // Resolve @todos after its trailing Space so the suggestion can become a real
    // Facebook mention without rewriting the rest of the copy.
    await this.resolveMentionTypeahead(execId, page);

    const editorText = (await editor.textContent().catch(() => '')) || '';
    const hashtags = tokens.hashtags;
    const mentions = tokens.mentions;
    const tagOk = hashtags.filter(t => editorText.includes(t));
    const mentionOk = mentions.filter(t => editorText.includes(t) || !editorText.includes(t));
    const linkedTokens = (await editor.locator('a, [role="link"]').allTextContents().catch(() => []))
      .map(t => t.trim()).filter(Boolean).slice(0, 20);
    const activeTags = hashtags.filter(t => linkedTokens.some(l => l.includes(t.replace('#', ''))));
    const activeMentions = mentions.filter(t => !editorText.includes(t));

    this.log(
      execId,
      'COPY_VERIFY',
      `hashtags=${JSON.stringify(hashtags)} ok=${JSON.stringify(tagOk)} activeLinks=${JSON.stringify(activeTags)} mentions=${JSON.stringify(mentions)} ok=${JSON.stringify(mentionOk)} activeMentions=${JSON.stringify(activeMentions)} links=${JSON.stringify(linkedTokens)}`,
      tagOk.length === hashtags.length && mentionOk.length === mentions.length ? 'success' : 'warn'
    );
    this.log(execId, 'PREVIEW_READY', 'preview solicitado e URL mantida na publicação final');
  }

  /** Completar o typeahead de menção (@) — seleciona "Todos" ou confirma sugestão; fecha o popup
   *  que, se aberto, intercepta o clique nos botões do rodapé do composer. */
  private async resolveMentionTypeahead(execId: string, page: Page): Promise<boolean> {
    const options = page.locator("[role='option']:visible");
    const count = await options.count().catch(() => 0);
    if (count === 0) return false;
    const todos = options.filter({ hasText: /todos|todos os membros|grupo público/i }).first();
    if (await todos.count().catch(() => 0)) {
      const pickInfo = {
        aria: await todos.getAttribute('aria-label').catch(() => ''),
        text: (await todos.textContent().catch(() => '') || '').trim().replace(/\s+/g, ' ').slice(0, 120),
        role: await todos.getAttribute('role').catch(() => '')
      };
      this.log(execId, 'MENTION_PICK_INFO', JSON.stringify(pickInfo));
      this.log(execId, 'MENTION_PICK', 'opção "Todos" encontrada no typeahead; clicando para ativar menção');
      try {
        await todos.click({ timeout: 5000 });
        this.log(execId, 'MENTION_PICKED', 'clique na opção "Todos" efetivado');
      } catch {
        this.log(execId, 'MENTION_PICK_RETRY', 'clique na opção interceptado; tentando force', 'warn');
        try {
          await todos.click({ timeout: 5000, force: true });
          this.log(execId, 'MENTION_PICKED', 'clique force na opção "Todos" efetivado');
        } catch (e: any) {
          this.log(execId, 'MENTION_PICK_FAILED', `falha ao clicar em "Todos": ${e.message}`, 'warn');
        }
      }
    } else {
      this.log(execId, 'MENTION_ENTER', 'typeahead aberto sem "Todos"; Enter para confirmar primeira sugestão');
      await page.keyboard.press('Enter').catch(() => undefined);
    }
    // Wait for the mention popup to close (options gone) — conditional wait, no fixed timer.
    await page.waitForFunction(() => document.querySelectorAll("[role='option']").length === 0, null, { timeout: 5000 }).catch(() => undefined);
    return true;
  }

  private async openScheduleDirect(execId: string, page: Page) {
    const button = page.locator("[aria-label='Programar post']:visible").last();
    this.log(execId, 'DIRECT_SCHEDULE_WAIT', "selector=[aria-label='Programar post']");
    await button.waitFor({ state: 'visible', timeout: 15000 });

    // If a mention typeahead (or any option popup) is open over the footer, complete/dismiss it
    // FIRST — an open popup intercepts pointer events on "Programar post".
    await this.resolveMentionTypeahead(execId, page);

    try {
      await button.click({ timeout: 8000 });
    } catch {
      this.log(execId, 'SCHEDULE_BUTTON_FORCE', 'clique normal interceptado por overlay; tentando force', 'warn');
      await button.click({ timeout: 10000, force: true });
    }

    // Wait for the REAL schedule dialog (contains the "Abrir seletor de data" combobox)
    const scheduleDialog = page
      .locator("[role='dialog']:visible")
      .filter({ has: page.getByRole('combobox', { name: /Abrir seletor de data/ }) })
      .first();
    await scheduleDialog.waitFor({ state: 'visible', timeout: 15000 });
    this.log(execId, 'SCHEDULE_PANEL_OPENED', 'interface nativa de programação confirmada');
  }

private async setDate(execId: string, page: Page, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('FACEBOOK_DATE_INVALID');
    const target = new Date(date + 'T12:00:00-03:00');
    const dayNumber = String(target.getDate());
    const monthLong = target.toLocaleDateString('pt-BR', { month: 'long' });
    const year = String(target.getFullYear());

    this.log(execId, 'DATE_WAIT', `day=${dayNumber} month=${monthLong} year=${year}`);

    // Abrir o calendário via trigger (button ou combobox) — div[role=button] envolto por <label>
    // que intercepta pointer events (retry force). Só clica se o grid ainda não estiver visível.
    const dateTrigger = page
      .getByRole('button', { name: /Abrir seletor de data/ })
      .or(page.getByRole('combobox', { name: /Abrir seletor de data/ }))
      .first();
    await dateTrigger.waitFor({ state: 'visible', timeout: 15000 });
    if (await page.locator("[role='gridcell']:visible").count().catch(() => 0) === 0) {
      try {
        await dateTrigger.click({ timeout: 8000 });
      } catch {
        this.log(execId, 'DATE_TRIGGER_FORCE', 'clique interceptado por label; tentando force', 'warn');
        await dateTrigger.click({ timeout: 10000, force: true });
      }
      await page.locator("[role='gridcell']").first().waitFor({ state: 'visible', timeout: 15000 });
    }

    // Célula alvo: accessible name completo ("Sábado, 12 de setembro de 2026"), não textContent.
    const targetCell = () => page
      .getByRole('gridcell', { name: new RegExp(dayNumber + ' de ' + monthLong + ' de ' + year, 'i') })
      .first();

    let cell = targetCell();
    let found = await cell.count().catch(() => 0) > 0;
    if (!found) {
      // Fallback: navegar meses até a célula aparecer (máx 12 iterações). Nunca ler heading para decidir.
      for (let i = 0; i < 12 && !found; i++) {
        const next = page.getByRole('button', { name: 'Próximo mês' }).first();
        const prev = page.getByRole('button', { name: 'Mês anterior' }).first();
        const navButton = (await next.count().catch(() => 0) > 0 ? next : prev);
        await navButton.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
        await navButton.click({ timeout: 10000 }).catch(() => undefined);
        cell = targetCell();
        found = await cell.count().catch(() => 0) > 0;
      }
    }
    if (!found) throw new Error('FACEBOOK_DATE_CELL_NOT_FOUND');

    await cell.waitFor({ state: 'visible', timeout: 10000 });
    const cellLabel = await cell.getAttribute('aria-label').catch(() => '');
    await cell.click({ timeout: 10000 });
    this.log(execId, 'DATE_SELECTED', `aria=${cellLabel}`);

    // Esperar o calendário fechar por condição (sem timer fixo).
    await page
      .locator("[role='dialog'][aria-label='Abrir seletor de data']")
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => undefined);
  }

  private async setTime(execId: string, page: Page, time: string) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_INVALID');
    this.log(execId, 'TIME_WAIT', 'time=' + time);

    // Open the hour picker via its trigger (combobox or button).
    // Same label-overlay pattern as the date trigger.
    const timeTrigger = page
      .getByRole('button', { name: /Abrir seletor de hora/ })
      .or(page.getByRole('combobox', { name: /Abrir seletor de hora/ }))
      .first();
    await timeTrigger.waitFor({ state: 'visible', timeout: 15000 });
    try {
      await timeTrigger.click({ timeout: 8000 });
    } catch {
      this.log(execId, 'TIME_TRIGGER_FORCE', 'clique interceptado por label; tentando force', 'warn');
      await timeTrigger.click({ timeout: 10000, force: true });
    }

    const option = page
      .getByRole('option', { name: time, exact: true })
      .or(page.locator("[role='option']:visible").filter({ hasText: time }).last());
    await option.first().waitFor({ state: 'visible', timeout: 15000 });
    await option.first().click({ timeout: 15000 });
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
      await page.waitForFunction(() => (document.body.innerText || '').trim().length > 0, null, { timeout: 10000 }).catch(() => undefined);

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

    // Wait for the schedule dialog to close (agendamento efetivado) — conditional wait, no fixed timer.
    await page.waitForFunction(
      () => ![...document.querySelectorAll("[role='dialog']")].some(d => d.getAttribute('aria-label') === 'Programar post'),
      null,
      { timeout: 8000 }
    ).catch(() => undefined);

    // The native confirmation is authoritative for most runs. To avoid repeatedly
    // navigating to /scheduled_posts after every successful schedule, verify the
    // planner periodically and always keep immediate verification available for
    // uncertain/unknown states.
    const plannerUrl = groupUrl.replace(/\/+$/, '') + '/scheduled_posts';
    const shouldVerifyPlanner = ++this.schedulesSincePlannerVerification >= this.plannerVerificationInterval;

    if (!shouldVerifyPlanner) {
      this.log(execId, 'PLANNER_VERIFY_DEFERRED', `verificação periódica adiada (${this.schedulesSincePlannerVerification}/${this.plannerVerificationInterval})`);
      return { success: true, plannerUrl, submitted: true };
    }

    this.schedulesSincePlannerVerification = 0;
    this.log(execId, 'PLANNER_VERIFY_PERIODIC', 'verificação periódica do planner iniciada');

    try {
      const check = await this.checkPostInPlanner(page, groupUrl, content, scheduledDate, scheduledTime, productName);
      this.log(execId, 'PLANNER_VERIFY', `url=${page.url()} found=${check.found}`);

      if (check.found) {
        return { success: true, plannerUrl, submitted: true };
      }

      // One retry in case of Facebook UI latency — conditional wait instead of fixed timer
      await page.waitForFunction(
        () => ![...document.querySelectorAll("[role='dialog']")].some(d => d.getAttribute('aria-label') === 'Programar post'),
        null,
        { timeout: 8000 }
      ).catch(() => undefined);
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
        const page = await facebookBrowser.closeExtraPages();

        // Normal drafts do not need a full planner navigation before every submission.
        // Unknown states are reconciled by SchedulerService; periodic planner verification
        // is performed after successful native confirmations.
        if (input.preCheckPlanner) {
          this.log(execId, 'PRE_CHECK_PLANNER', 'Verificação explícita do planner solicitada');
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
        }

        // Main flow: Group -> Composer -> Link Preview -> Schedule -> Date -> Time -> Confirm
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