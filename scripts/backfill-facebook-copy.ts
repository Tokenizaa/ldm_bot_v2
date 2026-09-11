import 'dotenv/config';
import { storage } from '../server/services/StorageService.js';
import { contentService } from '../server/services/ContentService.js';

const CONCURRENCY = 5;

async function main() {
  const products = await storage.getProducts(true);
  const pending = products.filter(product => !product.facebook_copy?.trim());
  console.log(`[Backfill] Produtos cadastrados: ${products.length}; sem copy: ${pending.length}.`);

  if (pending.length === 0) {
    console.log(JSON.stringify({ success: true, total: products.length, generated: 0, failed: 0, remaining: 0 }, null, 2));
    return;
  }

  let nextIndex = 0;
  let generated = 0;
  let failed = 0;

  async function worker(workerId: number) {
    while (true) {
      const index = nextIndex++;
      const product = pending[index];
      if (!product) return;

      try {
        console.log(`[Backfill][W${workerId}] Gerando ${index + 1}/${pending.length} — ${product.product_name}`);
        const result = await contentService.generateCopyForProduct(product);
        await storage.updateProductCopy(product.id, result.content);
        generated++;
        console.log(`[Backfill][W${workerId}] OK ${generated}/${pending.length} — ${product.product_name}`);
      } catch (error) {
        failed++;
        console.error(`[Backfill][W${workerId}] Falha ${index + 1}/${pending.length} — ${product.product_name} — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, pending.length);
  console.log(`[Backfill] Iniciando ${workerCount} workers concorrentes.`);
  await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));

  const remaining = await storage.countProductsWithoutFacebookCopy();
  console.log(JSON.stringify({
    success: remaining === 0,
    total: products.length,
    pending: pending.length,
    generated,
    failed,
    remaining,
    concurrency: workerCount,
  }, null, 2));

  if (remaining > 0) process.exit(1);
}

main().catch(error => {
  console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
