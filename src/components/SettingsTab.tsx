import React, { useState } from 'react';
import { Settings, Save, Database, Key, Check, Copy, AlertCircle, Shield } from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsTabProps {
  settings: AppSettings | null;
  onSaveSettings: (settings: Partial<AppSettings>) => Promise<void>;
  envStatus: {
    hasNvidiaKey: boolean;
    hasSupabaseUrl: boolean;
    hasSupabaseKey: boolean;
  } | null;
  supabaseSql: string;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onSaveSettings,
  envStatus,
  supabaseSql
}) => {
  const [formData, setFormData] = useState<AppSettings | null>(settings);
  const [copiedSql, setCopiedSql] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  React.useEffect(() => {
    if (settings && !formData) {
      setFormData(settings);
    }
  }, [settings]);

  if (!formData) {
    return <div className="p-6 text-center text-slate-400">Carregando configurações...</div>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings(formData);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(supabaseSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Operational Settings Form */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-6 transition-colors">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Parâmetros Operacionais</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Configuração de cotas, horários e grupo do Facebook</p>
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Salvar Configurações</span>
          </button>
        </div>

        {saveSuccess && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" />
            <span>Configurações atualizadas com sucesso!</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Facebook Group URL */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">URL do Grupo do Facebook</label>
            <input
              type="text"
              value={formData.facebook_group_url}
              onChange={e => setFormData({ ...formData, facebook_group_url: e.target.value })}
              className="w-full p-2.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500/30 dark:text-white"
            />
            <p className="text-[11px] text-slate-400">Grupo onde as 5 ofertas diárias serão publicadas.</p>
          </div>

          {/* Daily Limit */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Limite Diário de Ofertas (Padrão: 5)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={formData.daily_limit}
              onChange={e => setFormData({ ...formData, daily_limit: Number(e.target.value) })}
              className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500/30 dark:text-white"
            />
          </div>

          {/* Monthly Limit */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Limite Mensal de Ofertas (Padrão: 150)</label>
            <input
              type="number"
              min={1}
              max={500}
              value={formData.monthly_limit}
              onChange={e => setFormData({ ...formData, monthly_limit: Number(e.target.value) })}
              className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500/30 dark:text-white"
            />
          </div>

          {/* Daily Hours */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Horários Diários da Agenda (Separados por vírgula)
            </label>
            <input
              type="text"
              value={formData.daily_hours.join(', ')}
              onChange={e => setFormData({
                ...formData,
                daily_hours: e.target.value.split(',').map(h => h.trim()).filter(Boolean)
              })}
              className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500/30 font-mono dark:text-white"
            />
            <p className="text-[11px] text-slate-400">Padrão da especificação: 08:00, 11:00, 14:00, 17:00, 20:00.</p>
          </div>

          {/* NVIDIA AI Model */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Modelo NVIDIA AI</label>
            <input
              type="text"
              value={formData.nvidia_model}
              onChange={e => setFormData({ ...formData, nvidia_model: e.target.value })}
              className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500/30 font-mono dark:text-white"
            />
            <p className="text-[11px] text-slate-400">Modelo padrão: meta/llama-3.1-70b-instruct</p>
          </div>
        </div>
      </form>

      {/* Sensitive Keys Status */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 transition-colors">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Status das Chaves de Ambiente (.env)</h2>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Por diretriz de segurança, chaves secretas são configuradas exclusivamente no servidor e jamais exibidas no navegador.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">NVIDIA_API_KEY</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                envStatus?.hasNvidiaKey
                  ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                  : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
              }`}>
                {envStatus?.hasNvidiaKey ? 'Configurada' : 'Pendente'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Llama 3.1 70B Copywriting</p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">SUPABASE_URL</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                envStatus?.hasSupabaseUrl
                  ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}>
                {envStatus?.hasSupabaseUrl ? 'Conectado' : 'Fallback Local'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">PostgreSQL & Auth</p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">SUPABASE_SERVICE_ROLE_KEY</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                envStatus?.hasSupabaseKey
                  ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }`}>
                {envStatus?.hasSupabaseKey ? 'Configurada' : 'Fallback Local'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Acesso Administrativo</p>
          </div>
        </div>
      </div>

      {/* SQL Migration Script */}
      {supabaseSql && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-500" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Script SQL para Supabase</h2>
            </div>
            <button
              onClick={handleCopySql}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
            >
              {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSql ? 'Copiado!' : 'Copiar SQL'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Execute este script no SQL Editor do seu projeto Supabase para criar as tabelas <code className="font-mono text-amber-600">products</code>, <code className="font-mono text-amber-600">publications</code> e <code className="font-mono text-amber-600">settings</code>.
          </p>
          <pre className="p-4 bg-slate-950 text-slate-200 rounded-xl text-xs font-mono overflow-x-auto max-h-60">
            {supabaseSql}
          </pre>
        </div>
      )}
    </div>
  );
};
