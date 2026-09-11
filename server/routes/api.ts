import { Router, Request, Response, NextFunction } from 'express';
import { storage } from '../services/StorageService.js';
import { crawler } from '../services/CrawlerService.js';
import { contentService } from '../services/ContentService.js';
import { scheduler } from '../services/SchedulerService.js';
import { facebookSession } from '../services/FacebookSessionService.js';
import { facebookAutomation } from '../services/FacebookAutomationService.js';
import { nvidiaAI } from '../services/NvidiaAIService.js';
import { logger } from '../services/LoggerService.js';
import { authService } from '../services/AuthService.js';
import { SUPABASE_SQL_SCHEMA } from '../utils/supabaseSchema.js';

export const apiRouter = Router();
let crawlerRunPromise: Promise<Awaited<ReturnType<typeof crawler.run>>> | null = null;
let crawlerStartedAt: string | null = null;

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim();
  const session = authService.verifyToken(token);
  if (!session) return res.status(401).json({ success: false, error: 'Sessão expirada ou não autenticada.' });
  (req as any).user = session; next();
}
apiRouter.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
apiRouter.post('/auth/login', async (req, res) => { try { const result = await authService.login(req.body.email, req.body.password, storage.getSupabaseClient()); return result.success ? res.json(result) : res.status(401).json(result); } catch (err: any) { return res.status(500).json({ success: false, error: err.message }); } });
apiRouter.get('/auth/me', (req, res) => { const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string); const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim(); const session = authService.verifyToken(token); if (!session) return res.status(401).json({ success: false, authenticated: false }); return res.json({ success: true, authenticated: true, user: { id: session.id, email: session.email, name: session.name, role: session.role } }); });
apiRouter.post('/auth/logout', (req, res) => { const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string); const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim(); authService.logout(token); res.json({ success: true }); });
apiRouter.use(requireAuth);
apiRouter.get('/stats', async (_req, res) => { try { const [stats, quota] = await Promise.all([storage.getDashboardStats(), storage.getQuota()]); res.json({ success: true, stats, quota, envStatus: { nvidiaConfigured: nvidiaAI.isConfigured(), supabaseConnected: storage.isSupabaseActive(), facebookConnected: facebookSession.getStatus().connected } }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.get('/crawler/status', (_req, res) => res.json({ success: true, running: Boolean(crawlerRunPromise), startedAt: crawlerStartedAt }));
apiRouter.post('/crawler/run', async (_req, res) => { if (crawlerRunPromise) return res.status(409).json({ success: false, running: true, error: 'O crawler já está em execução. Aguarde a conclusão da coleta atual.' }); crawlerStartedAt = new Date().toISOString(); crawlerRunPromise = crawler.run(); try { return res.json({ success: true, ...(await crawlerRunPromise) }); } catch (err: any) { logger.crawler(`Execution failed: ${err.message}`, 'error'); return res.status(500).json({ success: false, error: err.message }); } finally { crawlerRunPromise = null; crawlerStartedAt = null; } });
apiRouter.get('/products', async (req, res) => { try { let products = await storage.getProducts(); const search = String(req.query.search || '').toLowerCase(); const category = req.query.category as string | undefined; if (search) products = products.filter(p => p.product_name.toLowerCase().includes(search) || p.brand?.toLowerCase().includes(search) || p.sku?.toLowerCase().includes(search)); if (category) products = products.filter(p => p.category === category); res.json({ success: true, products }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.get('/products/:id', async (req, res) => { try { const product = await storage.getProductById(req.params.id); if (!product) return res.status(404).json({ success: false, error: 'Produto não encontrado.' }); res.json({ success: true, product, priceHistory: await storage.getPriceHistoryForProduct(product.id) }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.get('/publications', async (req, res) => { try { res.json({ success: true, publications: await storage.getPublications(req.query.status as any) }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.post('/publications/generate-copy', async (req, res) => { try { const product = await storage.getProductById(req.body.productId); if (!product) return res.status(404).json({ success: false, error: 'Produto não encontrado.' }); const generated = await contentService.generateCopyForProduct(product); res.json({ success: true, ...generated }); } catch (err: any) { res.status(502).json({ success: false, error: err.message }); } });
apiRouter.post('/publications', async (req, res) => { try { const { product_id, scheduled_at, content, facebook_group_url } = req.body; if (!product_id || !scheduled_at || !content) return res.status(400).json({ success: false, error: 'product_id, scheduled_at e content são obrigatórios.' }); const product = await storage.getProductById(product_id); if (!product || !product.affiliate_url.endsWith('/20889')) return res.status(400).json({ success: false, error: 'Publicação inválida: produto ou link afiliado real não corresponde.' }); if (!content.trim() || /https?:\/\//i.test(content) || /R\$/i.test(content)) return res.status(400).json({ success: false, error: 'Publicação inválida: a copy deve ser evergreen e não pode conter URL ou preço.' }); const publication = await storage.createPublication({ product_id, scheduled_at, status: 'scheduled', content, facebook_group_url }); res.json({ success: true, publication }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.post('/publications/:id/program', async (req, res) => { try { res.json({ success: true, publication: await scheduler.schedulePublication(req.params.id) }); } catch (err: any) { res.status(400).json({ success: false, error: err.message }); } });
apiRouter.post('/publications/:id/publish-now', async (req, res) => { try { res.json({ success: true, publication: await scheduler.schedulePublication(req.params.id) }); } catch (err: any) { res.status(400).json({ success: false, error: err.message }); } });
apiRouter.post('/publications/:id/retry', async (req, res) => {
  const id = req.params.id;
  logger.scheduler(`RETRY_REQUEST id=${id}`);
  try {
    const prepared = await storage.resetPublicationForRetry(id);
    if (!prepared) return res.status(404).json({ success: false, error: 'Publicação não encontrada.' });
    logger.scheduler(`RETRY_PREPARED id=${id} product=${prepared.product_id} scheduled_at=${prepared.scheduled_at}`);
    const publication = await scheduler.schedulePublication(id);
    logger.scheduler(`RETRY_RESULT id=${id} status=${publication?.status || 'unknown'} error=${publication?.error_message || 'none'}`);
    return res.json({ success: true, publication });
  } catch (err: any) {
    logger.scheduler(`RETRY_FAILED id=${id} error=${err.message}`, 'error');
    return res.status(400).json({ success: false, error: err.message });
  }
});
apiRouter.delete('/publications/failed', async (_req, res) => {
  try {
    const deleted = await storage.deleteFailedPublications();
    logger.scheduler(`CLEANUP_FAILED deleted=${deleted}`);
    res.json({ success: true, deleted });
  } catch (err: any) {
    logger.scheduler(`CLEANUP_FAILED_ERROR error=${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});
apiRouter.post('/publications/:id/reschedule', async (_req, res) => res.status(400).json({ success: false, error: 'FACEBOOK_NATIVE_RESCHEDULE_UNSUPPORTED' }));
apiRouter.post('/publications/:id/cancel', async (_req, res) => res.status(400).json({ success: false, error: 'FACEBOOK_NATIVE_CANCEL_UNSUPPORTED' }));
apiRouter.delete('/publications/:id', async (req, res) => { try { res.json({ success: await storage.deletePublication(req.params.id) }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.post('/scheduler/batch-today', async (req, res) => { try { res.json({ success: true, ...(await scheduler.scheduleDailyBatch(req.body.targetDate)) }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.post('/scheduler/run-due', async (_req, res) => { try { res.json({ success: true, processed: await scheduler.checkAndProcessDuePublications() }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.get('/facebook/status', async (_req, res) => { try { res.json({ success: true, ...(await facebookSession.refresh()) }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.post('/facebook/connect', async (_req, res) => { try { res.json(await facebookSession.connect()); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.post('/facebook/verify-session', async (_req, res) => { try { const status = await facebookSession.refresh(); res.json({ success: status.connected, status }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.post('/facebook/verify-group', async (req, res) => { try { const settings = await storage.getSettings(); res.json(await facebookAutomation.verifyGroup(req.body.groupUrl || settings.facebook_group_url)); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.post('/facebook/test-publish', async (req, res) => { try { const settings = await storage.getSettings(); res.json(await facebookAutomation.publishTest(req.body.groupUrl || settings.facebook_group_url)); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.get('/settings', async (_req, res) => { try { res.json({ success: true, settings: await storage.getSettings(), envStatus: { hasNvidiaKey: nvidiaAI.isConfigured(), hasSupabaseUrl: Boolean(process.env.SUPABASE_URL), hasSupabaseKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), hasSessionSecret: Boolean(process.env.SESSION_SECRET) } }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.put('/settings', async (req, res) => { try { res.json({ success: true, settings: await storage.updateSettings(req.body) }); } catch (err: any) { res.status(500).json({ success: false, error: err.message }); } });
apiRouter.get('/supabase/schema', (_req, res) => res.json({ success: true, schema: SUPABASE_SQL_SCHEMA }));
apiRouter.get('/logs', (req, res) => res.json({ success: true, logs: logger.getLogs(parseInt(String(req.query.limit || '100'), 10)) }));
