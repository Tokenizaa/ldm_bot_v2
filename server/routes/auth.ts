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
      const status = result.error?.includes('administrador inicial já existe') ? 409 : 400;
      return res.status(status).json(result);
    }

    return res.status(201).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Falha no cadastro.' });
  }
});

authRouter.post('/auth/setup-admin', async (req, res) => {
  try {
    // A configuração inicial é uma operação local de bootstrap. Não usamos
    // segredo em .env: o estado de bootstrap fica persistido no Supabase.
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const remoteAddress = String(req.socket.remoteAddress || '');
    const isLocal = !forwarded && (remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1');
    if (process.env.NODE_ENV === 'production' && !isLocal) {
      return res.status(403).json({ success: false, error: 'A configuração inicial do administrador só pode ser executada localmente.' });
    }

    const result = await authService.setupAdmin(
      req.body?.name,
      req.body?.email,
      req.body?.password,
      storage.getSupabaseClient()
    );

    if (!result.success) {
      const status = result.error?.includes('já foi concluída') ? 409 : 400;
      return res.status(status).json(result);
    }

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Falha na configuração do administrador.' });
  }
});
