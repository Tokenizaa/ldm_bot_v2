import { Product } from '../types.js';
import { nvidiaAI } from './NvidiaAIService.js';
import { logger } from './LoggerService.js';
import { buildAffiliateUrl } from '../utils/affiliate.js';

export class ContentService {
  async generateCopyForProduct(product: Product, customModel?: string): Promise<{ content: string; affiliateUrl: string }> {
    const affiliateUrl = buildAffiliateUrl(product.affiliate_url || product.original_url);

    if (!affiliateUrl.endsWith('/20889')) {
      const error = `URL de afiliado inválida: ${affiliateUrl}`;
      logger.ai(error, 'error');
      throw new Error(error);
    }

    const result = await nvidiaAI.generateProductCopy(product, affiliateUrl, customModel);
    if (!result.success || !result.content.trim()) {
      throw new Error(result.error || 'NVIDIA AI não conseguiu gerar a copy.');
    }

    return { content: result.content, affiliateUrl };
  }
}

export const contentService = new ContentService();
