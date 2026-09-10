import React, { useEffect } from 'react';
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
  // Close mobile sidebar on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, setMobileOpen]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

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
          className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-200 ${
            facebookStatus?.connected
              ? 'bg-emerald-500 ring-4 ring-emerald-500/20 dark:ring-emerald-500/30'
              : 'bg-rose-500 ring-4 ring-rose-500/20 dark:ring-rose-500/30'
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
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-colors duration-200 select-none">
      {/* Brand Header */}
      <div className="p-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 dark:border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-xs dark:shadow-none">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-base tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
              ForgeDeals
              <span className="text-[10px] uppercase font-mono font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60">
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
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/40"
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
              className={`group w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/40 dark:focus-visible:ring-amber-400/40 ${
                isActive
                  ? 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold border border-amber-500/20 dark:border-amber-500/30 shadow-xs dark:shadow-none'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 active:bg-slate-200 dark:active:bg-slate-800 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 transition-colors duration-150 ${
                    isActive
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {item.badge}
            </button>
          );
        })}
      </nav>

      {/* Bottom section: Theme selector, User details, Logout */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 space-y-3 bg-slate-50/70 dark:bg-slate-900/70 backdrop-blur-xs transition-colors">
        {/* Theme mode toggle with complete dark mode styles */}
        <div className="flex items-center justify-between p-1 bg-slate-200/60 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 rounded-xl text-xs transition-colors">
          <button
            onClick={() => onThemeChange('light')}
            className={`flex-1 flex items-center justify-center py-1.5 rounded-lg gap-1.5 transition-all duration-150 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/40 ${
              theme === 'light'
                ? 'bg-white text-amber-600 shadow-xs font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Tema Claro"
          >
            <Sun className="w-3.5 h-3.5" />
            <span>Claro</span>
          </button>
          <button
            onClick={() => onThemeChange('dark')}
            className={`flex-1 flex items-center justify-center py-1.5 rounded-lg gap-1.5 transition-all duration-150 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-400/40 ${
              theme === 'dark'
                ? 'bg-slate-700 text-amber-400 shadow-xs font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Tema Escuro"
          >
            <Moon className="w-3.5 h-3.5" />
            <span>Escuro</span>
          </button>
          <button
            onClick={() => onThemeChange('system')}
            className={`flex-1 flex items-center justify-center py-1.5 rounded-lg gap-1.5 transition-all duration-150 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-400/40 ${
              theme === 'system'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Tema do Sistema"
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>Auto</span>
          </button>
        </div>

        {/* User Card */}
        {currentUser && (
          <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between shadow-xs dark:shadow-none transition-colors">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">
                <UserCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {currentUser.name || 'Admin ForgeDeals'}
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate font-mono">
                  {currentUser.email}
                </div>
              </div>
            </div>

            <button
              id="sidebar-logout-btn"
              onClick={onLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-rose-500/40"
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
      {/* Desktop Sidebar: Fixed width with dark mode border and background */}
      <aside className="hidden lg:block w-64 h-screen fixed inset-y-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop with smooth opacity transition */}
      <div
        id="sidebar-mobile-backdrop"
        onClick={() => setMobileOpen(false)}
        className={`lg:hidden fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
          mobileOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Mobile Sidebar Drawer with smooth transform transition and dark mode elevation */}
      <aside
        id="sidebar-mobile-drawer"
        aria-label="Navegação mobile"
        aria-hidden={!mobileOpen}
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-2xl shadow-slate-950/30 dark:shadow-black/60 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
};
