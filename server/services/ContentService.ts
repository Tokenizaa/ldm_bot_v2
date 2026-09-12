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

    if (!affiliateUrl.endsWith('/20889')) {
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

  /**
   * Reuses a persisted copy only when it passes the canonical publication gate.
   * Invalid legacy rows are regenerated through the same deterministic safety path.
   */
  async ensureCopyForPublication(product: Product, existingCopy?: string, customModel?: string): Promise<GeneratedProductCopy> {
    const affiliateUrl = buildAffiliateUrl(product.affiliate_url || product.original_url);
    if (!affiliateUrl.endsWith('/20889')) {
      throw new Error('URL de afiliado inválida: ' + affiliateUrl);
    }
    const content = await this.copyAgent.ensurePublicationCopy(product, existingCopy, customModel);
    return { content, affiliateUrl };
  }
}

export const contentService = new ContentService();
