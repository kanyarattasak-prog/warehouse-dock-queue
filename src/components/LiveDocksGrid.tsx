import React from 'react';
import { WarehouseSettings } from '../types';
import { getDockName, JOB_TYPE_LABELS } from '../lib/status';

export interface DockOccupant {
  id: string;
  dock_number: number | null;
  license_plate: string;
  status: 'called' | 'loading' | string;
  job_type: 'pickup' | 'dropoff';
  company?: string;
}

interface LiveDocksGridProps {
  settings: WarehouseSettings;
  occupants: DockOccupant[];
  compact?: boolean;
}

export function LiveDocksGrid({ settings, occupants, compact = false }: LiveDocksGridProps) {
  const closedSet = new Set(settings.closed_docks || []);
  const dockNumbers = Array.from({ length: settings.dock_count }, (_, idx) => idx + 1);

  const occupantByDock = new Map<number, DockOccupant>();
  for (const b of occupants) {
    if (b.dock_number && (b.status === 'called' || b.status === 'loading')) {
      occupantByDock.set(b.dock_number, b);
    }
  }

  return (
    <div
      className={`grid gap-3 ${
        settings.dock_count <= 2
          ? 'grid-cols-2'
          : settings.dock_count === 3
            ? 'grid-cols-1 sm:grid-cols-3'
            : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
      }`}
    >
      {dockNumbers.map((num) => {
        const isClosed = closedSet.has(num);
        const occ = occupantByDock.get(num);
        const dockTitle = getDockName(settings, num);

        let stateLabel = 'ว่าง';
        let cardClasses =
          'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800';
        let stateClasses = 'text-emerald-700 dark:text-emerald-400';

        if (isClosed) {
          stateLabel = 'ปิดชั่วคราว';
          cardClasses =
            'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 opacity-75';
          stateClasses = 'text-slate-500 dark:text-slate-400';
        } else if (occ) {
          if (occ.status === 'loading') {
            stateLabel = 'กำลังขึ้น/ลงของ';
            cardClasses =
              'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800';
            stateClasses = 'text-indigo-700 dark:text-indigo-300';
          } else {
            stateLabel = 'เรียกคิวเข้าโดค';
            cardClasses =
              'bg-red-50/70 dark:bg-red-950/40 border-red-200 dark:border-red-800';
            stateClasses = 'text-red-700 dark:text-red-300';
          }
        }

        return (
          <div
            key={num}
            className={`rounded-xl border ${compact ? 'p-3' : 'p-4'} transition-colors ${cardClasses}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {dockTitle}
              </span>
              <span className={`text-xs font-medium whitespace-nowrap ${stateClasses}`}>
                {stateLabel}
              </span>
            </div>

            <div className="mt-2">
              {isClosed ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">งดให้บริการ</p>
              ) : occ ? (
                <div className="space-y-0.5">
                  <p className="text-lg font-bold font-mono-tabular text-slate-900 dark:text-white tracking-tight truncate">
                    {occ.license_plate}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                    {JOB_TYPE_LABELS[occ.job_type]}
                    {occ.company ? ` · ${occ.company}` : ''}
                  </p>
                </div>
              ) : (
                <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">ว่าง</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
