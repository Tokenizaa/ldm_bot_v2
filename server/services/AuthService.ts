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
  private activeSessions: Map<string, UserSession> = new Map();
  // Hash for local admin fallback: default password is admin123456 or env var
  private adminEmail = process.env.FORGEDEALS_ADMIN_EMAIL || 'admin@forgedeals.com';
  private adminPassword = process.env.FORGEDEALS_ADMIN_PASSWORD || 'admin123456';
  private tokenSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

  constructor() {
    logger.auth(`AuthService initialized. System admin: ${this.adminEmail}`);
  }

  /**
   * Generates a tamper-proof session token
   */
  private generateToken(session: UserSession): string {
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  /**
   * Verifies and decodes a session token
   */
  verifyToken(token?: string): UserSession | null {
    if (!token || !token.includes('.')) return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expectedSignature = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('base64url');
    if (signature !== expectedSignature) {
      return null;
    }

    try {
      const sessionJson = Buffer.from(payload, 'base64url').toString('utf-8');
      const session: UserSession = JSON.parse(sessionJson);

      if (Date.now() > session.expiresAt) {
        this.activeSessions.delete(session.id);
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  /**
   * Authenticates user against Supabase Auth (if configured) or system local admin
   */
  async login(email: string, password: string, supabase?: SupabaseClient | null): Promise<{
    success: boolean;
    token?: string;
    user?: { id: string; email: string; name: string; role: string };
    error?: string;
  }> {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = (password || '').trim();

    if (!cleanEmail || !cleanPassword) {
      return { success: false, error: 'E-mail e senha são obrigatórios' };
    }

    // 1. Try Supabase Auth if client is present
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword
        });

        if (!error && data?.user) {
          const session: UserSession = {
            id: data.user.id,
            email: data.user.email || cleanEmail,
            name: data.user.user_metadata?.name || cleanEmail.split('@')[0],
            role: 'admin',
            createdAt: new Date().toISOString(),
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
          };

          const token = this.generateToken(session);
          this.activeSessions.set(session.id, session);
          logger.auth(`Supabase user "${cleanEmail}" logged in successfully`);

          return {
            success: true,
            token,
            user: { id: session.id, email: session.email, name: session.name, role: session.role }
          };
        }
      } catch (err: any) {
        logger.auth(`Supabase Auth attempt failed: ${err.message}`, 'warn');
      }
    }

    // 2. Local system administrator check
    if (cleanEmail === this.adminEmail.toLowerCase() && cleanPassword === this.adminPassword) {
      const session: UserSession = {
        id: 'admin_sys_root',
        email: this.adminEmail,
        name: 'Administrador ForgeDeals',
        role: 'admin',
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
      };

      const token = this.generateToken(session);
      this.activeSessions.set(session.id, session);
      logger.auth(`System administrator "${this.adminEmail}" authenticated`);

      return {
        success: true,
        token,
        user: { id: session.id, email: session.email, name: session.name, role: session.role }
      };
    }

    logger.auth(`Failed login attempt for email: ${cleanEmail}`, 'warn');
    return { success: false, error: 'Credenciais inválidas. Verifique seu e-mail e senha.' };
  }

  logout(token?: string): boolean {
    if (!token) return true;
    const session = this.verifyToken(token);
    if (session) {
      this.activeSessions.delete(session.id);
      logger.auth(`User "${session.email}" logged out`);
    }
    return true;
  }
}

export const authService = new AuthService();
