import { Page } from 'playwright';
import { Product } from '../types.js';
import { FacebookService, facebookService } from './FacebookService.js';
import { storage } from './StorageService.js';
import { logger } from './LoggerService.js';

export interface FacebookTestPublishResult {
  success: boolean;
  message: string;
  postUrl?: string;
  productId?: string;
}

export class FacebookPublisherService {
  constructor(private readonly facebook: FacebookService) {}

  private async openComposer(page: Page): Promise<boolean> {
    const triggers = [
      page.getByRole('button', { name: /Escreva algo|No que você está pensando|Criar uma publicação/i }).first(),
      page.locator('[role="button"][aria-label*="Criar uma publicação" i]').first(),
      page.locator('[role="button"][aria-label*="Escreva algo" i]').first(),
      page.locator('div[role="button"]:has-text("Escreva algo")').first(),
      page.locator('div[role="button"]:has-text("No que você está pensando")').first()
    ];

    for (const trigger of triggers) {
      if (!(await trigger.count().catch(() => 0))) continue;
      if (!(await trigger.isVisible().catch(() => false))) continue;
      await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
      await trigger.click({ timeout: 10000 });
      await page.waitForTimeout(1000);
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
    const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.current_price);
    return [
      '🔥 OFERTA TESTE — Loja do Mecânico',
      '',
      product.product_name,
      product.brand ? `Marca: ${product.brand}` : '',
      product.sku ? `Código: ${product.sku}` : '',
      `💰 ${price}`,
      '',
      'Confira a oferta:',
      product.affiliate_url,
      '',
      '#oferta #ferramentas #lojadomecanico'
    ].filter(Boolean).join('\n');
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

    if (!(await this.facebook.isGroupComposerAvailable(page))) {
      return { success: false, message: 'Composer do grupo não foi encontrado.' };
    }
    if (!(await this.openComposer(page))) return { success: false, message: 'Não foi possível abrir o composer.' };

    const content = this.buildTestContent(product);
    if (!(await this.fillComposer(page, content))) {
      return { success: false, message: 'Campo de conteúdo da publicação não foi encontrado.' };
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
