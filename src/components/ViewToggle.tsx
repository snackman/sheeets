'use client';

import { Map, List, Table, LayoutGrid } from 'lucide-react';
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
  { mode: 'gallery', icon: LayoutGrid, label: 'Gallery' },
];

export function ViewToggle({ viewMode, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex rounded-lg border border-[var(--theme-header-control-border)] overflow-hidden">
      {views.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          onClick={() => { trackViewChange(mode); onViewChange(mode); }}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer',
            viewMode === mode
              ? 'text-[var(--theme-header-accent)]'
              : 'text-[var(--theme-header-text)] hover:text-[var(--theme-header-text-hover)] active:text-[var(--theme-header-text-hover)]'
          )}
          style={viewMode === mode
            ? { backgroundColor: 'var(--theme-header-accent-muted)' }
            : { backgroundColor: 'var(--theme-header-control-bg)' }}
          aria-label={`${label} view`}
        >
          <Icon className="w-4 h-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
