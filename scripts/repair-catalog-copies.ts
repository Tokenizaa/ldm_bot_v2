import 'dotenv/config';
import { storage } from '../server/services/StorageService.js';
import { contentService } from '../server/services/ContentService.js';
import { buildAffiliateUrl } from '../server/utils/affiliate.js';

async function main() {
  const products = await storage.getProducts(true);
  const report = {
    total: products.length,
    validBefore: 0,
    repaired: 0,
    validAfter: 0,
    errors: [] as Array<{ id: string; name: string; reason: string }>
  };

  for (const product of products) {
    try {
      const canonical = buildAffiliateUrl(product.original_url || '');
      const urlOk =
        product.affiliate_url === canonical &&
        /^https:\/\/www\.lojadomecanico\.com\.br\/produto\//i.test(product.affiliate_url || '');

      if (!urlOk) {
        throw new Error('affiliate_url_non_canonical');
      }

      const copyOk =
        Boolean(product.facebook_copy?.trim()) &&
        contentService.isPublicationCopySafe(product, product.facebook_copy!);

      if (copyOk) {
        report.validBefore++;
        report.validAfter++;
        continue;
      }

      // Catalog repair is deliberately deterministic. A repair/validation run
      // must never call the AI, retry a model, or turn an AI timeout into a
      // successful result. The crawler is responsible for AI generation.
      const repairedCopy = contentService.repairCatalogCopy(product);
      await storage.updateProductCopy(product.id, repairedCopy);
      report.repaired++;

      const saved = await storage.getProductById(product.id);
      if (
        !saved?.facebook_copy ||
        !contentService.isPublicationCopySafe(saved, saved.facebook_copy)
      ) {
        throw new Error(
          saved?.facebook_copy
            ? contentService.getPublicationValidationReason(saved.facebook_copy, product)
            : 'facebook_copy_missing_after_repair'
        );
      }

      report.validAfter++;
    } catch (error) {
      report.errors.push({
        id: product.id,
        name: product.product_name,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));

  if (
    report.total !== 268 ||
    report.validAfter !== report.total ||
    report.errors.length > 0
  ) {
    throw new Error(
      `CATALOG_VALIDATION_FAILED total=${report.total} validAfter=${report.validAfter} errors=${report.errors.length}`
    );
  }

  console.log(
    `CATALOG_READY total=${report.total} repaired=${report.repaired} publications=0 ai_calls=0`
  );
}

main().catch(error => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});
