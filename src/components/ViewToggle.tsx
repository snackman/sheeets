'use client';

import { Map, List, Table } from 'lucide-react';
import { ViewMode } from '@/lib/types';
import { trackViewChange } from '@/lib/analytics';
import clsx from 'clsx';

interface ViewToggleProps {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
}

const views: { mode: ViewMode; icon: typeof Map; label: string }[] = [
  { mode: 'map', icon: Map, label: 'Map' },
  { mode: 'list', icon: List, label: 'List' },
  { mode: 'table', icon: Table, label: 'Table' },
];

export function ViewToggle({ viewMode, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-lg border border-stone-700 overflow-hidden">
      {views.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => { trackViewChange(mode); onViewChange(mode); }}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer',
            viewMode === mode
              ? 'bg-amber-500 text-white'
              : 'bg-stone-900 text-stone-400 hover:text-stone-200 hover:bg-stone-800 active:text-stone-200 active:bg-stone-800'
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
