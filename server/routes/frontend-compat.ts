import { Router, Request, Response } from 'express';
import { scheduler } from '../services/SchedulerService.js';
import { storage } from '../services/StorageService.js';
import { requireAuth } from './api.js';

export const frontendCompatRouter = Router();
frontendCompatRouter.use(requireAuth);

// Existing frontend calls these legacy names; keep the contract explicit while
// the backend remains the source of truth for scheduling.
frontendCompatRouter.post('/scheduler/generate-batch', async (req: Request, res: Response) => {
  try {
    const result = await scheduler.scheduleDailyBatch(req.body?.targetDate);
    res.json({
      success: true,
      generated: result.scheduled.length,
      scheduled: result.scheduled,
      quota: result.quota,
      message: result.message
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

frontendCompatRouter.post('/scheduler/process-due', async (_req: Request, res: Response) => {
  try {
    const processed = await scheduler.checkAndProcessDuePublications();
    res.json({ success: true, published: processed, failed: 0, processed });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

frontendCompatRouter.post('/settings', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, settings: await storage.updateSettings(req.body) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

frontendCompatRouter.get('/supabase-sql', (_req: Request, res: Response) => {
  // Kept as a compatibility endpoint for the existing Settings UI.
  res.json({ success: true, sql: '' });
});
