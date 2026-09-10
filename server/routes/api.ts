import { Router, Request, Response, NextFunction } from 'express';
import { storage } from '../services/StorageService.js';
import { crawler } from '../services/CrawlerService.js';
import { contentService } from '../services/ContentService.js';
import { scheduler } from '../services/SchedulerService.js';
import { facebookService } from '../services/FacebookService.js';
import { nvidiaAI } from '../services/NvidiaAIService.js';
import { logger } from '../services/LoggerService.js';
import { authService } from '../services/AuthService.js';
import { SUPABASE_SQL_SCHEMA } from '../utils/supabaseSchema.js';

export const apiRouter = Router();

// --- AUTHENTICATION MIDDLEWARE ---
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
  let token = '';

  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  }

  const session = authService.verifyToken(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Sessão expirada ou não autenticada. Faça login para acessar.'
    });
  }

  (req as any).user = session;
  next();
}

// --- PUBLIC ROUTES (HEALTH & AUTH) ---
apiRouter.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password, storage.getSupabaseClient());
    if (!result.success) {
      return res.status(401).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/auth/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
  let token = '';
  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  }

  const session = authService.verifyToken(token);
  if (!session) {
    return res.status(401).json({ success: false, authenticated: false });
  }

  res.json({
    success: true,
    authenticated: true,
    user: { id: session.id, email: session.email, name: session.name, role: session.role }
  });
});

apiRouter.post('/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
  let token = '';
  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  }
  authService.logout(token);
  res.json({ success: true, message: 'Logout realizado com sucesso' });
});

// --- PROTECTED ROUTES BELOW ---
apiRouter.use(requireAuth);

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

    res.json({ success: true, products });
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

// --- PUBLICATIONS & SCHEDULER ---
apiRouter.get('/publications', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const publications = await storage.getPublications(status as any);
    res.json({ success: true, publications });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/publications/generate-copy', async (req: Request, res: Response) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ success: false, error: 'productId é obrigatório' });
    }
    const product = await storage.getProductById(productId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produto não encontrado' });
    }
    const generated = await contentService.generateCopyForProduct(product);
    res.json({ success: true, ...generated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/publications', async (req: Request, res: Response) => {
  try {
    const { product_id, scheduled_at, content, facebook_group_url } = req.body;
    if (!product_id || !scheduled_at || !content) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: product_id, scheduled_at, content' });
    }

    const publication = await storage.createPublication({
      product_id,
      scheduled_at,
      status: 'scheduled',
      content,
      facebook_group_url
    });

    res.json({ success: true, publication });
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

// Trigger daily 5-post batch generation (150/mês, 5/dia)
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
    const { sessionData } = req.body;
    const result = await facebookService.connectSession(sessionData);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/facebook/verify-session', async (req: Request, res: Response) => {
  try {
    const isValid = await facebookService.verifySessionWithBrowser();
    res.json({ success: isValid, status: facebookService.getStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/facebook/verify-group', async (req: Request, res: Response) => {
  try {
    const settings = await storage.getSettings();
    const groupUrl = req.body.groupUrl || settings.facebook_group_url;
    const result = await facebookService.verifyGroupAccess(groupUrl);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/facebook/test-publish', async (req: Request, res: Response) => {
  try {
    const settings = await storage.getSettings();
    const groupUrl = req.body.groupUrl || settings.facebook_group_url;
    const result = await facebookService.publishTest(groupUrl);
    res.json(result);
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
