import { Router } from 'express';
import { authService } from '../services/AuthService.js';
import { storage } from '../services/StorageService.js';

export const authRouter = Router();

authRouter.post('/auth/signup', async (req, res) => {
  try {
    const result = await authService.signupFirstAdmin(
      req.body?.name,
      req.body?.email,
      req.body?.password,
      storage.getSupabaseClient()
    );

    if (!result.success) {
      const status = result.error?.includes('já foi concluído') ? 409 : 400;
      return res.status(status).json(result);
    }

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Falha no cadastro.' });
  }
});
