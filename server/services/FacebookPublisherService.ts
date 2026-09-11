import { Page } from 'playwright';
import { Product } from '../types.js';
import { FacebookService, facebookService } from './FacebookService.js';
import { storage } from './StorageService.js';
import { logger } from './LoggerService.js';
import { contentService } from './ContentService.js';

export interface FacebookTestPublishResult {
  success: boolean;
  message: string;
  postUrl?: string;
  productId?: string;
}

export class FacebookPublisherService {
  constructor(private readonly facebook: FacebookService) {}

  private async openComposer(page: Page): Promise<boolean> {
    // Facebook changes the composer markup frequently. Prefer semantic/accessible
    // labels, then fall back to the visible "Escreva algo..." surface in the group.
    const triggers = [
      page.getByRole('button', { name: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first(),
      page.locator('[role="button"][aria-label*="Criar uma publicação" i]').first(),
      page.locator('[role="button"][aria-label*="Escreva algo" i]').first(),
      page.locator('[role="button"]').filter({ hasText: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first(),
      page.locator('div[role="button"]').filter({ hasText: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first(),
      page.getByText(/Escreva algo|No que você está pensando|Criar uma publicação/i, { exact: false }).first()
    ];

    for (const trigger of triggers) {
      if (!(await trigger.count().catch(() => 0))) continue;
      if (!(await trigger.isVisible().catch(() => false))) continue;

      await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
      try {
        await trigger.click({ timeout: 10000 });
      } catch {
        // Some Facebook surfaces are nested/covered. Click the center point as
        // a final interaction fallback without closing or changing the profile.
        const box = await trigger.boundingBox().catch(() => null);
        if (!box) continue;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }

      await page.waitForTimeout(1200);
      if (await this.getComposerTextbox(page).count()) return true;
    }

    return false;
  }

  private getComposerTextbox(page: Page) {
    return page.locator(
      '[role="dialog"] [contenteditable="true"][role="textbox"], ' +
      '[role="dialog"] [contenteditable="true"], ' +
      '[role="dialog"] textarea, ' +
      '[role="dialog"] input[role="textbox"]'
    ).first();
  }

  /**
   * Facebook needs the raw affiliate URL long enough to fetch its Open Graph
   * preview. After the preview is created, remove the URL from the text so the
   * published copy remains evergreen and the preview remains responsible for
   * current price/metadata.
   */
  private async fillCopyAndBuildLinkPreview(page: Page, copy: string, affiliateUrl: string): Promise<boolean> {
    const textbox = this.getComposerTextbox(page);
    if (!(await textbox.count().catch(() => 0))) return false;

    await textbox.scrollIntoViewIfNeeded().catch(() => undefined);
    await textbox.click({ timeout: 10000 });
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.insertText(copy.trim() + '\\n' + affiliateUrl);
    await page.waitForTimeout(4500);

    const bodyText = await page.locator('[role="dialog"]').last().innerText().catch(() => '');
    if (!bodyText.includes(affiliateUrl) && !(await textbox.textContent().catch(() => '')).includes(affiliateUrl)) {
      return false;
    }

    // URL is deliberately the final line. Remove only that line with keyboard
    // selection so Facebook's editor state receives real input events.
    await textbox.click({ timeout: 10000 });
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace').catch(() => undefined);
    await page.waitForTimeout(800);

    const remaining = await textbox.textContent().catch(() => '');
    if (remaining.includes(affiliateUrl)) {
      return false;
    }

    return true;
  }

  private async fillComposer(page: Page, content: string): Promise<boolean> {
    const textbox = this.getComposerTextbox(page);
    if (!(await textbox.count().catch(() => 0))) return false;

    await textbox.scrollIntoViewIfNeeded().catch(() => undefined);
    await textbox.click({ timeout: 10000 });

    // Facebook's composer is usually a contenteditable React surface.
    // keyboard.insertText generates the input events that its editor observes;
    // locator.fill() can change the DOM without updating Facebook's internal state.
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.insertText(content);
    await page.waitForTimeout(1200);

    const value = await textbox.textContent().catch(() => '');
    const aria = await textbox.getAttribute('aria-label').catch(() => '');
    return !!(value?.includes(content.slice(0, 24)) || aria?.includes(content.slice(0, 24)));
  }

  private async publish(page: Page): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    const dialogs = page.locator('[role="dialog"]');
    const dialog = dialogs.last();

    const candidates = [
      dialog.getByRole('button', { name: /^Publicar$/i }).last(),
      dialog.getByRole('button', { name: /^Postar$/i }).last(),
      dialog.locator('[role="button"]').filter({ hasText: /^Publicar$/i }).last(),
      dialog.locator('[role="button"]').filter({ hasText: /^Postar$/i }).last(),
      dialog.locator('button').filter({ hasText: /Publicar|Postar/i }).last(),
      page.locator('[role="dialog"] [aria-label*="Publicar" i], [role="dialog"] [aria-label*="Postar" i]').last()
    ];

    let button: ReturnType<Page['locator']> | null = null;
    for (const candidate of candidates) {
      if (await candidate.count().catch(() => 0) && await candidate.isVisible().catch(() => false)) {
        button = candidate;
        break;
      }
    }

    if (!button) {
      // Do not close the browser: the visible page is the diagnostic state.
      return { success: false, error: 'Botão Publicar/Postar não encontrado no composer visível.' };
    }

    const disabled =
      await button.isDisabled().catch(() => false) ||
      (await button.getAttribute('aria-disabled').catch(() => null)) === 'true';

    if (disabled) {
      return { success: false, error: 'Botão Publicar/Postar está desabilitado após preencher o conteúdo.' };
    }

    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    await button.click({ timeout: 10000 });
    await page.waitForTimeout(4000);

    const postLink = page.locator('a[href*="/posts/"], a[href*="/permalink/"]').first();
    const href = await postLink.getAttribute('href').catch(() => null);
    if (href) return { success: true, postUrl: href };

    const successText = page.getByText(/publicado|postado|publicação foi criada|seu post foi/i).first();
    if (await successText.isVisible().catch(() => false)) return { success: true };

    const stillOpen = await page.locator('[role="dialog"]').last().isVisible().catch(() => false);
    if (!stillOpen) return { success: true };

    return { success: false, error: 'Facebook não confirmou o envio da publicação.' };
  }

  private buildTestContent(product: Product): string {
    // Kept only for backwards compatibility with callers that inspect this
    // service. Actual publication uses the canonical LLM copy agent.
    return [
      '🔥 OFERTA — Loja do Mecânico',
      '',
      product.product_name,
      product.sku ? `Código: ${product.sku}` : '',
      '',
      'Confira a oferta:',
      '@todos',
      '',
      '#oferta #ferramentas #lojadomecanico'
    ].filter(Boolean).join('\\n');
  }

  async publishTest(groupUrl: string): Promise<FacebookTestPublishResult> {
    if (!groupUrl?.includes('/groups/')) return { success: false, message: 'URL do grupo inválida.' };
    if (!(await this.facebook.ensureFacebookSession())) {
      return { success: false, message: 'Facebook não está autenticado no perfil persistente.' };
    }

    const products = await storage.getProducts();
    const product = products.find(p => p.active && p.current_price > 0 && p.affiliate_url.includes('/20889'));
    if (!product) return { success: false, message: 'Nenhum produto real elegível encontrado no Supabase.' };

    const page = await this.facebook.getAuthenticatedPage();
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(1500);

    // Do not preflight the composer with a brittle selector. The group page is
    // the source of truth; open the real composer and inspect the resulting dialog.
    if (!(await this.openComposer(page))) {
      logger.facebook('Composer não abriu. Navegador mantido aberto para diagnóstico.', 'error');
      return { success: false, message: 'Não foi possível abrir o composer do grupo.' };
    }

    const generated = await contentService.generateCopyForProduct(product);
    if (!(await this.fillCopyAndBuildLinkPreview(page, generated.content, generated.affiliateUrl))) {
      return { success: false, message: 'Não foi possível preencher a copy e gerar o preview Open Graph do produto.' };
    }

    await page.waitForTimeout(2000);
    const result = await this.publish(page);
    if (!result.success) {
      logger.facebook(`Teste de publicação falhou: ${result.error}`, 'error');
      return { success: false, message: result.error || 'Falha ao publicar.' , productId: product.id };
    }

    logger.facebook(`Teste de publicação concluído para produto ${product.id}.`);
    return {
      success: true,
      message: 'Publicação de teste criada no grupo com produto real do Supabase.',
      postUrl: result.postUrl,
      productId: product.id
    };
  }
}

export const facebookPublisher = new FacebookPublisherService(facebookService);
