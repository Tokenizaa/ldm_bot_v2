import React from 'react';
import { Wrench, CheckCircle2, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { OperationalQuota } from '../types';

interface HeaderProps {
  quota: OperationalQuota | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  envStatus: {
    nvidiaConfigured: boolean;
    supabaseConnected: boolean;
    facebookConnected: boolean;
  } | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  quota,
  activeTab,
  setActiveTab,
  envStatus,
  onRefresh,
  isRefreshing
}) => {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'products', label: 'Produtos' },
    { id: 'schedule', label: 'Agenda (150/mês)' },
    { id: 'facebook', label: 'Facebook Group' },
    { id: 'logs', label: 'Logs do Sistema' },
    { id: 'settings', label: 'Configurações' },
  ];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-orange-600 flex items-center justify-center text-white shadow-sm">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-xl text-slate-900 tracking-tight">ForgeDeals</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-800 border border-orange-200">
                  Loja do Mecânico /20889
                </span>
              </div>
              <p className="text-xs text-slate-500">Automação de 150 ofertas/mês com NVIDIA AI</p>
            </div>
          </div>

          {/* Quick Status Badges */}
          <div className="hidden lg:flex items-center space-x-4 text-xs">
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
              <span className="text-slate-500">Mês:</span>
              <span className="font-semibold">{quota ? `${quota.monthly_publication_count} / ${quota.monthly_limit}` : '...'}</span>
            </div>

            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
              <span className="text-slate-500">Hoje:</span>
              <span className="font-semibold">{quota ? `${quota.daily_publication_count} / ${quota.daily_limit}` : '...'}</span>
            </div>

            {envStatus && (
              <div className="flex items-center space-x-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                  envStatus.facebookConnected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${envStatus.facebookConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  Facebook {envStatus.facebookConnected ? 'Conectado' : 'Setup Pendente'}
                </span>

                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                  envStatus.nvidiaConfigured ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${envStatus.nvidiaConfigured ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  NVIDIA AI
                </span>
              </div>
            )}

            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors"
              title="Atualizar dados"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-orange-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex space-x-1 sm:space-x-4 overflow-x-auto py-1 border-t border-slate-100">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-orange-50 text-orange-700 font-semibold border-b-2 border-orange-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
};
