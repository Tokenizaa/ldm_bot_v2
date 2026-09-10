import React from 'react';
import {
  LayoutDashboard,
  Package,
  CalendarClock,
  Share2,
  Settings,
  Terminal,
  LogOut,
  Moon,
  Sun,
  Laptop,
  Wrench,
  X,
  UserCheck
} from 'lucide-react';
import { SystemUser, ThemeMode, FacebookSessionStatus } from '../types';

export type TabType = 'dashboard' | 'products' | 'schedule' | 'facebook' | 'settings' | 'logs';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  currentUser: SystemUser | null;
  onLogout: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  facebookStatus?: FacebookSessionStatus;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onLogout,
  theme,
  onThemeChange,
  mobileOpen,
  setMobileOpen,
  facebookStatus
}) => {
  const navItems: { id: TabType; label: string; icon: React.FC<{ className?: string }>; badge?: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'products', label: 'Produtos', icon: Package },
    { id: 'schedule', label: 'Agenda', icon: CalendarClock },
    {
      id: 'facebook',
      label: 'Facebook',
      icon: Share2,
      badge: (
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            facebookStatus?.connected ? 'bg-emerald-500 ring-4 ring-emerald-500/20' : 'bg-rose-500'
          }`}
          title={facebookStatus?.connected ? 'Facebook Conectado' : 'Facebook Desconectado'}
        />
      )
    },
    { id: 'settings', label: 'Configurações', icon: Settings },
    { id: 'logs', label: 'Logs', icon: Terminal }
  ];

  const handleNavClick = (tab: TabType) => {
    setActiveTab(tab);
    setMobileOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 select-none">
      {/* Brand Header */}
      <div className="p-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-base tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
              ForgeDeals
              <span className="text-[10px] uppercase font-mono font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                v2.1
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
              Loja do Mecânico AI
            </div>
          </div>
        </div>

        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              id={`sidebar-nav-${item.id}`}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge}
            </button>
          );
        })}
      </nav>

      {/* Bottom section: Theme selector, User details, Logout */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50/50 dark:bg-slate-900/50">
        {/* Theme mode toggle */}
        <div className="flex items-center justify-between p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
          <button
            onClick={() => onThemeChange('light')}
            className={`flex-1 flex items-center justify-center py-1.5 rounded-md gap-1 transition-colors ${
              theme === 'light'
                ? 'bg-white dark:bg-slate-700 text-amber-600 shadow-xs font-medium'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
            title="Tema Claro"
          >
            <Sun className="w-3.5 h-3.5" />
            <span>Claro</span>
          </button>
          <button
            onClick={() => onThemeChange('dark')}
            className={`flex-1 flex items-center justify-center py-1.5 rounded-md gap-1 transition-colors ${
              theme === 'dark'
                ? 'bg-white dark:bg-slate-700 text-amber-400 shadow-xs font-medium'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
            title="Tema Escuro"
          >
            <Moon className="w-3.5 h-3.5" />
            <span>Escuro</span>
          </button>
          <button
            onClick={() => onThemeChange('system')}
            className={`flex-1 flex items-center justify-center py-1.5 rounded-md gap-1 transition-colors ${
              theme === 'system'
                ? 'bg-white dark:bg-slate-700 text-indigo-500 shadow-xs font-medium'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
            title="Tema do Sistema"
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>Auto</span>
          </button>
        </div>

        {/* User Card */}
        {currentUser && (
          <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">
                <UserCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {currentUser.name || 'Admin ForgeDeals'}
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                  {currentUser.email}
                </div>
              </div>
            </div>

            <button
              id="sidebar-logout-btn"
              onClick={onLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
              title="Sair do sistema"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar: Fixed width */}
      <aside className="hidden lg:block w-64 h-screen fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-xs transition-opacity"
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-200 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
};
