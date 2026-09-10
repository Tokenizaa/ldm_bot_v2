import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Lock,
  Globe,
  Send,
  Key,
  FolderLock,
  Info,
  RefreshCw,
  Check,
  XCircle
} from 'lucide-react';
import { FacebookSessionStatus, AppSettings } from '../types';
import { apiRequest } from '../services/apiClient';

interface FacebookTabProps {
  status: FacebookSessionStatus | null;
  settings: AppSettings | null;
  onConnect: (sessionData?: string) => Promise<void>;
  onTestPublish: () => Promise<void>;
  isConnecting: boolean;
  isTesting: boolean;
  onRefreshStatus?: () => void;
}

export const FacebookTab: React.FC<FacebookTabProps> = ({
  status,
  settings,
  onConnect,
  onTestPublish,
  isConnecting,
  isTesting,
  onRefreshStatus
}) => {
  const [sessionInput, setSessionInput] = useState('');
  const [showSessionInput, setShowSessionInput] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; postUrl?: string } | null>(null);
  const [verifyingGroup, setVerifyingGroup] = useState(false);
  const [groupAccessResult, setGroupAccessResult] = useState<{ accessible: boolean; message: string } | null>(null);
  const [verifyingSession, setVerifyingSession] = useState(false);

  const isConnected = status?.connected && status?.status === 'connected';
  const isRequiresReauth = status?.status === 'requires_reauth';

  const handleManualImport = async () => {
    if (!sessionInput.trim()) return;
    await onConnect(sessionInput);
    setSessionInput('');
    setShowSessionInput(false);
  };

  const handleVerifyGroup = async () => {
    setVerifyingGroup(true);
    setGroupAccessResult(null);
    try {
      const res = await apiRequest<{ accessible: boolean; message: string }>('/api/facebook/verify-group', {
        method: 'POST',
        body: JSON.stringify({ groupUrl: settings?.facebook_group_url })
      });
      setGroupAccessResult(res);
      if (onRefreshStatus) onRefreshStatus();
    } catch (err: any) {
      setGroupAccessResult({ accessible: false, message: err.message });
    } finally {
      setVerifyingGroup(false);
    }
  };

  const handleVerifySession = async () => {
    setVerifyingSession(true);
    try {
      await apiRequest('/api/facebook/verify-session', { method: 'POST' });
      if (onRefreshStatus) onRefreshStatus();
    } catch (err) {
      // handled
    } finally {
      setVerifyingSession(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Main Connection Status Card */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs transition-colors">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              isConnected
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : isRequiresReauth
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
            }`}>
              {isConnected ? <ShieldCheck className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Perfil do Facebook (Playwright)</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                  isConnected
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : isRequiresReauth
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? 'bg-emerald-500' : isRequiresReauth ? 'bg-amber-500' : 'bg-rose-500'
                  }`} />
                  {isConnected
                    ? '🟢 Conectado'
                    : isRequiresReauth
                    ? '🟡 Sessão Expirada (Requer 2FA)'
                    : '🔴 Desconectado'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Diretório persistente: <code className="font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">data/browser-profiles/facebook</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              id="fb-verify-session-btn"
              onClick={handleVerifySession}
              disabled={verifyingSession || !isConnected}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              title="Testa conexão ao vivo no Facebook via Playwright"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifyingSession ? 'animate-spin' : ''}`} />
              <span>Verificar Sessão</span>
            </button>

            <button
              id="fb-connect-btn"
              onClick={() => setShowSessionInput(true)}
              disabled={isConnecting}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5" />
              <span>{isConnecting ? 'Conectando...' : 'Conectar Facebook'}</span>
            </button>

            <button
              id="fb-test-publish-btn"
              onClick={async () => {
                setTestResult(null);
                try {
                  await onTestPublish();
                  setTestResult({
                    success: true,
                    message: 'Publicação de teste executada e confirmada no grupo com sucesso!'
                  });
                } catch (e: any) {
                  setTestResult({
                    success: false,
                    message: `Falha na publicação de teste: ${e.message}`
                  });
                }
              }}
              disabled={isTesting || !isConnected}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              <Send className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse text-amber-500' : ''}`} />
              <span>{isTesting ? 'Publicando teste...' : 'Publicar Teste'}</span>
            </button>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Conta Conectada</span>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1 truncate">
              {status?.connected_user || (isConnected ? 'Sessão Ativa' : 'Nenhuma conta ativa')}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {isConnected ? 'Cookies de autenticação salvos' : 'Requer login do Facebook'}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Última Autenticação</span>
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-1">
              {status?.last_authenticated_at ? new Date(status.last_authenticated_at).toLocaleString('pt-BR') : 'Sem registro prévio'}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Reutilizada nas 5 postagens diárias
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Grupo Alvo</span>
              <button
                id="fb-verify-group-btn"
                onClick={handleVerifyGroup}
                disabled={verifyingGroup || !isConnected}
                className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline disabled:opacity-40"
              >
                {verifyingGroup ? 'Verificando...' : 'Verificar Acesso'}
              </button>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <a
                href={settings?.facebook_group_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-amber-600 dark:text-amber-400 hover:underline truncate"
              >
                {settings?.facebook_group_url || 'https://www.facebook.com/groups/...'}
              </a>
            </div>
            {groupAccessResult && (
              <div className={`mt-2 text-[11px] flex items-center gap-1 ${
                groupAccessResult.accessible ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {groupAccessResult.accessible ? <Check className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                <span>{groupAccessResult.message}</span>
              </div>
            )}
          </div>
        </div>

        {/* Test Result Alert Banner */}
        {testResult && (
          <div className={`mt-5 p-4 rounded-xl border text-xs ${
            testResult.success
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-900'
          }`}>
            <div className="font-semibold flex items-center gap-2">
              {testResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-rose-500" />}
              <span>{testResult.message}</span>
            </div>
            {testResult.postUrl && (
              <div className="mt-2 pl-6">
                Link do post: <a href={testResult.postUrl} target="_blank" rel="noreferrer" className="underline font-mono">{testResult.postUrl}</a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manual Connection / Session Injection Modal/Drawer */}
      {showSessionInput && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-amber-500/40 dark:border-amber-500/30 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FolderLock className="w-5 h-5 text-amber-500" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Conectar Sessão do Facebook
              </h3>
            </div>
            <button
              onClick={() => setShowSessionInput(false)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              Fechar
            </button>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Para ambientes de container/servidor (Cloud Run, Docker), você pode conectar sua sessão colando seus cookies autenticados (<code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono text-amber-600">c_user=...; xs=...;</code>) ou o conteúdo JSON de um <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono text-amber-600">storageState.json</code> do Playwright.
          </p>

          <textarea
            id="fb-session-input-textarea"
            value={sessionInput}
            onChange={(e) => setSessionInput(e.target.value)}
            rows={4}
            placeholder="Cole aqui: c_user=1000...; xs=38%3A... (ou JSON do storageState)"
            className="w-full p-3 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 dark:text-white"
          />

          <div className="flex items-center justify-between">
            <div className="text-[11px] text-slate-400">
              Os cookies são gravados exclusivamente em <code className="font-mono">data/browser-profiles/facebook/storageState.json</code>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowSessionInput(false)}
                className="px-3 py-1.5 text-xs rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                id="fb-save-session-btn"
                onClick={handleManualImport}
                disabled={!sessionInput.trim() || isConnecting}
                className="px-4 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 rounded-lg shadow-xs"
              >
                {isConnecting ? 'Validando...' : 'Salvar e Validar Sessão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Architecture & 2FA Information */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 transition-colors">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
          <Lock className="w-4 h-4 text-amber-500" />
          <span>Regra de Arquitetura: Sessão Persistente e 2FA</span>
        </h3>

        <div className="text-xs text-slate-600 dark:text-slate-400 space-y-2 leading-relaxed">
          <p>
            O robô do ForgeDeals <strong>não realiza login a cada publicação</strong>. Ele reutiliza um perfil persistente:
          </p>
          <ol className="list-decimal list-inside space-y-1 pl-2 text-slate-700 dark:text-slate-300">
            <li>No primeiro acesso, a sessão é autenticada no Facebook (com 2FA informado pelo usuário).</li>
            <li>Os cookies e credenciais de sessão são armazenados em <code className="font-mono text-amber-600 dark:text-amber-400">data/browser-profiles/facebook</code>.</li>
            <li>As publicações agendadas (5 posts por dia nos horários programados) abrem diretamente o grupo utilizando a sessão já existente.</li>
            <li>Caso a sessão expire no Facebook, o status é alterado para <span className="font-semibold text-amber-600 dark:text-amber-400">Requer Reautenticação</span> sem enviar postagens corrompidas.</li>
          </ol>
        </div>
      </div>
    </div>
  );
};
