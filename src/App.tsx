import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, TabType } from './components/Sidebar';
import { DashboardTab } from './components/DashboardTab';
import { ProductsTab } from './components/ProductsTab';
import { ScheduleTab } from './components/ScheduleTab';
import { FacebookTab } from './components/FacebookTab';
import { SettingsTab } from './components/SettingsTab';
import { LogsTab } from './components/LogsTab';
import { CopyModal } from './components/CopyModal';
import { LoginScreen } from './components/LoginScreen';
import {
  DashboardStats,
  OperationalQuota,
  Product,
  Publication,
  FacebookSessionStatus,
  AppSettings,
  LogEntry,
  SystemUser,
  ThemeMode
} from './types';
import { apiRequest, getAuthToken, removeAuthToken } from './services/apiClient';
import { Menu, RefreshCw, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';

export default function App() {
  // Authentication state
  const [currentUser, setCurrentUser] = useState<SystemUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Theme state
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('forgedeals_theme') as ThemeMode) || 'dark';
  });

  // Navigation and UI state
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Application data
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [quota, setQuota] = useState<OperationalQuota | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [facebookStatus, setFacebookStatus] = useState<FacebookSessionStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [envStatus, setEnvStatus] = useState<any>(null);
  const [supabaseSql, setSupabaseSql] = useState<string>('');

  // Loading states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunningCrawler, setIsRunningCrawler] = useState(false);
  const [isGeneratingBatch, setIsGeneratingBatch] = useState(false);
  const [isProcessingDue, setIsProcessingDue] = useState(false);
  const [isSchedulingAll, setIsSchedulingAll] = useState(false);
  const [isConnectingFb, setIsConnectingFb] = useState(false);
  const [isTestingFb, setIsTestingFb] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Copy modal
  const [selectedProductForCopy, setSelectedProductForCopy] = useState<Product | undefined>();
  const [selectedPublicationForCopy, setSelectedPublicationForCopy] = useState<Publication | undefined>();
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);

  // Apply theme to document
  useEffect(() => {
    localStorage.setItem('forgedeals_theme', theme);
    const root = document.documentElement;
    const body = document.body;

    const applyDark = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
        body.classList.add('dark');
      } else {
        root.classList.remove('dark');
        body.classList.remove('dark');
      }
    };

    if (theme === 'dark') {
      applyDark(true);
    } else if (theme === 'light') {
      applyDark(false);
    } else {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyDark(systemDark);
    }
  }, [theme]);

  // Auth verification on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = getAuthToken();
      if (!token) {
        setIsCheckingAuth(false);
        return;
      }

      try {
        const res = await apiRequest<{ authenticated: boolean; user?: SystemUser }>('/api/auth/me');
        if (res.authenticated && res.user) {
          setCurrentUser(res.user);
        } else {
          removeAuthToken();
          setCurrentUser(null);
        }
      } catch (err) {
        removeAuthToken();
        setCurrentUser(null);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkAuth();

    const handleUnauthorized = () => {
      setCurrentUser(null);
      showToast('Sessão expirada. Faça login novamente.', 'error');
    };

    window.addEventListener('forgedeals_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('forgedeals_unauthorized', handleUnauthorized);
  }, []);

  // Fetch all dashboard data
  const fetchAllData = useCallback(async () => {
    if (!currentUser) return;
    setIsRefreshing(true);
    try {
      // 1. Stats & Quota
      const statsData = await apiRequest('/api/stats');
      setStats(statsData.stats);
      setQuota(statsData.quota);
      setEnvStatus(statsData.envStatus);

      // 2. Products
      const prodData = await apiRequest('/api/products');
      setProducts(prodData.products || []);

      // 3. Publications
      const pubData = await apiRequest('/api/publications');
      setPublications(pubData.publications || []);

      // 4. Facebook Status
      const fbData = await apiRequest('/api/facebook/status');
      setFacebookStatus(fbData);

      // 5. Settings
      const setData = await apiRequest('/api/settings');
      setSettings(setData.settings);

      // 6. Logs
      const logsData = await apiRequest('/api/logs?limit=60');
      setLogs(logsData.logs || []);

      // 7. Supabase SQL
      const sqlData = await apiRequest('/api/supabase-sql').catch(() => ({ sql: '' }));
      if (sqlData.sql) setSupabaseSql(sqlData.sql);
    } catch (err: any) {
      // Silent error or toast if user initiated
    } finally {
      setIsRefreshing(false);
    }
  }, [currentUser]);

  // Initial load and periodic poll
  useEffect(() => {
    if (currentUser) {
      fetchAllData();
      const interval = setInterval(fetchAllData, 30000);
      return () => clearInterval(interval);
    }
  }, [currentUser, fetchAllData]);

  // Operational Handlers
  const handleRunCrawler = async () => {
    setIsRunningCrawler(true);
    showToast('Executando raspagem de produtos reais na Loja do Mecânico...', 'info');
    try {
      const res = await apiRequest('/api/crawler/run', { method: 'POST' });
      showToast(`Crawler concluído: ${res.found} encontrados, ${res.valid} válidos com link /20889!`, 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro no crawler: ${err.message}`, 'error');
    } finally {
      setIsRunningCrawler(false);
    }
  };

  const handleGenerateTodayBatch = async () => {
    setIsGeneratingBatch(true);
    showToast('Gerando lote diário de 5 publicações com NVIDIA AI...', 'info');
    try {
      const res = await apiRequest('/api/scheduler/generate-batch', { method: 'POST' });
      showToast(`Lote gerado com sucesso! ${res.generated} novas publicações agendadas para hoje.`, 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro ao gerar lote: ${err.message}`, 'error');
    } finally {
      setIsGeneratingBatch(false);
    }
  };

  const handleScheduleAll = async () => {
    setIsSchedulingAll(true);
    showToast('Montando e programando automaticamente a fila de publicações...', 'info');
    try {
      const res = await apiRequest('/api/scheduler/generate-batch', { method: 'POST' });
      showToast(`${res.generated || 0} publicações preparadas para o agendamento automático.`, 'success');
      setActiveTab('schedule');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro ao programar: ${err.message}`, 'error');
    } finally {
      setIsSchedulingAll(false);
    }
  };

  const handleProcessDuePublications = async () => {
    setIsProcessingDue(true);
    showToast('Verificando e publicando ofertas agendadas no Facebook...', 'info');
    try {
      const res = await apiRequest('/api/scheduler/process-due', { method: 'POST' });
      showToast(`Processamento concluído: ${res.published} publicadas, ${res.failed} falhas.`, res.failed > 0 ? 'error' : 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro no envio: ${err.message}`, 'error');
    } finally {
      setIsProcessingDue(false);
    }
  };

  const handleConnectFacebook = async (sessionData?: string) => {
    setIsConnectingFb(true);
    try {
      const res = await apiRequest('/api/facebook/connect', {
        method: 'POST',
        body: JSON.stringify({ sessionData })
      });
      showToast('Sessão do Facebook salva e perfil persistente validado!', 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro na conexão com o Facebook: ${err.message}`, 'error');
    } finally {
      setIsConnectingFb(false);
    }
  };

  const handleTestPublish = async () => {
    setIsTestingFb(true);
    try {
      const res = await apiRequest('/api/facebook/test-publish', { method: 'POST' });
      if (!res?.success) {
        throw new Error(res?.message || res?.error || 'Facebook não confirmou a publicação.');
      }
      showToast(res.postUrl ? 'Publicação de teste confirmada no Facebook.' : 'Publicação de teste executada; Facebook confirmou o envio.', 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Falha no teste: ${err.message}`, 'error');
      throw err;
    } finally {
      setIsTestingFb(false);
    }
  };

  const handlePublishNow = async (id: string) => {
    try {
      showToast('Enviando publicação imediatamente ao Facebook...', 'info');
      await apiRequest(`/api/publications/${id}/publish-now`, { method: 'POST' });
      showToast('Publicado com sucesso no Facebook Group!', 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro ao publicar: ${err.message}`, 'error');
    }
  };

  const handleRetryPublication = async (id: string) => {
    try {
      await apiRequest(`/api/publications/${id}/retry`, { method: 'POST' });
      showToast('Publicação reagendada para nova tentativa.', 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro ao retentar: ${err.message}`, 'error');
    }
  };

  const handleCancelPublication = async (id: string) => {
    try {
      await apiRequest(`/api/publications/${id}/cancel`, { method: 'POST' });
      showToast('Publicação cancelada.', 'info');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro ao cancelar: ${err.message}`, 'error');
    }
  };

  const handleReschedulePublication = async (id: string, newDateTime: string) => {
    try {
      await apiRequest(`/api/publications/${id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduled_at: newDateTime })
      });
      showToast('Horário atualizado com sucesso!', 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro ao reagendar: ${err.message}`, 'error');
    }
  };

  const handleDeletePublication = async (id: string) => {
    try {
      await apiRequest(`/api/publications/${id}`, { method: 'DELETE' });
      showToast('Publicação removida.', 'info');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro ao excluir: ${err.message}`, 'error');
    }
  };

  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    try {
      const res = await apiRequest('/api/settings', {
        method: 'POST',
        body: JSON.stringify(newSettings)
      });
      setSettings(res.settings);
      showToast('Configurações atualizadas!', 'success');
    } catch (err: any) {
      showToast(`Erro ao salvar configurações: ${err.message}`, 'error');
      throw err;
    }
  };

  const handleLogout = () => {
    removeAuthToken();
    setCurrentUser(null);
    showToast('Você saiu do sistema.', 'info');
  };

  // If checking authentication
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Iniciando ForgeDeals...</span>
        </div>
      </div>
    );
  }

  // If user is not authenticated, show LoginScreen
  if (!currentUser) {
    return (
      <LoginScreen
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          showToast(`Bem-vindo, ${user.name}!`, 'success');
        }}
        theme={theme}
        onThemeChange={setTheme}
      />
    );
  }

  const tabTitles: Record<TabType, string> = {
    dashboard: 'Dashboard Operacional',
    products: 'Catálogo de Produtos',
    schedule: 'Agenda de Publicações',
    facebook: 'Conexão Facebook',
    settings: 'Configurações do Sistema',
    logs: 'Console de Logs'
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Toast alert */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-in fade-in slide-in-from-bottom-5">
          <div className={`p-4 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-semibold border ${
            toast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/90 text-emerald-900 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800'
              : toast.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/90 text-rose-900 dark:text-rose-200 border-rose-300 dark:border-rose-800'
              : 'bg-slate-900 dark:bg-slate-800 text-white border-slate-700'
          }`}>
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Sidebar Navigation (Replaces old navbar) */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        onLogout={handleLogout}
        theme={theme}
        onThemeChange={setTheme}
        mobileOpen={mobileMenuOpen}
        setMobileOpen={setMobileMenuOpen}
        facebookStatus={facebookStatus || undefined}
      />

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 min-h-screen">
        {/* Lean Top Header Bar */}
        <header className="h-16 px-4 sm:px-6 lg:px-8 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 z-20 transition-colors duration-200">
          <div className="flex items-center gap-3">
            {/* Mobile menu trigger */}
            <button
              id="mobile-sidebar-toggle"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 transition-all duration-150 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/40"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                {tabTitles[activeTab]}
              </h1>
              <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Loja do Mecânico /20889</span>
                <span>•</span>
                <span>NVIDIA AI (Llama 3.2 11B)</span>
                <span>•</span>
                <span>Meta: 150/mês (5/dia)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Facebook indicator */}
            <div
              onClick={() => setActiveTab('facebook')}
              className="cursor-pointer hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full text-xs bg-slate-100 hover:bg-slate-200/70 dark:bg-slate-800/80 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 transition-colors"
              title="Clique para abrir configuração do Facebook"
            >
              <span className={`w-2 h-2 rounded-full ${facebookStatus?.connected ? 'bg-emerald-500 ring-2 ring-emerald-500/30' : 'bg-rose-500 ring-2 ring-rose-500/30'}`} />
              <span className="text-[11px] font-medium">
                {facebookStatus?.connected ? 'Facebook Conectado' : 'Facebook Desconectado'}
              </span>
            </div>

            {/* Refresh button */}
            <button
              id="global-refresh-btn"
              onClick={fetchAllData}
              disabled={isRefreshing}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/40"
              title="Atualizar dados agora"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-500' : ''}`} />
            </button>
          </div>
        </header>

        {/* Content Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardTab
              stats={stats}
              quota={quota}
              onRunCrawler={handleRunCrawler}
              onGenerateBatch={handleGenerateTodayBatch}
              onProcessDue={handleProcessDuePublications}
              isRunningCrawler={isRunningCrawler}
              isGeneratingBatch={isGeneratingBatch}
              isProcessingDue={isProcessingDue}
              onSelectPublication={(pub) => {
                setSelectedPublicationForCopy(pub);
                setSelectedProductForCopy(undefined);
                setIsCopyModalOpen(true);
              }}
              onNavigateToTab={(tab) => setActiveTab(tab as TabType)}
            />
          )}

          {activeTab === 'products' && (
            <ProductsTab
              products={products}
              isLoading={isRunningCrawler}
              onRefresh={fetchAllData}
              onGenerateCopy={(product) => {
                setSelectedProductForCopy(product);
                setSelectedPublicationForCopy(undefined);
                setIsCopyModalOpen(true);
              }}
            />
          )}

          {activeTab === 'schedule' && (
            <ScheduleTab
              publications={publications}
              onPublishNow={handlePublishNow}
              onRetry={handleRetryPublication}
              onCancel={handleCancelPublication}
              onReschedule={handleReschedulePublication}
              onDelete={handleDeletePublication}
              onViewDetails={(pub) => {
                setSelectedPublicationForCopy(pub);
                setSelectedProductForCopy(undefined);
                setIsCopyModalOpen(true);
              }}
              onGenerateTodayBatch={handleGenerateTodayBatch}
              onScheduleAll={handleScheduleAll}
              isSchedulingAll={isSchedulingAll}
              isGeneratingBatch={isGeneratingBatch}
            />
          )}

          {activeTab === 'facebook' && (
            <FacebookTab
              status={facebookStatus}
              settings={settings}
              onConnect={handleConnectFacebook}
              onTestPublish={handleTestPublish}
              isConnecting={isConnectingFb}
              isTesting={isTestingFb}
              onRefreshStatus={fetchAllData}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              settings={settings}
              onSaveSettings={handleSaveSettings}
              envStatus={envStatus}
              supabaseSql={supabaseSql}
            />
          )}

          {activeTab === 'logs' && (
            <LogsTab
              logs={logs}
              onRefresh={fetchAllData}
              isLoading={isRefreshing}
            />
          )}
        </main>
      </div>

      {/* Copy & AI Generator Modal */}
      <CopyModal
        isOpen={isCopyModalOpen}
        onClose={() => setIsCopyModalOpen(false)}
        product={selectedProductForCopy}
        publication={selectedPublicationForCopy}
        onSaveAndSchedule={async (productId, content, scheduleTime) => {
          try {
            await apiRequest('/api/publications', {
              method: 'POST',
              body: JSON.stringify({
                product_id: productId,
                content,
                scheduled_at: scheduleTime
              })
            });
            showToast('Oferta agendada com sucesso!', 'success');
            await fetchAllData();
          } catch (err: any) {
            showToast(`Erro ao agendar: ${err.message}`, 'error');
          }
        }}
        onPublishNow={handlePublishNow}
      />
    </div>
  );
}
