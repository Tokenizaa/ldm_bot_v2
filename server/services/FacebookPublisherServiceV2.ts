import { Page } from 'playwright';
import { storage } from './StorageService.js';
import { logger } from './LoggerService.js';
import { contentService } from './ContentService.js';
import { facebookBrowser } from './FacebookBrowserService.js';
import { facebookSession } from './FacebookSessionService.js';

export interface FacebookScheduleInput {
  groupUrl: string;
  content: string;
  affiliateUrl: string;
  scheduledDate: string;
  scheduledTime: string;
}
export interface FacebookScheduleResult { success: boolean; scheduledAt?: string; postUrl?: string; error?: string; }

export class FacebookPublisherServiceV2 {
  private queue: Promise<void> = Promise.resolve();
  private async serial<T>(task: () => Promise<T>): Promise<T> { const previous = this.queue; let release!: () => void; this.queue = new Promise(resolve => { release = resolve; }); await previous; try { return await task(); } finally { release(); } }

  private composerEditor(page: Page) {
    return page.locator(
      '[role="dialog"] [data-lexical-editor="true"][contenteditable="true"]:not([aria-label*="Comente" i]), ' +
      '[role="dialog"] [contenteditable="true"][role="textbox"]:not([aria-label*="Comente" i]), ' +
      '[role="dialog"] [contenteditable="true"][aria-placeholder*="Escreva" i]'
    ).first();
  }

