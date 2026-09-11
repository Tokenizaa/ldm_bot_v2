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
  Check,
  Package,
  Wrench
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
      {/* Top Banner / Actions */}
      <div className="bg-slate-900 dark:bg-slate-900/90 text-white rounded-2xl p-6 shadow-sm border border-slate-800">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                Operação Real de Ofertas
              </span>
              <span className="text-xs text-slate-400">Meta: 150/mês • 5/dia</span>
            </div>
            <h1 className="text-2xl font-bold mt-1.5 text-white tracking-tight">
              Painel de Controle ForgeDeals
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Scraping de produtos reais da Loja do Mecânico, geração de copy via NVIDIA AI (Llama 3.1 70B) e agendamento de 5 postagens diárias no grupo do Facebook com link de afiliado <code className="text-amber-400 font-mono">/20889</code>.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 w-full lg:w-auto">
            <button
              id="dash-run-crawler-btn"
              onClick={onRunCrawler}
              disabled={isRunningCrawler}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${isRunningCrawler ? 'animate-spin text-amber-400' : ''}`} />
              <span>{isRunningCrawler ? 'Raspando...' : '1. Executar Crawler'}</span>
            </button>

            <button
              id="dash-gen-batch-btn"
              onClick={onGenerateBatch}
              disabled={isGeneratingBatch || (quota && quota.daily_publication_count >= quota.daily_limit)}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-sm transition-all disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isGeneratingBatch ? 'animate-spin' : ''}`} />
              <span>{isGeneratingBatch ? 'Gerando Lote...' : '2. Gerar Lote de Hoje (5)'}</span>
            </button>

            <button
              id="dash-process-due-btn"
              onClick={onProcessDue}
              disabled={isProcessingDue}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all disabled:opacity-50"
            >
              <Clock className={`w-3.5 h-3.5 ${isProcessingDue ? 'animate-spin' : ''}`} />
              <span>{isProcessingDue ? 'Publicando...' : '3. Publicar Vencidos'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Primary Metrics: Quotas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        {/* Card 1: Monthly Quota */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Publicações no Mês
            </span>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {monthPercentage}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {quota ? quota.monthly_publication_count : 0}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">/ {quota ? quota.monthly_limit : 150}</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${monthPercentage}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 mt-2.5">
            <span>Meta: 150 ofertas</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Restante: {quota ? quota.remaining_month : 150}
            </span>
          </div>
        </div>

        {/* Card 2: Daily Quota */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Publicações Hoje
            </span>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50">
              {dayPercentage}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-600 dark:text-amber-400">
              {quota ? quota.daily_publication_count : 0}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">/ {quota ? quota.daily_limit : 5}</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${dayPercentage}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 mt-2.5">
            <span>Horários: 08h, 11h, 14h, 17h, 20h</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {quota ? Math.max(0, quota.daily_limit - quota.daily_publication_count) : 5} vagas hoje
            </span>
          </div>
        </div>

        {/* Card 3: Remaining In Month */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Disponível no Mês
            </span>
            <Calendar className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {quota ? quota.remaining_month : 150}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">publicações</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
            Cadência automática de 5 posts/dia projetada para manter engajamento alto no Facebook sem gerar spam.
          </p>
        </div>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Produtos Encontrados</span>
          <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">{stats?.products_found || 0}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Produtos Válidos</span>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{stats?.products_valid || 0}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Produtos Publicados</span>
          <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">{stats?.products_published || 0}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Aguardando Verif.</span>
          <p className={`text-xl font-bold mt-1 ${stats?.unknown ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400 dark:text-slate-500'}`}>
            {stats?.unknown || 0}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Falhas Registradas</span>
          <p className={`text-xl font-bold mt-1 ${stats?.failures ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'}`}>
            {stats?.failures || 0}
          </p>
        </div>
      </div>

      {/* Next Publication Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs transition-colors">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Próxima Publicação Agendada</h2>
          </div>
          <button
            onClick={() => onNavigateToTab('schedule')}
            className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
          >
            <span>Ver Agenda Completa</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {stats?.next_publication ? (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              {stats.next_publication.product?.image_url && (
                <img
                  src={stats.next_publication.product.image_url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-lg object-contain bg-white dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-700 shrink-0"
                />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {stats.next_publication.product?.product_name || 'Produto sem título'}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                  <span>Horário: {new Date(stats.next_publication.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>•</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    R$ {stats.next_publication.product?.current_price?.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => onSelectPublication(stats.next_publication!)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              Visualizar Copy
            </button>
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
            Nenhuma publicação agendada no momento. Clique em <strong>"2. Gerar Lote de Hoje"</strong> para agendar os 5 horários do dia.
          </div>
        )}
      </div>
    </div>
  );
};
