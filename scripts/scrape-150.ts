import 'dotenv/config';
import { crawler } from '../server/services/CrawlerService.js';
import { storage } from '../server/services/StorageService.js';

async function main() {
  const result = await crawler.run();
  const products = await storage.getProducts(true);
  const valid = products.filter(p =>
    p.product_name &&
    p.original_url &&
    p.current_price > 0 &&
    /^https:\/\/www\.lojadomecanico\.com\.br\/produto\//i.test(p.original_url) &&
    p.affiliate_url?.endsWith('/20889') &&
    Boolean(p.facebook_copy?.trim())
  );
  const distinctUrls = new Set(valid.map(p => p.original_url));

  if (distinctUrls.size < 150) {
    throw new Error(`Validação final falhou: ${distinctUrls.size}/150 produtos distintos válidos no Supabase.`);
  }

  console.log(JSON.stringify({
    success: true,
    scrape: result,
    supabase: {
      valid_products: valid.length,
      distinct_original_urls: distinctUrls.size,
      target: 150
    }
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
