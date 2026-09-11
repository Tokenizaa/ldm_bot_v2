import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import 'dotenv/config';
import { logger } from './server/services/LoggerService.js';

async function startServer() {
  const { apiRouter } = await import('./server/routes/api.js');
  const { authRouter } = await import('./server/routes/auth.js');
  const { frontendCompatRouter } = await import('./server/routes/frontend-compat.js');
  const { scheduler } = await import('./server/services/SchedulerService.js');

  const app = express();
  const PORT = 3000;

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
    // The HTTP server only starts the application scheduler.
    // Facebook browser/session/navigation details stay inside the service layer.
    void scheduler.start();
  });
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
