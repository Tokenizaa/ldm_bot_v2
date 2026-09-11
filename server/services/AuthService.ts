import crypto from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './LoggerService.js';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator';
  createdAt: string;
  expiresAt: number;
}

export class AuthService {
  private activeSessions = new Map<string, UserSession>();
  private readonly tokenSecret = process.env.SESSION_SECRET?.trim();

  constructor() {
    if (!this.tokenSecret) {
      throw new Error('SESSION_SECRET é obrigatório. Configure-o no ambiente antes de iniciar o servidor.');
    }
    logger.auth('AuthService inicializado. Autenticação via Supabase Auth.');
  }

  private generateToken(session: UserSession): string {
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.tokenSecret!).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  verifyToken(token?: string): UserSession | null {
    if (!token || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = crypto.createHmac('sha256', this.tokenSecret!).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UserSession;
      if (!session.id || !session.email || Date.now() > session.expiresAt) {
        this.activeSessions.delete(session.id);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  async signupFirstAdmin(name: string, email: string, password: string, supabase?: SupabaseClient | null) {
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');

    if (!cleanName || !cleanEmail || !cleanPassword) return { success: false, error: 'Nome, e-mail e senha são obrigatórios.' };
    if (cleanPassword.length < 8) return { success: false, error: 'A senha deve ter pelo menos 8 caracteres.' };
    if (!supabase) return { success: false, error: 'Supabase Auth não está configurado.' };

    try {
      const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (usersError) throw usersError;
      if ((usersData.users || []).length > 0) {
        return { success: false, error: 'O cadastro inicial já foi concluído. Use o login.' };
      }

      const { data, error } = await supabase.auth.admin.createUser({
        email: cleanEmail,
        password: cleanPassword,
        email_confirm: true,
        user_metadata: { name: cleanName }
      });
      if (error || !data.user) {
        return { success: false, error: error?.message || 'Não foi possível criar o administrador.' };
      }

      logger.auth(`Administrador inicial criado: ${cleanEmail}`);
      return this.login(cleanEmail, cleanPassword, supabase);
    } catch (err: any) {
      logger.auth(`Erro no cadastro inicial: ${err.message}`, 'error');
      return { success: false, error: 'Não foi possível criar o administrador inicial.' };
    }
  }

  async login(email: string, password: string, supabase?: SupabaseClient | null): Promise<{
    success: boolean;
    token?: string;
    user?: { id: string; email: string; name: string; role: string };
    error?: string;
  }> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');
    if (!cleanEmail || !cleanPassword) return { success: false, error: 'E-mail e senha são obrigatórios.' };
    if (!supabase) return { success: false, error: 'Supabase Auth não está configurado.' };

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: cleanPassword });
      if (error || !data.user) {
        logger.auth(`Falha de login para ${cleanEmail}`, 'warn');
        return { success: false, error: 'Credenciais inválidas.' };
      }

      const session: UserSession = {
        id: data.user.id,
        email: data.user.email || cleanEmail,
        name: data.user.user_metadata?.name || cleanEmail.split('@')[0],
        role: 'admin',
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      };
      this.activeSessions.set(session.id, session);
      logger.auth(`Usuário ${session.email} autenticado via Supabase Auth`);
      return {
        success: true,
        token: this.generateToken(session),
        user: { id: session.id, email: session.email, name: session.name, role: session.role }
      };
    } catch (err: any) {
      logger.auth(`Erro no login: ${err.message}`, 'error');
      return { success: false, error: 'Não foi possível autenticar no momento.' };
    }
  }

  logout(token?: string): boolean {
    const session = this.verifyToken(token);
    if (session) this.activeSessions.delete(session.id);
    return true;
  }
}

export const authService = new AuthService();
