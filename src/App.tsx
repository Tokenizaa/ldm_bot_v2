import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { DashboardTab } from './components/DashboardTab';
import { ProductsTab } from './components/ProductsTab';
import { ScheduleTab } from './components/ScheduleTab';
import { FacebookTab } from './components/FacebookTab';
import { SettingsTab } from './components/SettingsTab';
import { LogsTab } from './components/LogsTab';
import { CopyModal } from './components/CopyModal';
import {
  DashboardStats,
  OperationalQuota,
  Product,
  Publication,
  FacebookSessionStatus,
  AppSettings,
  LogEntry
} from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
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
  const [isConnectingFb, setIsConnectingFb] = useState(false);
  const [isTestingFb, setIsTestingFb] = useState(false);

  // Notification / feedback toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Modal states
  const [selectedProductForCopy, setSelectedProductForCopy] = useState<Product | undefined>();
  const [selectedPublicationForCopy, setSelectedPublicationForCopy] = useState<Publication | undefined>();
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);

  // Data fetching
  const fetchAllData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // 1. Stats & Quota
      const statsRes = await fetch('/api/stats');
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.stats);
        setQuota(data.quota);
        setEnvStatus(data.envStatus);
      }

      // 2. Products
      const prodRes = await fetch('/api/products');
      if (prodRes.ok) {
        const data = await prodRes.json();
        setProducts(data.products || []);
      }

      // 3. Publications
      const pubRes = await fetch('/api/publications');
      if (pubRes.ok) {
        const data = await pubRes.json();
        setPublications(data.publications || []);
      }

      // 4. Facebook
      const fbRes = await fetch('/api/facebook/status');
      if (fbRes.ok) {
        const data = await fbRes.json();
        setFacebookStatus(data);
      }

      // 5. Settings
      const setRes = await fetch('/api/settings');
      if (setRes.ok) {
        const data = await setRes.json();
        setSettings(data.settings);
      }

      // 6. Logs
      const logsRes = await fetch('/api/logs?limit=50');
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs || []);
      }

      // 7. Supabase DDL
      const sqlRes = await fetch('/api/supabase/schema');
      if (sqlRes.ok) {
        const data = await sqlRes.json();
        setSupabaseSql(data.schema || '');
      }
    } catch (err: any) {
      console.error('Error fetching data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 30000); // 30s background sync
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // Actions
  const handleRunCrawler = async () => {
    setIsRunningCrawler(true);
    showToast('Iniciando raspagem de ofertas na Loja do Mecânico...', 'info');
    try {
      const res = await fetch('/api/crawler/run', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Crawler concluído! Encontrados: ${data.products_found}, Válidos: ${data.products_valid}, Novos: ${data.products_new}`, 'success');
        await fetchAllData();
      } else {
        showToast(`Falha no crawler: ${data.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`Erro ao executar crawler: ${err.message}`, 'error');
    } finally {
      setIsRunningCrawler(false);
    }
  };

  const handleGenerateBatch = async () => {
    setIsGeneratingBatch(true);
    showToast('Gerando lote de 5 ofertas com NVIDIA AI e agendando...', 'info');
    try {
      const res = await fetch('/api/scheduler/batch-today', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || '5 ofertas agendadas com sucesso!', 'success');
        await fetchAllData();
      } else {
        showToast(`Falha ao gerar lote: ${data.error || data.message}`, 'error');
      }
    } catch (err: any) {
      showToast(`Erro ao gerar lote: ${err.message}`, 'error');
    } finally {
      setIsGeneratingBatch(false);
    }
  };

  const handleProcessDue = async () => {
    setIsProcessingDue(true);
    showToast('Verificando publicações vencidas para envio ao Facebook...', 'info');
    try {
      const res = await fetch('/api/scheduler/run-due', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Processamento concluído: ${data.processed} publicações enviadas!`, 'success');
        await fetchAllData();
      } else {
        showToast(`Falha ao processar publicações: ${data.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`Erro: ${err.message}`, 'error');
    } finally {
      setIsProcessingDue(false);
    }
  };

  const handlePublishNow = async (id: string) => {
    showToast('Publicando agora no grupo do Facebook...', 'info');
    try {
      const res = await fetch(`/api/publications/${id}/publish-now`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Publicação enviada com sucesso para o Facebook!', 'success');
        await fetchAllData();
      } else {
        showToast(`Falha na publicação: ${data.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`Erro: ${err.message}`, 'error');
    }
  };

  const handleRetry = async (id: string) => {
    showToast('Tentando novamente a publicação...', 'info');
    try {
      const res = await fetch(`/api/publications/${id}/retry`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Publicação enviada com sucesso!', 'success');
        await fetchAllData();
      } else {
        showToast(`Erro no retry: ${data.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`Erro: ${err.message}`, 'error');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await fetch(`/api/publications/${id}/cancel`, { method: 'POST' });
      showToast('Publicação cancelada.', 'info');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro: ${err.message}`, 'error');
    }
  };

  const handleReschedule = async (id: string, newDateTime: string) => {
    try {
      await fetch(`/api/publications/${id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_at: newDateTime })
      });
      showToast('Horário reagendado com sucesso!', 'success');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro: ${err.message}`, 'error');
    }
  };

  const handleDeletePublication = async (id: string) => {
    try {
      await fetch(`/api/publications/${id}`, { method: 'DELETE' });
      showToast('Publicação removida.', 'info');
      await fetchAllData();
    } catch (err: any) {
      showToast(`Erro: ${err.message}`, 'error');
    }
  };

  const handleConnectFacebook = async (storageState?: string) => {
    setIsConnectingFb(true);
    showToast('Iniciando configuração do perfil persistente do Facebook...', 'info');
    try {
      const res = await fetch('/api/facebook/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageState })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        await fetchAllData();
      } else {
        showToast(data.message, 'error');
      }
    } catch (err: any) {
      showToast(`Erro de conexão com Facebook: ${err.message}`, 'error');
    } finally {
      setIsConnectingFb(false);
    }
  };

  const handleTestPublish = async () => {
    setIsTestingFb(true);
    try {
      const res = await fetch('/api/facebook/test-publish', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Publicação de teste enviada com sucesso para o Facebook!', 'success');
        await fetchAllData();
      } else {
        showToast(`Erro no teste: ${data.error}`, 'error');
      }
    } finally {
      setIsTestingFb(false);
    }
  };

  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        showToast('Configurações salvas com sucesso!', 'success');
      }
    } catch (err: any) {
      showToast(`Erro ao salvar configurações: ${err.message}`, 'error');
    }
  };

  const handleScheduleFromModal = async (productId: string, content: string, scheduleTime: string) => {
    try {
      const res = await fetch('/api/publications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          content,
          scheduled_at: scheduleTime,
          facebook_group_url: settings?.facebook_group_url
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Oferta agendada com sucesso!', 'success');
        await fetchAllData();
      } else {
        showToast(data.error || 'Erro ao agendar', 'error');
      }
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans flex flex-col">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-in fade-in slide-in-from-bottom-5">
          <div className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium border ${
            toast.type === 'success' ? 'bg-emerald-800 text-emerald-50 border-emerald-700' :
            toast.type === 'error' ? 'bg-red-800 text-red-50 border-red-700' :
            'bg-slate-900 text-slate-100 border-slate-700'
          }`}>
            {toast.message}
          </div>
        </div>
      )}

      {/* Header */}
      <Header
        quota={quota}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        envStatus={envStatus}
        onRefresh={fetchAllData}
        isRefreshing={isRefreshing}
      />

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'dashboard' && (
          <DashboardTab
            stats={stats}
            quota={quota}
            onRunCrawler={handleRunCrawler}
            onGenerateBatch={handleGenerateBatch}
            onProcessDue={handleProcessDue}
            isRunningCrawler={isRunningCrawler}
            isGeneratingBatch={isGeneratingBatch}
            isProcessingDue={isProcessingDue}
            onSelectPublication={(pub) => {
              setSelectedPublicationForCopy(pub);
              setSelectedProductForCopy(undefined);
              setIsCopyModalOpen(true);
            }}
            onNavigateToTab={setActiveTab}
          />
        )}

        {activeTab === 'products' && (
          <ProductsTab
            products={products}
            isLoading={isRefreshing}
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
            onRetry={handleRetry}
            onCancel={handleCancel}
            onReschedule={handleReschedule}
            onDelete={handleDeletePublication}
            onViewDetails={(pub) => {
              setSelectedPublicationForCopy(pub);
              setSelectedProductForCopy(undefined);
              setIsCopyModalOpen(true);
            }}
            onGenerateTodayBatch={handleGenerateBatch}
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
          />
        )}

        {activeTab === 'logs' && (
          <LogsTab
            logs={logs}
            onRefresh={fetchAllData}
            isLoading={isRefreshing}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            onSaveSettings={handleSaveSettings}
            envStatus={{
              hasNvidiaKey: envStatus?.nvidiaConfigured ?? false,
              hasSupabaseUrl: envStatus?.supabaseConnected ?? false,
              hasSupabaseKey: envStatus?.supabaseConnected ?? false
            }}
            supabaseSql={supabaseSql}
          />
        )}
      </main>

      {/* Copy Modal */}
      <CopyModal
        product={selectedProductForCopy}
        publication={selectedPublicationForCopy}
        isOpen={isCopyModalOpen}
        onClose={() => setIsCopyModalOpen(false)}
        onSaveAndSchedule={handleScheduleFromModal}
        onPublishNow={handlePublishNow}
      />
    </div>
  );
}
