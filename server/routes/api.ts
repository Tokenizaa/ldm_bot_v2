import { Router, Request, Response } from 'express';
import { storage } from '../services/StorageService.js';
import { crawler } from '../services/CrawlerService.js';
import { contentService } from '../services/ContentService.js';
import { scheduler } from '../services/SchedulerService.js';
import { facebookService } from '../services/FacebookService.js';
import { nvidiaAI } from '../services/NvidiaAIService.js';
import { logger } from '../services/LoggerService.js';
import { SUPABASE_SQL_SCHEMA } from '../utils/supabaseSchema.js';

export const apiRouter = Router();

// --- DASHBOARD & STATS ---
apiRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await storage.getDashboardStats();
    const quota = await storage.getQuota();
    res.json({
      success: true,
      stats,
      quota,
      envStatus: {
        nvidiaConfigured: nvidiaAI.isConfigured(),
        supabaseConnected: storage.isSupabaseActive(),
        facebookConnected: facebookService.getStatus().connected
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- CRAWLER ---
// Requirement 27: POST /api/crawler/run
apiRouter.post('/crawler/run', async (req: Request, res: Response) => {
  try {
    const result = await crawler.run();
    res.json(result);
  } catch (err: any) {
    logger.crawler(`Execution failed: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- PRODUCTS ---
apiRouter.get('/products', async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string || '').toLowerCase();
    const category = req.query.category as string;
    let products = await storage.getProducts();

    if (search) {
      products = products.filter(p =>
        p.product_name.toLowerCase().includes(search) ||
        (p.brand && p.brand.toLowerCase().includes(search)) ||
        (p.sku && p.sku.toLowerCase().includes(search))
      );
    }

    if (category) {
      products = products.filter(p => p.category === category);
    }

    res.json({ success: true, products, total: products.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/products/:id', async (req: Request, res: Response) => {
  try {
    const product = await storage.getProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado' });
    }
    const priceHistory = await storage.getPriceHistoryForProduct(product.id);
    res.json({ success: true, product, priceHistory });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/products/:id/generate-copy', async (req: Request, res: Response) => {
  try {
    const product = await storage.getProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado' });
    }
    const settings = await storage.getSettings();
    const { content, affiliateUrl } = await contentService.generateCopyForProduct(product, settings.nvidia_model);
    res.json({ success: true, content, affiliateUrl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- PUBLICATIONS & SCHEDULER ---
apiRouter.get('/publications', async (req: Request, res: Response) => {
  try {
    const publications = await storage.getPublications();
    res.json({ success: true, publications });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/publications', async (req: Request, res: Response) => {
  try {
    const { product_id, scheduled_at, content, facebook_group_url } = req.body;
    if (!product_id || !scheduled_at || !content) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios ausentes' });
    }

    // Validate affiliate link in content (Requirement 22)
    if (!content.includes('/20889')) {
      return res.status(400).json({ success: false, error: 'O conteúdo deve conter o link de afiliado terminando em /20889' });
    }

    const pub = await storage.createPublication({
      product_id,
      scheduled_at,
      status: 'scheduled',
      content,
      facebook_group_url
    });

    res.json({ success: true, publication: pub });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/publications/:id/publish-now', async (req: Request, res: Response) => {
  try {
    const updated = await scheduler.publishNow(req.params.id);
    res.json({ success: true, publication: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/publications/:id/retry', async (req: Request, res: Response) => {
  try {
    const updated = await scheduler.publishNow(req.params.id);
    res.json({ success: true, publication: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/publications/:id/reschedule', async (req: Request, res: Response) => {
  try {
    const { scheduled_at } = req.body;
    if (!scheduled_at) {
      return res.status(400).json({ success: false, error: 'scheduled_at é obrigatório' });
    }
    const updated = await scheduler.reschedule(req.params.id, scheduled_at);
    res.json({ success: true, publication: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/publications/:id/cancel', async (req: Request, res: Response) => {
  try {
    const updated = await scheduler.cancel(req.params.id);
    res.json({ success: true, publication: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.delete('/publications/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await storage.deletePublication(req.params.id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger daily 5-post batch generation (Requirement 20, 28)
apiRouter.post('/scheduler/batch-today', async (req: Request, res: Response) => {
  try {
    const { targetDate } = req.body;
    const result = await scheduler.scheduleDailyBatch(targetDate);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run due publications immediately
apiRouter.post('/scheduler/run-due', async (req: Request, res: Response) => {
  try {
    const processed = await scheduler.checkAndProcessDuePublications();
    res.json({ success: true, processed });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- FACEBOOK PERSISTENT BROWSER ---
apiRouter.get('/facebook/status', (req: Request, res: Response) => {
  res.json({ success: true, ...facebookService.getStatus() });
});

apiRouter.post('/facebook/connect', async (req: Request, res: Response) => {
  try {
    const { storageState } = req.body;
    const result = await facebookService.setupFacebookSession(storageState);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/facebook/test-publish', async (req: Request, res: Response) => {
  try {
    const settings = await storage.getSettings();
    const testPub = {
      id: `test_${Date.now()}`,
      product_id: 'test_product',
      product: {
        id: 'test_product',
        product_identity_key: 'test',
        product_name: 'Produto de Teste ForgeDeals',
        original_url: 'https://www.lojadomecanico.com.br/produto/teste',
        affiliate_url: 'https://www.lojadomecanico.com.br/produto/teste/20889',
        current_price: 99.90,
        active: true,
        last_scraped_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      scheduled_at: new Date().toISOString(),
      status: 'publishing' as const,
      content: `🔥 TESTE DE PUBLICAÇÃO FORGEDEALS\n\nFerramenta de alta precisão com preço imperdível!\nConfira: https://www.lojadomecanico.com.br/produto/teste/20889`,
      facebook_group_url: settings.facebook_group_url,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const result = await facebookService.publishSingle(testPub);
    res.json({ success: result.success, postUrl: result.postUrl, error: result.error });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- SETTINGS ---
apiRouter.get('/settings', async (req: Request, res: Response) => {
  try {
    const settings = await storage.getSettings();
    res.json({
      success: true,
      settings,
      envStatus: {
        hasNvidiaKey: Boolean(process.env.NVIDIA_API_KEY),
        hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
        hasSupabaseKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.put('/settings', async (req: Request, res: Response) => {
  try {
    const updated = await storage.updateSettings(req.body);
    logger.system('Operational settings updated');
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- SUPABASE DDL ---
apiRouter.get('/supabase/schema', (req: Request, res: Response) => {
  res.json({ success: true, schema: SUPABASE_SQL_SCHEMA });
});

// --- LOGS ---
apiRouter.get('/logs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  res.json({ success: true, logs: logger.getLogs(limit) });
});
