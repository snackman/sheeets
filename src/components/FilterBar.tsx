'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import type { FilterState } from '@/lib/types';
import { EVENT_DATES, VIBE_COLORS, TIME_RANGES } from '@/lib/constants';
import { SearchBar } from './SearchBar';

interface FilterBarProps {
  filters: FilterState;
  onToggleDay: (day: string) => void;
  onToggleVibe: (vibe: string) => void;
  onToggleTimeOfDay: (time: string) => void;
  onToggleBool: (key: 'freeOnly' | 'hasFood' | 'hasBar') => void;
  onSearchChange: (query: string) => void;
  onClearFilters: () => void;
  activeFilterCount: number;
  totalEvents: number;
  filteredCount: number;
  availableVibes: string[];
}

/** Format an ISO date string to "Thu 20" style label */
function formatDayPill(isoDate: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = new Date(isoDate + 'T12:00:00');
  const dayName = days[d.getDay()];
  const dateNum = d.getDate();
  return `${dayName} ${dateNum}`;
}

/** Time of day options with labels */
const TIME_OPTIONS: { key: string; label: string }[] = [
  { key: 'morning', label: TIME_RANGES.morning.label },
  { key: 'afternoon', label: TIME_RANGES.afternoon.label },
  { key: 'evening', label: TIME_RANGES.evening.label },
  { key: 'night', label: TIME_RANGES.night.label },
  { key: 'all-day', label: 'All Day' },
];

export function FilterBar({
  filters,
  onToggleDay,
  onToggleVibe,
  onToggleTimeOfDay,
  onToggleBool,
  onSearchChange,
  onClearFilters,
  activeFilterCount,
  totalEvents,
  filteredCount,
  availableVibes,
}: FilterBarProps) {
  /** Day pills data, computed once */
  const dayPills = useMemo(
    () =>
      EVENT_DATES.map((iso) => ({
        iso,
        label: formatDayPill(iso),
      })),
    []
  );

  return (
    <div className="bg-slate-900 border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 py-3 space-y-3">
        {/* Row 1: Search + Clear */}
        <div className="flex items-center gap-3">
          <SearchBar value={filters.searchQuery} onChange={onSearchChange} />
          {activeFilterCount > 0 && (
            <button
              onClick={onClearFilters}
              className="flex items-center gap-1.5 text-orange-400 hover:text-orange-300 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Clear
              <span className="bg-orange-500/20 text-orange-400 text-xs font-bold px-1.5 py-0.5 rounded-full">
                {activeFilterCount}
              </span>
            </button>
          )}
        </div>

        {/* Row 2: Day picker */}
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
            Days
          </div>
          <div className="overflow-x-auto flex gap-2 pb-1 scrollbar-hide">
            {dayPills.map(({ iso, label }) => {
              const isActive = filters.selectedDays.includes(iso);
              return (
                <button
                  key={iso}
                  onClick={() => onToggleDay(iso)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                    isActive
                      ? 'bg-orange-500 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 3: Time of day */}
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
            Time
          </div>
          <div className="overflow-x-auto flex gap-2 pb-1 scrollbar-hide">
            {TIME_OPTIONS.map(({ key, label }) => {
              const isActive = filters.timeOfDay.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => onToggleTimeOfDay(key)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                    isActive
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 4: Vibes */}
        {availableVibes.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
              Vibe
            </div>
            <div className="overflow-x-auto flex gap-2 pb-1 scrollbar-hide">
              {availableVibes.map((vibe) => {
                const isActive = filters.vibes.includes(vibe);
                const vibeColor =
                  VIBE_COLORS[vibe] || VIBE_COLORS['default'];
                return (
                  <button
                    key={vibe}
                    onClick={() => onToggleVibe(vibe)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                      isActive
                        ? 'text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    )}
                    style={isActive ? { backgroundColor: vibeColor } : undefined}
                  >
                    {vibe}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 5: Quick filters + event count */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => onToggleBool('freeOnly')}
              className={clsx(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer',
                filters.freeOnly
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              )}
            >
              FREE
            </button>
            <button
              onClick={() => onToggleBool('hasFood')}
              className={clsx(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer',
                filters.hasFood
                  ? 'bg-amber-500 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              )}
            >
              <span role="img" aria-label="Food">
                🍕
              </span>{' '}
              Food
            </button>
            <button
              onClick={() => onToggleBool('hasBar')}
              className={clsx(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer',
                filters.hasBar
                  ? 'bg-amber-500 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              )}
            >
              <span role="img" aria-label="Bar">
                🍺
              </span>{' '}
              Bar
            </button>
          </div>

          <p className="text-sm text-slate-400 whitespace-nowrap">
            Showing{' '}
            <span className="text-white font-medium">{filteredCount}</span> of{' '}
            {totalEvents} events
          </p>
        </div>
      </div>
    </div>
  );
}
