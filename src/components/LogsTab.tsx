import React from 'react';
import { Terminal, Trash2, RefreshCw } from 'lucide-react';
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
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'AI':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Scheduler':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'Facebook':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const getLevelDot = (level: LogEntry['level']) => {
    switch (level) {
      case 'error':
        return 'bg-red-500';
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
      <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-2">
          <Terminal className="w-5 h-5 text-slate-700" />
          <div>
            <h2 className="text-base font-bold text-slate-900">Console de Eventos Operacionais</h2>
            <p className="text-xs text-slate-500">Rastreamento limpo de execução sem exposição de segredos (Regra 30)</p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-orange-600' : ''}`} />
          <span>Atualizar Logs</span>
        </button>
      </div>

      <div className="bg-slate-900 text-slate-200 rounded-xl p-4 font-mono text-xs shadow-inner overflow-hidden border border-slate-800">
        <div className="space-y-2 max-h-[550px] overflow-y-auto pr-2">
          {logs.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              Nenhum log registrado ainda. Execute uma ação para visualizar o histórico de eventos.
            </div>
          ) : (
            logs.map(entry => (
              <div key={entry.id} className="flex items-start space-x-3 hover:bg-slate-800/60 p-1.5 rounded transition-colors">
                <span className="text-slate-500 shrink-0 text-[11px]">
                  {new Date(entry.timestamp).toLocaleTimeString('pt-BR')}
                </span>

                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${getBadgeClass(entry.source)}`}>
                  [{entry.source}]
                </span>

                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getLevelDot(entry.level)}`} />
                  <span className={`break-all ${entry.level === 'error' ? 'text-red-400 font-semibold' : entry.level === 'warn' ? 'text-amber-400' : 'text-slate-200'}`}>
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
