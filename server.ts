import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import 'dotenv/config';
import { logger } from './server/services/LoggerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const { apiRouter } = await import('./server/routes/api.js');
  const { authRouter } = await import('./server/routes/auth.js');
  const { frontendCompatRouter } = await import('./server/routes/frontend-compat.js');
  const { facebookSession } = await import('./server/services/FacebookSessionService.js');
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
    // Exactly one persistent Facebook browser is opened here. It is the same
    // context later used by the publisher; no publisher creates another browser.
    void facebookSession.start();
  });
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
