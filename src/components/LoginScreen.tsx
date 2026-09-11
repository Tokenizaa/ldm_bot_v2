import React, { useState } from 'react';
import { Lock, Mail, User, Wrench, AlertCircle, ArrowRight, ShieldCheck, Moon, Sun, KeyRound } from 'lucide-react';
import { setAuthToken } from '../services/apiClient';
import { SystemUser, ThemeMode } from '../types';

interface LoginScreenProps {
  onLoginSuccess: (user: SystemUser) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

type AuthMode = 'login' | 'signup' | 'setup';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, theme, onThemeChange }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : mode === 'setup' ? '/api/auth/setup-admin' : '/api/auth/login';
      const body = mode === 'signup'
        ? { name, email, password }
        : mode === 'setup'
          ? { name, email, password, setupKey }
          : { email, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Não foi possível concluir a operação.');

      setAuthToken(data.token);
      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message || 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
  };

  const isSetup = mode === 'setup';
  const isSignup = mode === 'signup';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <div className="absolute top-4 right-4">
        <button
          id="login-theme-toggle"
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Alternar tema"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 mb-4">
            <Wrench className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">ForgeDeals</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Sistema de Automação de Ofertas — Loja do Mecânico</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          <div className="mb-6">
            <h2 className="text-lg font-semibold">
              {isSetup ? 'Configurar administrador' : isSignup ? 'Criar administrador' : 'Acessar Painel de Controle'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {isSetup
                ? 'Recupere o acesso do administrador inicial usando a chave de configuração do servidor.'
                : isSignup
                  ? 'Crie o primeiro perfil administrativo do ForgeDeals.'
                  : 'Informe as credenciais da sua conta administrativa.'}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-3 text-red-700 dark:text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {(isSignup || isSetup) && (
              <div>
                <label className="block text-xs font-medium mb-1.5">Nome</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input id="admin-name-input" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:text-white" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1.5">E-mail do Administrador</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input id="login-email-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="olfnetto@gmail.com" className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:text-white" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Senha do Sistema</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input id="login-password-input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:text-white" />
              </div>
              {(isSignup || isSetup) && <p className="text-[11px] text-slate-500 mt-1.5">Mínimo de 8 caracteres.</p>}
            </div>

            {isSetup && (
              <div>
                <label className="block text-xs font-medium mb-1.5">Chave de configuração</label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input id="admin-setup-key-input" type="password" required value={setupKey} onChange={(e) => setSetupKey(e.target.value)} placeholder="Chave definida no .env" className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:text-white" />
                </div>
              </div>
            )}

            <button id={isSetup ? 'setup-admin-submit-btn' : isSignup ? 'signup-submit-btn' : 'login-submit-btn'} type="submit" disabled={loading} className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-semibold rounded-xl text-sm flex items-center justify-center gap-2">
              {loading
                ? <><div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" /><span>{isSetup ? 'Configurando administrador...' : isSignup ? 'Criando administrador...' : 'Validando credenciais...'}</span></>
                : <><span>{isSetup ? 'Salvar novo administrador' : isSignup ? 'Criar perfil de administrador' : 'Entrar no Painel'}</span><ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <div className="mt-5 flex flex-col items-center gap-2">
            {mode === 'login' ? (
              <>
                <button id="show-signup-btn" type="button" onClick={() => switchMode('signup')} className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">Primeiro acesso? Criar administrador</button>
                <button id="show-setup-btn" type="button" onClick={() => switchMode('setup')} className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:underline">Configurar/redefinir administrador</button>
              </>
            ) : (
              <button id="show-login-btn" type="button" onClick={() => switchMode('login')} className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:underline">Voltar ao login</button>
            )}
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-start gap-2.5 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-500 mt-0.5" />
            <div><span className="font-semibold text-slate-700 dark:text-slate-300">Segurança:</span> a configuração administrativa exige a chave definida no servidor e só funciona enquanto houver no máximo um usuário no Supabase Auth.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
