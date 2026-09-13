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
    if (!this.isCanonicalAffiliateUrl(product, affiliateUrl)) {
      const error = `URL de afiliado inválida ou fora do padrão canônico: ${affiliateUrl}`;
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

  getPublicationValidationReason(content: string, product: Product): string {
    return this.copyAgent.getPublicationValidationReason(content, product);
  }

  private isCanonicalAffiliateUrl(product: Product, canonicalUrl: string): boolean {
    const stored = String(product.affiliate_url || '').trim();
    return Boolean(canonicalUrl) && stored === canonicalUrl;
  }

  /**
   * Publication-time safety gate only.
   * The Scheduler consumes product data prepared by the crawler and must not
   * silently invoke AI or repair affiliate URLs during normal scheduling.
   */
  async ensureCopyForPublication(product: Product, existingCopy?: string): Promise<GeneratedProductCopy> {
    const affiliateUrl = buildAffiliateUrl(product.affiliate_url || product.original_url);
    if (!this.isCanonicalAffiliateUrl(product, affiliateUrl)) {
      throw new Error('URL de afiliado inválida ou fora do padrão canônico: ' + affiliateUrl);
    }

    const content = String(existingCopy || '').trim();
    if (!content) {
      logger.scheduler(`PRODUCT_NOT_READY product=${product.id} reason=facebook_copy_missing`, 'error');
      throw new Error('PRODUCT_NOT_READY');
    }
    if (!this.copyAgent.isPublicationReady(content, product)) {
      const reason = this.copyAgent.getPublicationValidationReason(content, product);
      logger.scheduler(`PRODUCT_NOT_READY product=${product.id} reason=facebook_copy_invalid validation=${reason}`, 'error');
      throw new Error(`PRODUCT_NOT_READY:facebook_copy_invalid:${reason}`);
    }

    return { content, affiliateUrl };
  }
}

export const contentService = new ContentService();