  private async openComposer(page: Page): Promise<void> {
    const triggers = [
      page.getByRole('button', { name: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first(),
      page.locator('[role="button"][aria-label*="Criar uma publicação" i]').first(),
      page.locator('[role="button"][aria-label*="Escreva algo" i]').first(),
      page.locator('div[role="button"]').filter({ hasText: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first()
    ];
    for (const trigger of triggers) {
      if (!(await trigger.count().catch(() => 0)) || !(await trigger.isVisible().catch(() => false))) continue;
      await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
      try { await trigger.click({ timeout: 8000 }); }
      catch { const box = await trigger.boundingBox().catch(() => null); if (!box) continue; await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }
      await page.waitForTimeout(1000);
      const editor = this.composerEditor(page);
      if (await editor.count() && await editor.isVisible().catch(() => false)) return;
    }
    throw new Error('FACEBOOK_COMPOSER_NOT_FOUND');
  }

  private async typeIntoComposer(page: Page, content: string): Promise<void> {
    const editor = this.composerEditor(page);
    if (!(await editor.count())) throw new Error('FACEBOOK_CONTENT_FIELD_NOT_FOUND');
    await editor.focus();
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.insertText(content);
    await page.waitForTimeout(700);
    const actual = await editor.textContent().catch(() => '');
    if (!actual?.includes(content.slice(0, Math.min(30, content.length)))) throw new Error('FACEBOOK_CONTENT_INPUT_FAILED');
  }

  private async createPreviewThenRemoveUrl(page: Page, copy: string, affiliateUrl: string): Promise<void> {
    await this.typeIntoComposer(page, `${copy.trim()}\n${affiliateUrl}`);
    await page.waitForTimeout(4500);
    const editor = this.composerEditor(page);
    const before = await editor.textContent().catch(() => '');
    if (!before?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_PREVIEW_NOT_CREATED');
    await editor.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(1000);
    const after = await editor.textContent().catch(() => '');
    if (after?.includes(affiliateUrl)) throw new Error('FACEBOOK_LINK_NOT_REMOVED_FROM_COPY');
  }

  private async openScheduleMenu(page: Page): Promise<void> {
    const dialog = page.locator('[role="dialog"]').last();
    if (!(await dialog.count())) throw new Error('FACEBOOK_COMPOSER_DIALOG_NOT_FOUND');

    // Canonical map: "Mais opções de post" is a semantic control. Prefer
    // accessible name/role, then visible text; never depend on CSS classes.
    const candidates = [
      dialog.getByRole('button', { name: /Mais opções de post|Mais opções|More options(?: for post)?/i }).last(),
      dialog.locator('[role="button"][aria-label*="Mais opções" i], [role="button"][aria-label*="More options" i]').last(),
      dialog.getByText(/Mais opções de post|Mais opções|More options(?: for post)?/i).last(),
      page.getByRole('button', { name: /Mais opções de post|Mais opções|More options(?: for post)?/i }).last(),
    ];

    let clicked = false;
    for (const candidate of candidates) {
      if (!(await candidate.count().catch(() => 0)) || !(await candidate.isVisible().catch(() => false))) continue;
      await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
      try {
        await candidate.click({ timeout: 10000 });
        clicked = true;
        break;
      } catch {
        const box = await candidate.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          clicked = true;
          break;
        }
      }
    }

    if (!clicked) throw new Error('FACEBOOK_MORE_OPTIONS_NOT_FOUND');

    const option = page.getByRole('menuitem', { name: /Programar post|Agendar post|Schedule post/i }).last();
    if (await option.count() && await option.isVisible().catch(() => false)) {
      await option.click({ timeout: 10000 });
    } else {
      const textOption = page.getByText(/Programar post|Agendar post|Schedule post/i).last();
      if (!(await textOption.count()) || !(await textOption.isVisible().catch(() => false))) {
        throw new Error('FACEBOOK_SCHEDULE_OPTION_NOT_FOUND');
      }
      await textOption.click({ timeout: 10000 });
    }
    await page.waitForTimeout(700);
  }

  private async selectDate(page: Page, isoDate: string): Promise<void> {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(isoDate)) throw new Error('FACEBOOK_DATE_FIELD_NOT_FOUND');
    // Canonical map observed an input[type="date"]; use the native field first.
    const field = page.locator('input[type="date"]').last();
    if (!(await field.count()) || !(await field.isVisible().catch(() => false))) {
      throw new Error('FACEBOOK_DATE_FIELD_NOT_FOUND');
    }
    await field.fill(isoDate);
    await field.press('Tab').catch(() => undefined);
  }

  private async selectTime(page: Page, time: string): Promise<void> {
    if (!/^\\d{2}:\\d{2}$/.test(time)) throw new Error('FACEBOOK_TIME_FIELD_NOT_FOUND');
    // Canonical map observed an input[type="time"]; use the native field first.
    const field = page.locator('input[type="time"]').last();
    if (!(await field.count()) || !(await field.isVisible().catch(() => false))) {
      throw new Error('FACEBOOK_TIME_FIELD_NOT_FOUND');
    }
    await field.fill(time);
    await field.press('Tab').catch(() => undefined);
  }

  private async confirmSchedule(page: Page): Promise<void> {
    const dialog = page.locator('[role="dialog"]').last();
    const button = dialog.getByRole('button', { name: /^(Programar|Agendar|Schedule)$/i }).last();
    if (!(await button.count())) throw new Error('FACEBOOK_SCHEDULE_BUTTON_NOT_FOUND');
    if (await button.isDisabled().catch(() => false) || (await button.getAttribute('aria-disabled')) === 'true') throw new Error('FACEBOOK_SCHEDULE_BUTTON_DISABLED');
    await button.click({ timeout: 10000 });
    await page.waitForTimeout(2500);
    const dialogStillOpen = await dialog.isVisible().catch(() => false);
    if (dialogStillOpen) {
      const text = (await dialog.innerText().catch(() => '')).toLowerCase();
      if (!/agendad|programad|scheduled/.test(text)) throw new Error('FACEBOOK_SCHEDULE_CONFIRMATION_FAILED');
    }
  }

  async schedule(input: FacebookScheduleInput): Promise<FacebookScheduleResult> {
    return this.serial(async () => {
      try {
        if (!input.groupUrl?.includes('/groups/')) throw new Error('FACEBOOK_GROUP_URL_INVALID');
        if (!input.affiliateUrl?.includes('/20889')) throw new Error('FACEBOOK_AFFILIATE_URL_INVALID');
        if (!input.content?.trim() || /https?:\/\//i.test(input.content) || /R\$/i.test(input.content)) throw new Error('FACEBOOK_CONTENT_INVALID');
        const target = new Date(`${input.scheduledDate}T${input.scheduledTime}:00`);
        if (Number.isNaN(target.getTime()) || target.getTime() <= Date.now()) throw new Error('FACEBOOK_SCHEDULE_IN_PAST');
        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.page();
        await page.goto(input.groupUrl, { waitUntil: 'commit', timeout: 60000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
        await this.openComposer(page);
        await this.createPreviewThenRemoveUrl(page, input.content, input.affiliateUrl);
        await this.openScheduleMenu(page);
        await this.selectDate(page, input.scheduledDate);
        await this.selectTime(page, input.scheduledTime);
        await this.confirmSchedule(page);
        const scheduledAt = target.toISOString();
        logger.facebook(`Facebook agendou ${scheduledAt} no grupo ${input.groupUrl}`);
        return { success: true, scheduledAt };
      } catch (error: any) { logger.facebook(`Falha no agendamento Facebook: ${error.message}`, 'error'); return { success: false, error: error.message }; }
    });
  }

  async verifyGroup(groupUrl: string): Promise<{ accessible: boolean; message: string }> {
    return this.serial(async () => {
      try {
        await facebookSession.requireAuthenticated();
        const page = await facebookBrowser.page();
        await page.goto(groupUrl, { waitUntil: 'commit', timeout: 60000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        const url = page.url();
        const body = await page.locator('body').innerText().catch(() => '');
        const blocked = /conteúdo não está disponível|página não encontrada|link pode estar corrompido/i.test(body);
        const composer = page.locator('[role="button"]:has-text("Escreva algo"), [aria-label*="Criar uma publicação" i], [aria-label*="Escreva algo" i]').filter({ hasNotText: /Comente como/i }).first();
        const accessible = !blocked && /\/groups\//i.test(url) && await composer.count() > 0;
        return { accessible, message: accessible ? 'Grupo acessível e composer de publicação detectado.' : `Grupo não validado. URL atual: ${url}` };
      } catch (error: any) { return { accessible: false, message: error.message }; }
    });
  }

  async publishTest(groupUrl: string): Promise<{ success: boolean; message: string; productId?: string }> {
    return this.serial(async () => {
      try {
        await facebookSession.requireAuthenticated();
        const product = (await storage.getProducts(true)).find(p => p.active && p.affiliate_url.includes('/20889') && p.facebook_copy?.trim());
        if (!product) return { success: false, message: 'Nenhum produto real com facebook_copy e afiliado /20889 disponível.' };
        const generated = await contentService.generateCopyForProduct(product);
        const page = await facebookBrowser.page();
        await page.goto(groupUrl, { waitUntil: 'commit', timeout: 60000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        await this.openComposer(page);
        await this.createPreviewThenRemoveUrl(page, generated.content, generated.affiliateUrl);
        const dialog = page.locator('[role="dialog"]').last();
        const publish = dialog.getByRole('button', { name: /^(Publicar|Postar)$/i }).last();
        if (!(await publish.count()) || await publish.isDisabled().catch(() => false)) throw new Error('FACEBOOK_PUBLISH_BUTTON_NOT_READY');
        await publish.click({ timeout: 10000 });
        return { success: true, message: `Teste publicado com produto ${product.id}.`, productId: product.id };
      } catch (error: any) { logger.facebook(`Falha no teste Facebook: ${error.message}`, 'error'); return { success: false, message: error.message }; }
    });
  }
}
export const facebookPublisherV2 = new FacebookPublisherServiceV2();
