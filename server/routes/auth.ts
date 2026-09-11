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
      const status = result.error?.includes('cadastro inicial') ? 409 : 400;
      return res.status(status).json(result);
    }

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Falha no cadastro.' });
  }
});

authRouter.post('/auth/setup-admin', async (req, res) => {
  try {
    const result = await authService.setupAdmin(
      req.body?.name,
      req.body?.email,
      req.body?.password,
      req.body?.setupKey,
      storage.getSupabaseClient()
    );

    if (!result.success) {
      const status = result.error === 'Chave de configuração inválida.' ? 403 : 400;
      return res.status(status).json(result);
    }

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Falha na configuração do administrador.' });
  }
});
