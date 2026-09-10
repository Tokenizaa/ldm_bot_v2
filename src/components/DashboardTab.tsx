import React from 'react';
import {
  Calendar,
  Layers,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Sparkles,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  Flame,
  Check
} from 'lucide-react';
import { DashboardStats, OperationalQuota, Publication } from '../types';

interface DashboardTabProps {
  stats: DashboardStats | null;
  quota: OperationalQuota | null;
  onRunCrawler: () => void;
  onGenerateBatch: () => void;
  onProcessDue: () => void;
  isRunningCrawler: boolean;
  isGeneratingBatch: boolean;
  isProcessingDue: boolean;
  onSelectPublication: (pub: Publication) => void;
  onNavigateToTab: (tab: string) => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  stats,
  quota,
  onRunCrawler,
  onGenerateBatch,
  onProcessDue,
  isRunningCrawler,
  isGeneratingBatch,
  isProcessingDue,
  onSelectPublication,
  onNavigateToTab
}) => {
  const monthPercentage = quota ? Math.min(100, Math.round((quota.monthly_publication_count / quota.monthly_limit) * 100)) : 0;
  const dayPercentage = quota ? Math.min(100, Math.round((quota.daily_publication_count / quota.daily_limit) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Action Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl p-6 text-white shadow-sm border border-slate-700">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">
                Ciclo Operacional Automatizado
              </span>
              <span className="text-xs text-slate-400">Setembro / 2026</span>
            </div>
            <h1 className="text-2xl font-bold mt-1 text-white tracking-tight">
              Automação de Ofertas Loja do Mecânico
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              Coleta produtos reais, valida o link afiliado <code className="text-orange-400 font-mono">/20889</code>, gera copy comercial com NVIDIA AI e publica 5 ofertas por dia no grupo do Facebook.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={onRunCrawler}
              disabled={isRunningCrawler}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all cursor-pointer disabled:opacity-50"
            >
              <Play className={`w-4 h-4 ${isRunningCrawler ? 'animate-spin text-orange-400' : ''}`} />
              <span>{isRunningCrawler ? 'Raspando...' : '1. Executar Crawler'}</span>
            </button>

            <button
              onClick={onGenerateBatch}
              disabled={isGeneratingBatch || (quota && quota.daily_publication_count >= quota.daily_limit)}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold bg-orange-600 hover:bg-orange-500 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              <Sparkles className={`w-4 h-4 ${isGeneratingBatch ? 'animate-spin' : ''}`} />
              <span>{isGeneratingBatch ? 'Gerando com NVIDIA...' : '2. Gerar Lote de Hoje (5)'}</span>
            </button>

            <button
              onClick={onProcessDue}
              disabled={isProcessingDue}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              <Clock className={`w-4 h-4 ${isProcessingDue ? 'animate-spin' : ''}`} />
              <span>{isProcessingDue ? 'Publicando...' : '3. Publicar Vencidos'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Requirement 2: Key Operational Metrics Display */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Monthly Quota */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Publicações no mês</span>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {monthPercentage}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-slate-900">
              {quota ? quota.monthly_publication_count : 0}
            </span>
            <span className="text-base text-slate-500 font-medium">/ {quota ? quota.monthly_limit : 150}</span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-orange-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${monthPercentage}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs text-slate-500 mt-2">
            <span>Meta: 150 no mês</span>
            <span className="font-semibold text-slate-700">Restante: {quota ? quota.remaining_month : 150}</span>
          </div>
        </div>

        {/* Card 2: Daily Quota */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Publicações hoje</span>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-100">
              {dayPercentage}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-orange-600">
              {quota ? quota.daily_publication_count : 0}
            </span>
            <span className="text-base text-slate-500 font-medium">/ {quota ? quota.daily_limit : 5}</span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-orange-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${dayPercentage}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs text-slate-500 mt-2">
            <span>5 horários por dia</span>
            <span className="font-semibold text-slate-700">
              {quota ? Math.max(0, quota.daily_limit - quota.daily_publication_count) : 5} vagas hoje
            </span>
          </div>
        </div>

        {/* Card 3: Remaining in month */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Restante do mês</span>
            <Calendar className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-slate-900">
              {quota ? quota.remaining_month : 150}
            </span>
            <span className="text-base text-slate-500 font-medium">ofertas</span>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Cadência operacional calculada para 30 dias contínuos sem ultrapassar o teto mensal.
          </p>
        </div>
      </div>

      {/* Secondary Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs font-medium text-slate-500">Produtos encontrados</span>
          <p className="text-xl font-bold text-slate-900 mt-1">{stats?.products_found || 0}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs font-medium text-slate-500">Produtos válidos</span>
          <p className="text-xl font-bold text-emerald-600 mt-1">{stats?.products_valid || 0}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs font-medium text-slate-500">Produtos publicados</span>
          <p className="text-xl font-bold text-slate-900 mt-1">{stats?.products_published || 0}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <span className="text-xs font-medium text-slate-500">Falhas registradas</span>
          <p className={`text-xl font-bold mt-1 ${stats?.failures ? 'text-red-600' : 'text-slate-400'}`}>
            {stats?.failures || 0}
          </p>
        </div>
      </div>

      {/* Next Scheduled Publication Section */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-orange-600" />
            <h2 className="text-base font-bold text-slate-900">Próxima Publicação Agendada</h2>
          </div>
          <button
            onClick={() => onNavigateToTab('schedule')}
            className="text-xs font-medium text-orange-600 hover:text-orange-700 flex items-center space-x-1"
          >
            <span>Ver toda a agenda</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {stats?.next_publication ? (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
                  Agendado para {new Date(stats.next_publication.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(stats.next_publication.scheduled_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <h3 className="font-semibold text-slate-900 text-base">
                {stats.next_publication.product?.product_name || 'Produto da Loja do Mecânico'}
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                Link Afiliado: {stats.next_publication.product?.affiliate_url || 'https://www.lojadomecanico.com.br/.../20889'}
              </p>
            </div>

            <div className="flex items-center space-x-2 w-full md:w-auto">
              <button
                onClick={() => onSelectPublication(stats.next_publication!)}
                className="px-3 py-1.5 text-xs font-medium bg-white text-slate-700 border border-slate-300 rounded hover:bg-slate-50"
              >
                Ver Copy
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 text-sm">
            Nenhuma publicação agendada pendente no momento.
            <div className="mt-2">
              <button
                onClick={onGenerateBatch}
                className="text-xs font-semibold text-orange-600 hover:underline"
              >
                Clique aqui para gerar o lote de 5 ofertas para hoje
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Flow Explanation / Verification Checklist */}
      <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
          Regras de Negócio e Garantias Operacionais
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs text-slate-600">
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <div className="font-semibold text-slate-800 mb-1 flex items-center space-x-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Link Afiliado /20889</span>
            </div>
            <p>Normalização rigorosa de URL e validação obrigatória do sufixo <code>/20889</code> antes de qualquer postagem.</p>
          </div>

          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <div className="font-semibold text-slate-800 mb-1 flex items-center space-x-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Anti-Duplicação Estável</span>
            </div>
            <p>Identidade única por SKU ou URL normalizada no banco de dados. Nunca publica o mesmo item em duplicidade.</p>
          </div>

          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <div className="font-semibold text-slate-800 mb-1 flex items-center space-x-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>NVIDIA AI Copywriting</span>
            </div>
            <p>Sem Ollama. Gera textos comerciais diretos para mecânicos e profissionais sem inventar descontos falsos.</p>
          </div>

          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <div className="font-semibold text-slate-800 mb-1 flex items-center space-x-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Browser Persistente</span>
            </div>
            <p>Login e 2FA feitos uma única vez. Sessão e cookies salvos em <code>data/browser-profiles/facebook</code>.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
