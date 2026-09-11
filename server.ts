import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import 'dotenv/config';
import { logger } from './server/services/LoggerService.js';

async function startServer() {
  const { apiRouter } = await import('./server/routes/api.js');
  const { authRouter } = await import('./server/routes/auth.js');
  const { frontendCompatRouter } = await import('./server/routes/frontend-compat.js');
  const { facebookSession } = await import('./server/services/FacebookSessionService.js');
  const { facebookAutomation } = await import('./server/services/FacebookAutomationService.js');
  const { scheduler } = await import('./server/services/SchedulerService.js');
  const { storage } = await import('./server/services/StorageService.js');

  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use('/api', authRouter);
  app.use('/api', apiRouter);
  app.use('/api', frontendCompatRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'ForgeDeals' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.system(`ForgeDeals Server running on http://0.0.0.0:${PORT}`);
    void (async () => {
      try {
        const status = await facebookSession.start();
        logger.system(`Facebook startup status=${status.status}`);
        if (!status.connected) {
          logger.scheduler('STARTUP_MONTHLY_SCHEDULE skipped: Facebook session not authenticated.', 'warn');
          return;
        }

        const settings = await storage.getSettings();
        const groupCheck = await facebookAutomation.verifyGroup(settings.facebook_group_url);
        if (!groupCheck.accessible) {
          logger.scheduler(`STARTUP_MONTHLY_SCHEDULE skipped: grupo Facebook não validado: ${groupCheck.message}`, 'error');
          return;
        }

        // One persistent browser/context/page is reused for the complete flow.
        // The preflight intentionally leaves the browser on the real group page.
        const result = await scheduler.ensureMonthlySchedule();
        logger.scheduler(`STARTUP_MONTHLY_SCHEDULE confirmed=${result.scheduled.length} message=${result.message}`, 'success');
      } catch (error: any) {
        logger.scheduler('STARTUP_MONTHLY_SCHEDULE failed: ' + error.message, 'error');
      }
    })();
  });
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});