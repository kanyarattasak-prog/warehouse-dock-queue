import React, { useState } from 'react';
import { Menu, Moon, Sun, X } from 'lucide-react';

interface TopNavProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const NAV_ITEMS = [
  { path: '/', label: 'จองคิวรถ' },
  { path: '/staff', label: 'เจ้าหน้าที่' },
  { path: '/admin', label: 'แอดมิน' },
  { path: '/qr', label: 'ป้าย QR' },
];

export function TopNav({ currentPath, onNavigate, theme, onToggleTheme }: TopNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (path: string) => {
    setMobileOpen(false);
    onNavigate(path);
  };

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Single text brand wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            handleNav('/');
          }}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0"
        >
          คิวรถหน้าโกดัง
        </a>

        {/* Zone 2: Clean single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium" aria-label="เมนูหลัก">
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.path;
            return (
              <a
                key={item.path}
                href={item.path}
                onClick={(e) => {
                  e.preventDefault();
                  handleNav(item.path);
                }}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 font-semibold'
                    : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: Primary utility action (Theme toggle + Mobile menu toggle) */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            className="min-h-[44px] min-w-[44px] px-2.5 flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            aria-label={theme === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
            title={theme === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span className="hidden sm:inline">{theme === 'dark' ? 'สว่าง' : 'มืด'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="เปิดเมนู"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 grid grid-cols-2 gap-1.5"
          aria-label="เมนูมือถือ"
        >
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.path;
            return (
              <a
                key={item.path}
                href={item.path}
                onClick={(e) => {
                  e.preventDefault();
                  handleNav(item.path);
                }}
                className={`min-h-[44px] px-3 rounded-xl flex items-center text-sm font-medium whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      )}
    </header>
  );
}
