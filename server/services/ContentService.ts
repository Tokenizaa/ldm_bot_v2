import { Product } from '../types.js';
import { nvidiaAI } from './NvidiaAIService.js';
import { logger } from './LoggerService.js';
import { buildAffiliateUrl } from '../utils/affiliate.js';

export class ContentService {
  async generateCopyForProduct(product: Product, customModel?: string): Promise<{ content: string; affiliateUrl: string }> {
    // Strictly build and validate affiliate url
    const affiliateUrl = buildAffiliateUrl(product.affiliate_url || product.original_url);

    // Requirement 22: Validate before publication
    if (!affiliateUrl.endsWith('/20889')) {
      const errMsg = `Affiliate URL validation failed: does not end with /20889 (${affiliateUrl})`;
      logger.ai(errMsg, 'error');
      throw new Error(errMsg);
    }

    const result = await nvidiaAI.generateProductCopy(product, affiliateUrl, customModel);
    return {
      content: result.content,
      affiliateUrl
    };
  }
}

export const contentService = new ContentService();
