import 'dotenv/config';
import { storage } from '../server/services/StorageService.js';
import { contentService } from '../server/services/ContentService.js';
import { buildAffiliateUrl } from '../server/utils/affiliate.js';

async function main() {
  const products = await storage.getProducts(true);
  const report = { total: products.length, validBefore: 0, regenerated: 0, validAfter: 0, invalid: [] as Array<{id:string;name:string;reason:string}> };

  for (const product of products) {
    const canonical = buildAffiliateUrl(product.original_url || '');
    const urlOk = product.affiliate_url === canonical && /\/produto\//i.test(product.affiliate_url || '');
    const copyOk = Boolean(product.facebook_copy?.trim()) && contentService.isPublicationCopySafe(product, product.facebook_copy!);

    if (urlOk && copyOk) {
      report.validBefore++;
      report.validAfter++;
      continue;
    }

    const reasons: string[] = [];
    if (!urlOk) reasons.push('affiliate_url_non_canonical');
    if (!copyOk) reasons.push(product.facebook_copy?.trim() ? contentService.getPublicationValidationReason(product.facebook_copy!, product) : 'facebook_copy_missing');

    // URL is repaired deterministically; copy is regenerated only when the
    // pre-prepared catalog copy is missing/invalid. No publication is created.
    if (!urlOk) {
      throw new Error(`CATALOG_URL_INVALID id=${product.id} reason=${reasons.join(',')}`);
    }

    const generated = await contentService.generateCopyForProduct(product);
    await storage.updateProductCopy(product.id, generated.content);
    report.regenerated++;

    const repaired = await storage.getProductById(product.id);
    if (!repaired || !repaired.facebook_copy || !contentService.isPublicationCopySafe(repaired, repaired.facebook_copy)) {
      report.invalid.push({
        id: product.id,
        name: product.product_name,
        reason: repaired?.facebook_copy ? contentService.getPublicationValidationReason(repaired.facebook_copy, product) : 'facebook_copy_missing_after_regeneration'
      });
    } else {
      report.validAfter++;
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.total !== 268 || report.validAfter !== report.total || report.invalid.length) {
    throw new Error(`CATALOG_VALIDATION_FAILED total=${report.total} validAfter=${report.validAfter} invalid=${report.invalid.length}`);
  }
}

main().catch(error => {
  console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
