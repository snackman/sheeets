'use client';

import { Map, List, Table } from 'lucide-react';
import { ViewMode } from '@/lib/types';
import clsx from 'clsx';

interface ViewToggleProps {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
}

const views: { mode: ViewMode; icon: typeof Map; label: string }[] = [
  { mode: 'table', icon: Table, label: 'Table' },
  { mode: 'list', icon: List, label: 'List' },
  { mode: 'map', icon: Map, label: 'Map' },
];

export function ViewToggle({ viewMode, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      {views.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => onViewChange(mode)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer',
            viewMode === mode
              ? 'bg-orange-500 text-white'
              : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 active:text-gray-800 dark:active:text-slate-200 active:bg-gray-200 dark:active:bg-slate-700'
          )}
          aria-label={`${label} view`}
        >
          <Icon className="w-4 h-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
