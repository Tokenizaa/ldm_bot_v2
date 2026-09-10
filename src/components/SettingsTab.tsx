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

  // Sync if settings loads after mount
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
    <div className="space-y-8 max-w-4xl">
      {/* Operational Settings Form */}
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Parâmetros Operacionais</h2>
            <p className="text-xs text-slate-500">Configuração de cotas, horários e grupo do Facebook</p>
          </div>
          <button
            type="submit"
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-500 text-white shadow-xs transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Configurações</span>
          </button>
        </div>

        {saveSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold flex items-center space-x-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Configurações atualizadas com sucesso!</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Facebook Group URL */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-slate-700">URL do Grupo do Facebook</label>
            <input
              type="text"
              value={formData.facebook_group_url}
              onChange={e => setFormData({ ...formData, facebook_group_url: e.target.value })}
              className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 font-mono"
            />
            <p className="text-[11px] text-slate-400">Grupo onde as 5 ofertas diárias serão publicadas.</p>
          </div>

          {/* Daily Limit */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Limite Diário de Ofertas (Padrão: 5)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={formData.daily_limit}
              onChange={e => setFormData({ ...formData, daily_limit: Number(e.target.value) })}
              className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
            />
          </div>

          {/* Monthly Limit */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Limite Mensal de Ofertas (Padrão: 150)</label>
            <input
              type="number"
              min={1}
              max={500}
              value={formData.monthly_limit}
              onChange={e => setFormData({ ...formData, monthly_limit: Number(e.target.value) })}
              className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500"
            />
          </div>

          {/* Daily Hours */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-slate-700">
              Horários Diários da Agenda (Separados por vírgula)
            </label>
            <input
              type="text"
              value={formData.daily_hours.join(', ')}
              onChange={e => setFormData({
                ...formData,
                daily_hours: e.target.value.split(',').map(h => h.trim()).filter(Boolean)
              })}
              className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 font-mono"
            />
            <p className="text-[11px] text-slate-400">Padrão da especificação: 08:00, 11:00, 14:00, 17:00, 20:00.</p>
          </div>

          {/* NVIDIA AI Model */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-semibold text-slate-700">Modelo NVIDIA AI</label>
            <input
              type="text"
              value={formData.nvidia_model}
              onChange={e => setFormData({ ...formData, nvidia_model: e.target.value })}
              className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 font-mono"
            />
            <p className="text-[11px] text-slate-400">Modelo padrão: meta/llama-3.1-70b-instruct</p>
          </div>
        </div>
      </form>

      {/* Requirement 16: Three Sensitive Keys Status (Never exposing secret values!) */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center space-x-2">
          <Shield className="w-5 h-5 text-slate-700" />
          <h2 className="text-base font-bold text-slate-900">Status das Chaves de Ambiente (.env)</h2>
        </div>
        <p className="text-xs text-slate-500">
          Por segurança (Regra 16), os valores das chaves nunca são exibidos no painel nem gravados em logs.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-slate-800">NVIDIA_API_KEY</span>
              <span className={`w-2 h-2 rounded-full ${envStatus?.hasNvidiaKey ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            </div>
            <p className="text-xs mt-2 font-medium text-slate-600">
              {envStatus?.hasNvidiaKey ? '✓ Configurada no ambiente' : '⚠️ Não configurada'}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-slate-800">SUPABASE_URL</span>
              <span className={`w-2 h-2 rounded-full ${envStatus?.hasSupabaseUrl ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            </div>
            <p className="text-xs mt-2 font-medium text-slate-600">
              {envStatus?.hasSupabaseUrl ? '✓ Configurada no ambiente' : 'Persistência local ativa'}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-slate-800">SUPABASE_SERVICE_ROLE_KEY</span>
              <span className={`w-2 h-2 rounded-full ${envStatus?.hasSupabaseKey ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            </div>
            <p className="text-xs mt-2 font-medium text-slate-600">
              {envStatus?.hasSupabaseKey ? '✓ Configurada no ambiente' : 'Persistência local ativa'}
            </p>
          </div>
        </div>
      </div>

      {/* Supabase SQL DDL Schema */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900">Script SQL para o Supabase</h2>
          </div>
          <button
            onClick={handleCopySql}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSql ? 'Copiado!' : 'Copiar Script SQL'}</span>
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Tabelas mínimas: <code className="font-mono">products</code>, <code className="font-mono">publications</code>, <code className="font-mono">price_history</code>, <code className="font-mono">settings</code>.
        </p>
        <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto max-h-60">
          {supabaseSql}
        </pre>
      </div>
    </div>
  );
};
