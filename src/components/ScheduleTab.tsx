import React from 'react';
import { Clock, CheckCircle2, AlertCircle, XCircle, RotateCw, ExternalLink, Eye, Trash2, CalendarCheck } from 'lucide-react';
import { Publication, PublicationStatus } from '../types';

interface ScheduleTabProps {
  publications: Publication[];
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onViewDetails: (pub: Publication) => void;
  onScheduleAll: () => void;
  isSchedulingAll: boolean;
}

export const ScheduleTab: React.FC<ScheduleTabProps> = ({ publications, onRetry, onDelete, onViewDetails, onScheduleAll, isSchedulingAll }) => {
  const [filterStatus, setFilterStatus] = useState('all');
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [newScheduleTime, setNewScheduleTime] = useState('');
  const filtered = publications.filter(p => filterStatus === 'all' || p.status === filterStatus);

  const getStatusBadge = (status: PublicationStatus) => {
    switch (status) {
      case 'published': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600 dark:text-emerald-400" />Publicado</span>;
      case 'publishing': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 animate-pulse"><RotateCw className="w-3.5 h-3.5 mr-1 text-blue-600 dark:text-blue-400 animate-spin" />Publicando...</span>;
      case 'scheduled': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"><Clock className="w-3.5 h-3.5 mr-1 text-amber-600 dark:text-amber-400" />Agendado</span>;
      case 'failed': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800"><AlertCircle className="w-3.5 h-3.5 mr-1 text-rose-600 dark:text-rose-400" />Falhou</span>;
      case 'cancelled': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"><XCircle className="w-3.5 h-3.5 mr-1 text-slate-500" />Cancelado</span>;
      default: return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">Rascunho</span>;
    }
  };



  return <div className="space-y-5">
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs transition-colors">
      <div>
        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2"><CalendarCheck className="w-5 h-5 text-amber-500" /><span>Fila Operacional de Agendamentos (150/mês • 5/dia)</span></h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Distribuição diária automática: 08h, 11h, 14h, 17h e 20h no Grupo do Facebook.</p>
      </div>
      <div className="flex items-center gap-2.5 w-full sm:w-auto">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30">
          <option value="all">Todos os status ({publications.length})</option><option value="scheduled">Agendados</option><option value="published">Publicados</option><option value="failed">Falhas</option><option value="cancelled">Cancelados</option>
        </select>
        <button id="sched-program-btn" onClick={onScheduleAll} disabled={isSchedulingAll} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs transition-colors disabled:opacity-50"><CalendarCheck className={`w-3.5 h-3.5 ${isSchedulingAll ? 'animate-pulse' : ''}`} /><span>{isSchedulingAll ? 'Programando...' : 'Programar'}</span></button>
      </div>
    </div>

    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs transition-colors">
      <div className="overflow-x-auto"><table className="w-full text-left border-collapse"><thead><tr className="bg-slate-50/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider"><th className="py-3 px-4">Horário Agendado</th><th className="py-3 px-4">Produto da Oferta</th><th className="py-3 px-4">Status</th><th className="py-3 px-4">Link do Facebook</th><th className="py-3 px-4 text-right">Ações</th></tr></thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
        {filtered.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-slate-400 dark:text-slate-500">Nenhuma publicação encontrada no filtro selecionado.</td></tr> : filtered.map(pub => {
          const scheduleDate = new Date(pub.scheduled_at); const isPast = scheduleDate < new Date(); const isRescheduling = reschedulingId === pub.id;
          return <tr key={pub.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
            <td className="py-3 px-4 whitespace-nowrap"><div><div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200"><Clock className={`w-3.5 h-3.5 ${isPast && pub.status === 'scheduled' ? 'text-amber-500' : 'text-slate-400'}`} /><span>{scheduleDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div><div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{scheduleDate.toLocaleDateString('pt-BR')}</div></div>}</td>
            <td className="py-3 px-4 max-w-sm"><div className="font-medium text-slate-900 dark:text-slate-100 truncate" title={pub.product?.product_name}>{pub.product?.product_name || 'Produto Loja do Mecânico'}</div><div className="text-[11px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">Afiliado: {pub.product?.affiliate_url ? '.../20889' : 'Não vinculado'}</div>{pub.error_message && <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium mt-1">Erro: {pub.error_message}</div>}</td>
            <td className="py-3 px-4 whitespace-nowrap">{getStatusBadge(pub.status)}</td>
            <td className="py-3 px-4 whitespace-nowrap">{pub.facebook_post_url ? <a href={pub.facebook_post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium"><span>Ver no Grupo</span><ExternalLink className="w-3 h-3" /></a> : <span className="text-xs text-slate-400 dark:text-slate-500">Pendente de envio</span>}</td>
            <td className="py-3 px-4 text-right whitespace-nowrap"><div className="inline-flex items-center gap-1.5">
              <button onClick={() => onViewDetails(pub)} className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Visualizar Copy"><Eye className="w-4 h-4" /></button>
              {pub.status === 'scheduled' && <>
                <button onClick={() => onPublishNow(pub.id)} className="px-2.5 py-1 text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg border border-amber-200 dark:border-amber-800 transition-colors" title="Programar esta publicação no Facebook"><CalendarCheck className="w-3 h-3" /><span>Programar</span></button>
                <button onClick={() => handleStartReschedule(pub)} className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-xs transition-colors" title="Alterar horário antes de programar">Reagendar</button>
                <button onClick={() => onCancel(pub.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors" title="Cancelar publicação"><XCircle className="w-4 h-4" /></button>
              </>}
              {pub.status === 'failed' && <button onClick={() => onRetry(pub.id)} className="px-2.5 py-1 text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 rounded-lg border border-rose-200 dark:border-rose-800 flex items-center gap-1" title="Tentar novamente"><RotateCw className="w-3 h-3" /><span>Retry</span></button>}
              <button onClick={() => onDelete(pub.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
            </div></td>
          </tr>;
        })}
      </tbody></table></div>
    </div>
  </div>;
};
