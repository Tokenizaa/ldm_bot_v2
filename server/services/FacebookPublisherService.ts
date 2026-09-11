import { Page } from 'playwright';
import { Product } from '../types.js';
import { FacebookService } from './FacebookService.js';
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
    const trigger = page.locator(
      '[role="button"]:has-text("Escreva algo"), [role="button"]:has-text("No que você está pensando"), [aria-label*="Criar uma publicação"], [aria-label*="Escreva algo"]'
    ).first();
    if (!(await trigger.count())) return false;
    await trigger.click({ timeout: 10000 });
    await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
    return await page.locator(
      '[role="dialog"] [role="textbox"], [role="dialog"] [contenteditable="true"], [role="textbox"][contenteditable="true"]'
    ).count() > 0;
  }

  private async fillComposer(page: Page, content: string): Promise<boolean> {
    const textbox = page.locator(
      '[role="dialog"] [role="textbox"], [role="dialog"] [contenteditable="true"], [role="textbox"][contenteditable="true"]'
    ).first();
    if (!(await textbox.count())) return false;
    await textbox.fill(content);
    return true;
  }

  private async publish(page: Page): Promise<{ success: boolean; postUrl?: string; error?: string }> {
    const dialog = page.locator('[role="dialog"]').last();
    const button = dialog.getByRole('button', { name: /^(Publicar|Postar)$/i }).last();
    if (!(await button.count())) return { success: false, error: 'Botão Publicar/Postar não encontrado.' };
    if (await button.isDisabled().catch(() => false) || (await button.getAttribute('aria-disabled')) === 'true') {
      return { success: false, error: 'Botão Publicar/Postar está desabilitado.' };
    }

    await button.click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    const successText = page.getByText(/publicado|postado|publicação foi criada|seu post foi/i).first();
    const dialogStillOpen = await page.locator('[role="dialog"]').last().isVisible().catch(() => false);
    const postLink = page.locator('a[href*="/posts/"], a[href*="/permalink/"]').first();
    const href = await postLink.getAttribute('href').catch(() => null);

    if (href) return { success: true, postUrl: href };
    if (await successText.isVisible().catch(() => false)) return { success: true };
    if (!dialogStillOpen) return { success: true };

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

export const facebookPublisher = new FacebookPublisherService(
  (await import('./FacebookService.js')).facebookService
);
