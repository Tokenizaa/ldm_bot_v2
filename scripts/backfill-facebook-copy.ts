import 'dotenv/config';
import { storage } from '../server/services/StorageService.js';
import { contentService } from '../server/services/ContentService.js';

async function main() {
  const products = await storage.getProducts(true);
  const pending = products.filter(product => !product.facebook_copy?.trim());
  console.log(`[Backfill] Produtos cadastrados: ${products.length}; sem copy: ${pending.length}.`);
  let generated = 0;
  for (const product of pending) {
    try {
      const result = await contentService.generateCopyForProduct(product);
      await storage.updateProductCopy(product.id, result.content);
      generated++;
      console.log(`[Backfill] ${generated}/${pending.length} — ${product.product_name}`);
    } catch (error) {
      console.error(`[Backfill] Falha em ${product.id} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const remaining = await storage.countProductsWithoutFacebookCopy();
  console.log(JSON.stringify({ success: remaining === 0, total: products.length, generated, remaining }, null, 2));
  if (remaining > 0) process.exit(1);
}

main().catch(error => {
  console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
