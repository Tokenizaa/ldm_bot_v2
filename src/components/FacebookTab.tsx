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
  Info
} from 'lucide-react';
import { FacebookSessionStatus, AppSettings } from '../types';

interface FacebookTabProps {
  status: FacebookSessionStatus | null;
  settings: AppSettings | null;
  onConnect: (storageState?: string) => Promise<void>;
  onTestPublish: () => Promise<void>;
  isConnecting: boolean;
  isTesting: boolean;
}

export const FacebookTab: React.FC<FacebookTabProps> = ({
  status,
  settings,
  onConnect,
  onTestPublish,
  isConnecting,
  isTesting
}) => {
  const [sessionInput, setSessionInput] = useState('');
  const [showSessionInput, setShowSessionInput] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const isConnected = status?.connected && status?.status === 'connected';

  const handleManualImport = async () => {
    if (!sessionInput.trim()) return;
    await onConnect(sessionInput);
    setSessionInput('');
    setShowSessionInput(false);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Status Card */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {isConnected ? <ShieldCheck className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-slate-900">Perfil Persistente do Facebook</h2>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  isConnected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {isConnected ? 'Sessão Conectada' : 'Requer Autenticação (2FA)'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Diretório seguro: <code className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded">data/browser-profiles/facebook</code> (ignorado no Git)
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => onConnect()}
              disabled={isConnecting}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white shadow-xs transition-colors disabled:opacity-50"
            >
              {isConnecting ? 'Verificando/Abrindo...' : 'Conectar Facebook'}
            </button>

            <button
              onClick={async () => {
                setTestResult('Enviando teste de publicação...');
                try {
                  await onTestPublish();
                  setTestResult('Publicação de teste executada com sucesso!');
                } catch (e: any) {
                  setTestResult(`Erro no teste: ${e.message}`);
                }
              }}
              disabled={isTesting}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors disabled:opacity-50"
            >
              {isTesting ? 'Publicando teste...' : 'Testar Publicação'}
            </button>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Grupo Alvo Configurado</span>
            <div className="flex items-center space-x-2 mt-2">
              <Globe className="w-4 h-4 text-slate-400 shrink-0" />
              <a
                href={settings?.facebook_group_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-blue-600 hover:underline truncate"
              >
                {settings?.facebook_group_url || 'https://www.facebook.com/groups/...'}
              </a>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Última Autenticação</span>
            <p className="text-sm font-medium text-slate-800 mt-2">
              {status?.last_authenticated_at ? new Date(status.last_authenticated_at).toLocaleString('pt-BR') : 'Nenhuma sessão ativa'}
            </p>
          </div>
        </div>

        {testResult && (
          <div className="mt-4 p-3 rounded-lg bg-blue-50 text-blue-900 border border-blue-200 text-xs font-medium">
            {testResult}
          </div>
        )}
      </div>

      {/* Requirement 8 & 39: Explanation on 2FA and Persistent Profile */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
          <Lock className="w-4 h-4 text-orange-600" />
          <span>Regra de Arquitetura: Sessão Persistente e 2FA Manual</span>
        </h3>

        <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
          <p>
            O navegador <strong>não faz login a cada publicação</strong>. Ele utiliza um perfil persistente do Chromium/Playwright:
          </p>
          <ol className="list-decimal list-inside space-y-1 pl-2 text-slate-700">
            <li>No primeiro acesso (Setup), o Chrome abre para o usuário efetuar o login no Facebook.</li>
            <li>O Facebook solicita a verificação de duas etapas (2FA).</li>
            <li>O usuário informa o código manualmente no próprio navegador.</li>
            <li>Após autenticado, os cookies e estado de sessão são salvos no perfil persistente e reutilizados nas 5 publicações diárias sem abrir login novamente.</li>
          </ol>
        </div>

        {/* Remote / Headless Container Session Import */}
        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FolderLock className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-semibold text-slate-800">
                Importar Sessão Manualmente (Para Servidor / Cloud Run)
              </span>
            </div>
            <button
              onClick={() => setShowSessionInput(!showSessionInput)}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700"
            >
              {showSessionInput ? 'Ocultar Campo' : 'Inserir Cookies/storageState'}
            </button>
          </div>

          {showSessionInput && (
            <div className="mt-3 space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-500">
                Cole aqui os cookies do Facebook (ex: <code className="bg-slate-200 px-1 py-0.5 rounded">c_user=...; xs=...;</code>) ou o JSON completo de um <code className="bg-slate-200 px-1 py-0.5 rounded">storageState.json</code> do Playwright:
              </p>
              <textarea
                value={sessionInput}
                onChange={e => setSessionInput(e.target.value)}
                rows={4}
                placeholder="Cole o storageState.json ou string de cookies (c_user=...; xs=...)"
                className="w-full p-2.5 text-xs font-mono bg-white border border-slate-300 rounded focus:ring-2 focus:ring-orange-500"
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={handleManualImport}
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-500"
                >
                  Salvar no Perfil Persistente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
