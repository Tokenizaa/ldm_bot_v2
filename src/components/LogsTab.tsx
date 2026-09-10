import React from 'react';
import { Terminal, RefreshCw } from 'lucide-react';
import { LogEntry } from '../types';

interface LogsTabProps {
  logs: LogEntry[];
  onRefresh: () => void;
  isLoading: boolean;
}

export const LogsTab: React.FC<LogsTabProps> = ({ logs, onRefresh, isLoading }) => {
  const getBadgeClass = (source: LogEntry['source']) => {
    switch (source) {
      case 'Crawler':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
      case 'AI':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
      case 'Scheduler':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
      case 'Facebook':
        return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20';
      case 'Supabase':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
      case 'Auth':
        return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
      default:
        return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
    }
  };

  const getLevelDot = (level: LogEntry['level']) => {
    switch (level) {
      case 'error':
        return 'bg-rose-500';
      case 'warn':
        return 'bg-amber-500';
      case 'success':
        return 'bg-emerald-500';
      default:
        return 'bg-slate-400';
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs transition-colors">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-amber-500" />
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Console de Eventos Operacionais</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Rastreamento limpo de execução sem exposição de segredos</p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-500' : ''}`} />
          <span>Atualizar Logs</span>
        </button>
      </div>

      <div className="bg-slate-950 text-slate-200 rounded-2xl p-4 font-mono text-xs shadow-inner overflow-hidden border border-slate-800">
        <div className="space-y-2 max-h-[550px] overflow-y-auto pr-2">
          {logs.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              Nenhum log registrado ainda. Execute uma ação no painel para visualizar o histórico em tempo real.
            </div>
          ) : (
            logs.map(entry => (
              <div key={entry.id} className="flex items-start gap-3 hover:bg-slate-900 p-2 rounded-lg transition-colors">
                <span className="text-slate-500 shrink-0 text-[11px]">
                  {new Date(entry.timestamp).toLocaleTimeString('pt-BR')}
                </span>

                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${getBadgeClass(entry.source)}`}>
                  [{entry.source}]
                </span>

                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getLevelDot(entry.level)}`} />
                  <span className={`break-all ${
                    entry.level === 'error'
                      ? 'text-rose-400 font-semibold'
                      : entry.level === 'warn'
                      ? 'text-amber-400'
                      : entry.level === 'success'
                      ? 'text-emerald-400'
                      : 'text-slate-300'
                  }`}>
                    {entry.message}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
