import React, { useState } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RotateCw,
  Send,
  ExternalLink,
  Eye,
  Trash2
} from 'lucide-react';
import { Publication, PublicationStatus } from '../types';

interface ScheduleTabProps {
  publications: Publication[];
  onPublishNow: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onReschedule: (id: string, newDateTime: string) => void;
  onDelete: (id: string) => void;
  onViewDetails: (pub: Publication) => void;
  onGenerateTodayBatch: () => void;
  isGeneratingBatch: boolean;
}

export const ScheduleTab: React.FC<ScheduleTabProps> = ({
  publications,
  onPublishNow,
  onRetry,
  onCancel,
  onReschedule,
  onDelete,
  onViewDetails,
  onGenerateTodayBatch,
  isGeneratingBatch
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [newScheduleTime, setNewScheduleTime] = useState<string>('');

  const filtered = publications.filter(p => {
    if (filterStatus === 'all') return true;
    return p.status === filterStatus;
  });

  const getStatusBadge = (status: PublicationStatus) => {
    switch (status) {
      case 'published':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Publicado
          </span>
        );
      case 'publishing':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 animate-pulse">
            <RotateCw className="w-3.5 h-3.5 mr-1 text-blue-600 animate-spin" />
            Publicando...
          </span>
        );
      case 'scheduled':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            <Clock className="w-3.5 h-3.5 mr-1 text-amber-600" />
            Agendado
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
            <AlertCircle className="w-3.5 h-3.5 mr-1 text-red-600" />
            Falhou
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
            <XCircle className="w-3.5 h-3.5 mr-1 text-slate-400" />
            Cancelado
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
            Rascunho
          </span>
        );
    }
  };

  const handleStartReschedule = (pub: Publication) => {
    setReschedulingId(pub.id);
    const date = new Date(pub.scheduled_at);
    // Format for datetime-local: YYYY-MM-DDTHH:mm
    const localIso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setNewScheduleTime(localIso);
  };

  const handleConfirmReschedule = (id: string) => {
    if (!newScheduleTime) return;
    onReschedule(id, new Date(newScheduleTime).toISOString());
    setReschedulingId(null);
  };

  return (
    <div className="space-y-5">
      {/* Top bar with batch action and filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900">Agenda de Publicações</h2>
          <p className="text-xs text-slate-500">
            Cadência diária de 5 horários (08:00, 11:00, 14:00, 17:00, 20:00) até o teto de 150/mês.
          </p>
        </div>

        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
          >
            <option value="all">Todos os Status ({publications.length})</option>
            <option value="scheduled">Agendados</option>
            <option value="published">Publicados</option>
            <option value="failed">Falhas</option>
            <option value="cancelled">Cancelados</option>
          </select>

          <button
            onClick={onGenerateTodayBatch}
            disabled={isGeneratingBatch}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white shadow-xs transition-colors whitespace-nowrap"
          >
            {isGeneratingBatch ? 'Gerando...' : '+ Agendar 5 de Hoje'}
          </button>
        </div>
      </div>

      {/* Publications Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-4">Data & Horário</th>
                <th className="py-3.5 px-4">Produto da Oferta</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Post no Facebook</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400">
                    Nenhuma publicação encontrada no filtro selecionado.
                  </td>
                </tr>
              ) : (
                filtered.map(pub => {
                  const scheduleDate = new Date(pub.scheduled_at);
                  const isRescheduling = reschedulingId === pub.id;

                  return (
                    <tr key={pub.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Date & Time */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isRescheduling ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="datetime-local"
                              value={newScheduleTime}
                              onChange={e => setNewScheduleTime(e.target.value)}
                              className="text-xs p-1.5 border border-orange-500 rounded bg-white"
                            />
                            <button
                              onClick={() => handleConfirmReschedule(pub.id)}
                              className="px-2 py-1 bg-orange-600 text-white text-xs rounded hover:bg-orange-700"
                            >
                              Salvar
                            </button>
                            <button
                              onClick={() => setReschedulingId(null)}
                              className="px-2 py-1 bg-slate-200 text-slate-700 text-xs rounded hover:bg-slate-300"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-900 flex items-center space-x-1.5">
                              <Clock className="w-3.5 h-3.5 text-orange-600" />
                              <span>{scheduleDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <div className="text-xs text-slate-500 flex items-center space-x-1">
                              <CalendarIcon className="w-3 h-3 text-slate-400" />
                              <span>{scheduleDate.toLocaleDateString('pt-BR')}</span>
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Product */}
                      <td className="py-3 px-4 max-w-sm">
                        <p className="font-medium text-slate-900 line-clamp-1" title={pub.product?.product_name}>
                          {pub.product?.product_name || 'Produto Loja do Mecânico'}
                        </p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          Link Afiliado: {pub.product?.affiliate_url ? '.../20889' : 'Não vinculado'}
                        </p>
                        {pub.error_message && (
                          <p className="text-xs text-red-600 font-medium mt-1">
                            Erro: {pub.error_message}
                          </p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {getStatusBadge(pub.status)}
                      </td>

                      {/* Facebook Post Link */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {pub.facebook_post_url ? (
                          <a
                            href={pub.facebook_post_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                          >
                            <span>Ver no Grupo</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">Pendente de envio</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center space-x-1">
                          <button
                            onClick={() => onViewDetails(pub)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
                            title="Ver Copy"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {pub.status === 'scheduled' && (
                            <>
                              <button
                                onClick={() => onPublishNow(pub.id)}
                                className="px-2.5 py-1 text-xs font-semibold bg-orange-50 text-orange-700 hover:bg-orange-100 rounded border border-orange-200"
                                title="Publicar agora no Facebook"
                              >
                                Publicar
                              </button>
                              <button
                                onClick={() => handleStartReschedule(pub)}
                                className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded text-xs"
                                title="Reagendar"
                              >
                                Reagendar
                              </button>
                              <button
                                onClick={() => onCancel(pub.id)}
                                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Cancelar publicação"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}

                          {pub.status === 'failed' && (
                            <button
                              onClick={() => onRetry(pub.id)}
                              className="px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100 rounded border border-red-200 flex items-center space-x-1"
                              title="Tentar novamente"
                            >
                              <RotateCw className="w-3 h-3" />
                              <span>Retry</span>
                            </button>
                          )}

                          <button
                            onClick={() => onDelete(pub.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded"
                            title="Excluir da lista"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
