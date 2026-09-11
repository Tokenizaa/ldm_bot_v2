import React, { useState } from 'react';
import { X, Sparkles, Copy, Check, Calendar, AlertCircle } from 'lucide-react';
import { Product, Publication } from '../types';
import { apiRequest } from '../services/apiClient';

interface CopyModalProps {
  product?: Product;
  publication?: Publication;
  isOpen: boolean;
  onClose: () => void;
  onSaveAndSchedule?: (productId: string, content: string, scheduleTime: string) => Promise<void>;
  onPublishNow?: (publicationId: string) => Promise<void>;
}

export const CopyModal: React.FC<CopyModalProps> = ({ product, publication, isOpen, onClose, onSaveAndSchedule, onPublishNow }) => {
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (publication) {
      setContent(publication.content);
      const dt = new Date(publication.scheduled_at);
      setScheduleTime(new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    } else if (product) {
      const now = new Date(Date.now() + 3600000);
      setScheduleTime(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
      generateCopy();
    }
  }, [product, publication, isOpen]);

  if (!isOpen) return null;
  const currentProduct = publication?.product || product;

  const generateCopy = async () => {
    if (!currentProduct) return;
    setIsGenerating(true); setErrorMsg(null);
    try {
      const data = await apiRequest<{ success: boolean; content?: string; error?: string }>(`/api/products/${currentProduct.id}/generate-copy`, { method: 'POST' });
      if (data.success && data.content) setContent(data.content); else setErrorMsg(data.error || 'Erro ao gerar copy com NVIDIA AI');
    } catch (e: any) { setErrorMsg(e.message); } finally { setIsGenerating(false); }
  };

  const handleCopy = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const handleScheduleSubmit = async () => {
    if (!currentProduct || !onSaveAndSchedule) return;
    if (!content.trim()) { setErrorMsg('A copy está vazia.'); return; }
    await onSaveAndSchedule(currentProduct.id, content, new Date(scheduleTime).toISOString());
    onClose();
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
    <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 relative transition-colors">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-amber-500" /><h3 className="text-base font-bold text-slate-900 dark:text-white">{publication ? 'Programação da Publicação' : 'Gerador de Copy — NVIDIA AI'}</h3></div>
        <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"><X className="w-5 h-5" /></button>
      </div>

      {currentProduct && <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center gap-3">
        {currentProduct.image_url && <img src={currentProduct.image_url} alt="" referrerPolicy="no-referrer" className="w-12 h-12 object-contain rounded-lg bg-white dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-700 shrink-0" />}
        <div className="min-w-0"><div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{currentProduct.product_name}</div><div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Preço: <strong className="text-emerald-600 dark:text-emerald-400">R$ {currentProduct.current_price?.toFixed(2)}</strong> • SKU: {currentProduct.sku || 'N/A'}</div></div>
      </div>}

      {errorMsg && <div className="mt-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /><span>{errorMsg}</span></div>}

      <div className="mt-4 space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Texto da Postagem no Facebook:</label><div className="flex items-center gap-2">
        <button onClick={generateCopy} disabled={isGenerating} className="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 disabled:opacity-50"><Sparkles className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} /><span>Regenerar com IA</span></button>
        <button onClick={handleCopy} className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1">{copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}<span>{copied ? 'Copiado!' : 'Copiar'}</span></button>
      </div></div>
      <textarea rows={7} value={content} onChange={e => setContent(e.target.value)} placeholder="Aguardando geração do texto pela NVIDIA AI..." className="w-full p-3 text-xs font-sans bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500/30 dark:text-white leading-relaxed" />
      </div>

      <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        {!publication && onSaveAndSchedule && <div className="flex items-center gap-2 w-full sm:w-auto"><label className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">Horário:</label><input type="datetime-local" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="p-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg dark:text-white" /></div>}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button onClick={onClose} className="px-3 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">Fechar</button>
          {!publication && onSaveAndSchedule && <button onClick={handleScheduleSubmit} disabled={!content || isGenerating} className="px-4 py-2 text-xs font-semibold rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /><span>Programar</span></button>}
          {publication && onPublishNow && publication.status !== 'published' && <button onClick={() => { onPublishNow(publication.id); onClose(); }} className="px-4 py-2 text-xs font-semibold rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs transition-colors flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /><span>Programar</span></button>}
        </div>
      </div>
    </div>
  </div>;
};
