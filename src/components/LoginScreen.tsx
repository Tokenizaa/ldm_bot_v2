import React, { useState } from 'react';
import { Lock, Mail, Wrench, AlertCircle, ArrowRight, ShieldCheck, Moon, Sun } from 'lucide-react';
import { setAuthToken } from '../services/apiClient';
import { SystemUser, ThemeMode } from '../types';

interface LoginScreenProps {
  onLoginSuccess: (user: SystemUser) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, theme, onThemeChange }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Credenciais inválidas.');
      }

      setAuthToken(data.token);
      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message || 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Theme toggle in top corner */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          id="login-theme-toggle"
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
          title={`Alternar para modo ${theme === 'dark' ? 'claro' : 'escuro'}`}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
        </button>
      </div>

      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 mb-4 shadow-sm">
            <Wrench className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">ForgeDeals</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Sistema de Automação de Ofertas — Loja do Mecânico
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-none">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Acessar Painel de Controle</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Informe as credenciais da sua conta administrativa do ForgeDeals.
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-3 text-red-700 dark:text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                E-mail do Administrador
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="login-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@forgedeals.com"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 dark:text-white transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Senha do Sistema
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="login-password-input"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 dark:text-white transition-colors"
                />
              </div>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold rounded-xl text-sm flex items-center justify-center gap-2 transition-all shadow-sm"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Validando credenciais...</span>
                </>
              ) : (
                <>
                  <span>Entrar no Painel</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Separation notice regarding Facebook vs ForgeDeals accounts */}
          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-start gap-2.5 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-500 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-700 dark:text-slate-300">Segurança de Contas:</span> Este acesso é exclusivo do painel ForgeDeals. A conexão do perfil do Facebook é gerenciada separadamente na aba <strong>Facebook</strong> com autenticação e 2FA persistentes.
            </div>
          </div>
        </div>

        {/* Quick helper for default admin credentials */}
        <div className="mt-4 p-3 bg-slate-100/70 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60 rounded-xl text-center text-xs text-slate-500 dark:text-slate-400">
          Credencial padrão do sistema: <code className="font-mono text-slate-800 dark:text-slate-200 bg-slate-200/60 dark:bg-slate-800 px-1 py-0.5 rounded">admin@forgedeals.com</code> / <code className="font-mono text-slate-800 dark:text-slate-200 bg-slate-200/60 dark:bg-slate-800 px-1 py-0.5 rounded">admin123456</code>
        </div>
      </div>
    </div>
  );
};
