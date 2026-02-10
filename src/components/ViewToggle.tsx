'use client';

import { Map, List } from 'lucide-react';
import { ViewMode } from '@/lib/types';
import clsx from 'clsx';

interface ViewToggleProps {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
}

export function ViewToggle({ viewMode, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-lg border border-slate-700 overflow-hidden">
      <button
        onClick={() => onViewChange('map')}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer',
          viewMode === 'map'
            ? 'bg-orange-500 text-white'
            : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
        )}
        aria-label="Map view"
      >
        <Map className="w-4 h-4" />
        <span className="hidden sm:inline">Map</span>
      </button>
      <button
        onClick={() => onViewChange('list')}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer',
          viewMode === 'list'
            ? 'bg-orange-500 text-white'
            : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
        )}
        aria-label="List view"
      >
        <List className="w-4 h-4" />
        <span className="hidden sm:inline">List</span>
      </button>
    </div>
  );
}
