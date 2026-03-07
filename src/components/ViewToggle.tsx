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
    <div className="flex rounded-lg border border-violet-800 overflow-hidden">
      {views.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => { trackViewChange(mode); onViewChange(mode); }}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer',
            viewMode === mode
              ? 'bg-cyan-500 text-white'
              : 'bg-violet-900 text-violet-300 hover:text-violet-100 hover:bg-violet-800 active:text-violet-100 active:bg-violet-800'
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
