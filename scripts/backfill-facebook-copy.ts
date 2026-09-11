import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Product } from '../server/types.js';
import { storage } from '../server/services/StorageService.js';
import { contentService } from '../server/services/ContentService.js';

const CONCURRENCY = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY || 5));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.BACKFILL_RETRIES || 3));
const RETRY_BASE_MS = Math.max(250, Number(process.env.BACKFILL_RETRY_DELAY_MS || 1500));
const REPORT_PATH = path.resolve(process.env.BACKFILL_REPORT_PATH || 'data/backfill-facebook-copy-report.json');

type ReportStatus = 'generated' | 'failed';

interface ProductReport {
  product_id: string;
  product_name: string;
  attempts: number;
  status: ReportStatus;
  error?: string;
  completed_at: string;
}

interface BackfillReport {
  started_at: string;
  finished_at?: string;
  total_products: number;
  pending_at_start: number;
  generated: number;
  failed: number;
  remaining: number;
  concurrency: number;
  max_attempts: number;
  products: ProductReport[];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function writeReport(report: BackfillReport) {
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function generateWithRetry(
  product: Product,
  report: BackfillReport,
  workerId: number,
): Promise<void> {
  let lastError = 'Erro desconhecido';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[Backfill][W${workerId}] Tentativa ${attempt}/${MAX_ATTEMPTS} — ${product.product_name}`);
      const result = await contentService.generateCopyForProduct(product);

      if (!result.content?.trim()) {
        throw new Error('Agente retornou copy vazia.');
      }

      await storage.updateProductCopy(product.id, result.content);

      report.generated++;
      report.products.push({
        product_id: product.id,
        product_name: product.product_name,
        attempts: attempt,
        status: 'generated',
        completed_at: new Date().toISOString(),
      });
      await writeReport(report);

      console.log(`[Backfill][W${workerId}] OK — ${product.product_name}`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(
        `[Backfill][W${workerId}] Falha na tentativa ${attempt}/${MAX_ATTEMPTS} — ${product.product_name} — ${lastError}`,
      );

      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
        console.log(`[Backfill][W${workerId}] Retry em ${delay}ms — ${product.product_name}`);
        await sleep(delay);
      }
    }
  }

  report.failed++;
  report.products.push({
    product_id: product.id,
    product_name: product.product_name,
    attempts: MAX_ATTEMPTS,
    status: 'failed',
    error: lastError,
    completed_at: new Date().toISOString(),
  });
  await writeReport(report);
}

async function main() {
  const startedAt = new Date().toISOString();
  const products = await storage.getProducts(true);
  const pending = products.filter(product => !product.facebook_copy?.trim());

  console.log(`[Backfill] Produtos cadastrados: ${products.length}; sem copy: ${pending.length}.`);
  console.log('[Backfill] Retomável: produtos com copy são ignorados; falhas ficam pendentes para a próxima execução.');

  const report: BackfillReport = {
    started_at: startedAt,
    total_products: products.length,
    pending_at_start: pending.length,
    generated: 0,
    failed: 0,
    remaining: pending.length,
    concurrency: Math.min(CONCURRENCY, pending.length || 1),
    max_attempts: MAX_ATTEMPTS,
    products: [],
  };

  await writeReport(report);

  if (pending.length === 0) {
    report.finished_at = new Date().toISOString();
    report.remaining = 0;
    await writeReport(report);
    console.log(JSON.stringify({ success: true, total: products.length, generated: 0, failed: 0, remaining: 0, report: REPORT_PATH }, null, 2));
    return;
  }

  let nextIndex = 0;
  const workerCount = Math.min(CONCURRENCY, pending.length);

  async function worker(workerId: number) {
    while (true) {
      const index = nextIndex++;
      const product = pending[index];
      if (!product) return;

      await generateWithRetry(product, report, workerId);
      report.remaining = pending.length - report.generated - report.failed;
      await writeReport(report);
    }
  }

  console.log(`[Backfill] Iniciando ${workerCount} workers concorrentes; até ${MAX_ATTEMPTS} tentativas por produto.`);
  await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));

  report.finished_at = new Date().toISOString();
  report.remaining = await storage.countProductsWithoutFacebookCopy();
  await writeReport(report);

  console.log(`[Backfill] Relatório salvo em ${REPORT_PATH}`);
  console.log(JSON.stringify({
    success: report.remaining === 0,
    total: report.total_products,
    pending: report.pending_at_start,
    generated: report.generated,
    failed: report.failed,
    remaining: report.remaining,
    concurrency: workerCount,
    retries: MAX_ATTEMPTS,
    report: REPORT_PATH,
  }, null, 2));

  if (report.remaining > 0) process.exit(1);
}

main().catch(error => {
  console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error), report: REPORT_PATH }, null, 2));
  process.exit(1);
});
