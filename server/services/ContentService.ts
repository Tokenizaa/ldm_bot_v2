import { Product } from '../types.js';
import { FacebookCopyAgent } from './FacebookCopyAgent.js';
import { logger } from './LoggerService.js';
import { buildAffiliateUrl } from '../utils/affiliate.js';

export interface GeneratedProductCopy {
  content: string;
  affiliateUrl: string;
}

export class ContentService {
  private readonly copyAgent = new FacebookCopyAgent();

  async generateCopyForProduct(product: Product, customModel?: string): Promise<GeneratedProductCopy> {
    const affiliateUrl = buildAffiliateUrl(product.affiliate_url || product.original_url);

    if (!affiliateUrl.includes('/20889?afiliado=')) {
      const error = `URL de afiliado inválida: ${affiliateUrl}`;
      logger.ai(error, 'error');
      throw new Error(error);
    }

    const result = await this.copyAgent.generate(product, customModel);
    if (!result.success || !result.content.trim()) {
      throw new Error(result.error || 'Agente de Copy não conseguiu gerar a publicação.');
    }

    const safe = await this.copyAgent.ensurePublicationCopy(product, result.content, customModel);
    return { content: safe, affiliateUrl };
  }

  isPublicationCopySafe(product: Product, content: string): boolean {
    return this.copyAgent.isPublicationReady(content, product);
  }

  /**
   * Publication-time safety gate only.
   *
   * The Scheduler consumes product data prepared by the crawler. It must not
   * silently invoke the AI as part of normal scheduling. Missing or invalid
   * persisted copy is a readiness error and must be repaired by the crawler
   * pipeline before the product becomes schedulable.
   */
  async ensureCopyForPublication(product: Product, existingCopy?: string): Promise<GeneratedProductCopy> {
    const affiliateUrl = buildAffiliateUrl(product.affiliate_url || product.original_url);
    if (!affiliateUrl.includes('/20889?afiliado=')) {
      throw new Error('URL de afiliado inválida: ' + affiliateUrl);
    }

    const content = String(existingCopy || '').trim();
    if (!content || !this.copyAgent.isPublicationReady(content, product)) {
      logger.scheduler(`PRODUCT_NOT_READY product=${product.id} reason=facebook_copy_missing_or_invalid`, 'warn');
      throw new Error('PRODUCT_NOT_READY');
    }

    return { content, affiliateUrl };
  }
}

export const contentService = new ContentService();
