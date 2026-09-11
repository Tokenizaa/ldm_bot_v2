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
  private readonly tokenSecret = process.env.SESSION_SECRET?.trim() || 'forgedeals-session-dev-key-32chars-minimum-safe';

  constructor() {
    if (!process.env.SESSION_SECRET?.trim()) {
      logger.auth('SESSION_SECRET não configurado no ambiente. Usando chave de desenvolvimento transitória.', 'warn');
    } else {
      logger.auth('AuthService inicializado com SESSION_SECRET customizado.');
    }
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
        if (session.id) this.activeSessions.delete(session.id);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  private validateAdminCredentials(name: string, email: string, password: string) {
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');

    if (!cleanName || !cleanEmail || !cleanPassword) {
      return { success: false as const, error: 'Nome, e-mail e senha são obrigatórios.' };
    }
    if (cleanPassword.length < 8) {
      return { success: false as const, error: 'A senha deve ter pelo menos 8 caracteres.' };
    }

    return { success: true as const, cleanName, cleanEmail, cleanPassword };
  }

  async signupFirstAdmin(name: string, email: string, password: string, supabase?: SupabaseClient | null) {
    const validation = this.validateAdminCredentials(name, email, password);
    if (!validation.success) return validation;
    if (!supabase) return { success: false, error: 'Supabase Auth não está configurado.' };

    try {
      const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (usersError) throw usersError;
      if ((usersData.users || []).length > 0) {
        return { success: false, error: 'O administrador inicial já existe. Use "Configurar/redefinir administrador".' };
      }

      const { data, error } = await supabase.auth.admin.createUser({
        email: validation.cleanEmail,
        password: validation.cleanPassword,
        email_confirm: true,
        user_metadata: { name: validation.cleanName },
        app_metadata: { role: 'admin' }
      });
      if (error || !data.user) {
        return { success: false, error: error?.message || 'Não foi possível criar o administrador.' };
      }

      logger.auth(`Administrador inicial criado: ${validation.cleanEmail}`);
      return this.login(validation.cleanEmail, validation.cleanPassword, supabase);
    } catch (err: any) {
      logger.auth(`Erro no cadastro inicial: ${err.message}`, 'error');
      return { success: false, error: 'Não foi possível criar o administrador inicial.' };
    }
  }

  async setupAdmin(name: string, email: string, password: string, supabase?: SupabaseClient | null) {
    const validation = this.validateAdminCredentials(name, email, password);
    if (!validation.success) return validation;
    if (!supabase) return { success: false, error: 'Supabase Auth não está configurado.' };

    try {
      const { data: configRow, error: configError } = await supabase
        .from('system_config')
        .select('config')
        .eq('key', 'admin_setup')
        .maybeSingle();
      if (configError) throw configError;

      const setupConfig = (configRow?.config || {}) as { completed_at?: string | null };
      if (setupConfig.completed_at) {
        return { success: false, error: 'A configuração inicial do administrador já foi concluída.' };
      }

      const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 10 });
      if (usersError) throw usersError;

      const users = usersData.users || [];
      if (users.length > 1) {
        return { success: false, error: 'Configuração inicial bloqueada: já existem múltiplos usuários no Auth.' };
      }

      if (users.length === 0) {
        const { data, error } = await supabase.auth.admin.createUser({
          email: validation.cleanEmail,
          password: validation.cleanPassword,
          email_confirm: true,
          user_metadata: { name: validation.cleanName },
          app_metadata: { role: 'admin' }
        });
        if (error || !data.user) return { success: false, error: error?.message || 'Não foi possível criar o administrador.' };
      } else {
        const existingUser = users[0];
        const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, {
          email: validation.cleanEmail,
          password: validation.cleanPassword,
          email_confirm: true,
          user_metadata: { ...(existingUser.user_metadata || {}), name: validation.cleanName, role: 'admin' },
          app_metadata: { ...(existingUser.app_metadata || {}), role: 'admin' }
        });
        if (error || !data.user) return { success: false, error: error?.message || 'Não foi possível atualizar o administrador.' };
      }

      const { error: saveConfigError } = await supabase.from('system_config').upsert({
        key: 'admin_setup',
        config: { completed_at: new Date().toISOString(), admin_email: validation.cleanEmail },
        updated_at: new Date().toISOString()
      });
      if (saveConfigError) throw saveConfigError;

      logger.auth(`Administrador configurado: ${validation.cleanEmail}`);
      return this.login(validation.cleanEmail, validation.cleanPassword, supabase);
    } catch (err: any) {
      logger.auth(`Erro na configuração do administrador: ${err.message}`, 'error');
      return { success: false, error: 'Não foi possível configurar o administrador.' };
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
        role: data.user.app_metadata?.role === 'operator' ? 'operator' : 'admin',
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
