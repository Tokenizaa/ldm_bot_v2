import React, { useState } from 'react';
import { X, Sparkles, Copy, Check, Send, Calendar, AlertCircle } from 'lucide-react';
import { Product, Publication } from '../types';

interface CopyModalProps {
  product?: Product;
  publication?: Publication;
  isOpen: boolean;
  onClose: () => void;
  onSaveAndSchedule?: (productId: string, content: string, scheduleTime: string) => Promise<void>;
  onPublishNow?: (publicationId: string) => Promise<void>;
}

export const CopyModal: React.FC<CopyModalProps> = ({
  product,
  publication,
  isOpen,
  onClose,
  onSaveAndSchedule,
  onPublishNow
}) => {
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (publication) {
      setContent(publication.content);
      const dt = new Date(publication.scheduled_at);
      const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setScheduleTime(localIso);
    } else if (product) {
      // Set default schedule time to 1 hour from now
      const now = new Date(Date.now() + 3600000);
      const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setScheduleTime(localIso);

      // Generate copy via API
      generateCopy();
    }
  }, [product, publication, isOpen]);

  if (!isOpen) return null;

  const currentProduct = publication?.product || product;

  const generateCopy = async () => {
    if (!currentProduct) return;
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/products/${currentProduct.id}/generate-copy`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.content) {
        setContent(data.content);
      } else {
        setErrorMsg(data.error || 'Erro ao gerar copy com NVIDIA AI');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleScheduleSubmit = async () => {
    if (!currentProduct || !onSaveAndSchedule) return;
    if (!content.includes('/20889')) {
      setErrorMsg('O conteúdo DEVE conter o link com sufixo /20889 antes de agendar.');
      return;
    }
    await onSaveAndSchedule(currentProduct.id, content, new Date(scheduleTime).toISOString());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-orange-600" />
            <h3 className="text-base font-bold text-slate-900">
              {publication ? 'Publicação Agendada' : 'Gerador de Copy — NVIDIA AI'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {currentProduct && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center space-x-3">
            {currentProduct.image_url && (
              <img
                src={currentProduct.image_url}
                alt=""
                className="w-12 h-12 rounded object-cover bg-white border border-slate-200 shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900 text-xs truncate">{currentProduct.product_name}</p>
              <p className="text-xs text-orange-600 font-bold mt-0.5">
                R$ {currentProduct.current_price.toFixed(2)}
                <span className="text-[11px] font-mono text-slate-500 ml-2">
                  (Afiliado: .../20889)
                </span>
              </p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-medium flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">Texto Comercial do Post</label>
            <div className="flex items-center space-x-2">
              <button
                onClick={generateCopy}
                disabled={isGenerating}
                className="text-xs font-semibold text-orange-600 hover:underline"
              >
                {isGenerating ? 'Gerando com IA...' : 'Regenerar com NVIDIA AI'}
              </button>
              <span className="text-slate-300">|</span>
              <button
                onClick={handleCopy}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center space-x-1"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
          </div>

          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={8}
            placeholder="Aguardando geração da copy..."
            className="w-full p-3 text-xs font-sans bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:bg-white"
          />

          {!publication && onSaveAndSchedule && (
            <div className="space-y-1 pt-2">
              <label className="text-xs font-semibold text-slate-700 flex items-center space-x-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>Horário Agendado</span>
              </label>
              <input
                type="datetime-local"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
                className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end space-x-3 pt-4 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Fechar
          </button>

          {!publication && onSaveAndSchedule && (
            <button
              onClick={handleScheduleSubmit}
              disabled={isGenerating || !content.trim()}
              className="px-4 py-2 text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white rounded-lg shadow-xs"
            >
              Agendar Publicação
            </button>
          )}

          {publication && onPublishNow && publication.status !== 'published' && (
            <button
              onClick={async () => {
                await onPublishNow(publication.id);
                onClose();
              }}
              className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-xs flex items-center space-x-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Publicar Agora</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
