'use client';

import { useState, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { X, SlidersHorizontal, ChevronDown, Zap } from 'lucide-react';
import type { FilterState } from '@/lib/types';
import { EVENT_DATES, VIBE_COLORS } from '@/lib/constants';
import { TAG_ICONS } from './TagBadge';

interface FilterBarProps {
  filters: FilterState;
  onSetConference: (conf: string) => void;
  onSetDayRange: (startIdx: number, endIdx: number, allDates: string[]) => void;
  onToggleVibe: (vibe: string) => void;
  onSetTimeRange: (start: number, end: number) => void;
  onToggleNowMode: () => void;
  onClearFilters: () => void;
  activeFilterCount: number;
  availableConferences: string[];
  availableTypes: string[];
  availableVibes: string[];
}

/** Format an ISO date string to "Mon Feb 10" style label */
function formatDayLabel(isoDate: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(isoDate + 'T12:00:00');
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

export function FilterBar({
  filters,
  onSetConference,
  onSetDayRange,
  onToggleVibe,
  onSetTimeRange,
  onToggleNowMode,
  onClearFilters,
  activeFilterCount,
  availableConferences,
  availableTypes,
  availableVibes,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [confOpen, setConfOpen] = useState(false);
  const confBtnRef = useRef<HTMLButtonElement | null>(null);
  const maxIdx = EVENT_DATES.length - 1;

  const rangeStart = useMemo(() => {
    if (filters.selectedDays.length === 0) return 0;
    const indices = filters.selectedDays.map((d) => EVENT_DATES.indexOf(d)).filter((i) => i >= 0);
    return Math.min(...indices);
  }, [filters.selectedDays]);

  const rangeEnd = useMemo(() => {
    if (filters.selectedDays.length === 0) return maxIdx;
    const indices = filters.selectedDays.map((d) => EVENT_DATES.indexOf(d)).filter((i) => i >= 0);
    return Math.max(...indices);
  }, [filters.selectedDays, maxIdx]);

  return (
    <div className="relative bg-slate-900 border-b border-slate-800 z-30">
      <div className="max-w-7xl mx-auto px-4 py-3 space-y-3">
        {/* Top row: Conference tabs + Filter toggle */}
        <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
          {/* Conference selector — dropdown on mobile, inline tabs on desktop */}
          {availableConferences.length > 1 && (
            <>
              {/* Mobile: dropdown button */}
              <div className="sm:hidden shrink-0">
                <button
                  ref={(el) => { confBtnRef.current = el; }}
                  onClick={() => setConfOpen(!confOpen)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold cursor-pointer max-w-[120px]"
                >
                  <span className="truncate">{filters.conference || 'All'}</span>
                  <ChevronDown className={clsx('w-3.5 h-3.5 shrink-0 transition-transform', confOpen && 'rotate-180')} />
                </button>
                {confOpen && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setConfOpen(false)} />
                    <div
                      className="fixed z-[70] bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden min-w-[180px]"
                      style={{
                        top: confBtnRef.current ? confBtnRef.current.getBoundingClientRect().bottom + 4 : 0,
                        left: confBtnRef.current ? confBtnRef.current.getBoundingClientRect().left : 16,
                      }}
                    >
                      {availableConferences.map((conf) => (
                        <button
                          key={conf}
                          onClick={() => { onSetConference(conf); setConfOpen(false); }}
                          className={clsx(
                            'w-full text-left px-4 py-3 text-sm font-semibold transition-colors cursor-pointer',
                            filters.conference === conf
                              ? 'bg-orange-500 text-white'
                              : 'text-slate-300 hover:bg-slate-700 active:bg-slate-700'
                          )}
                        >
                          {conf}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Desktop: inline tabs */}
              <div className="hidden sm:flex rounded-lg border border-slate-700 overflow-hidden">
                {availableConferences.map((conf) => (
                  <button
                    key={conf}
                    onClick={() => onSetConference(conf)}
                    className={clsx(
                      'px-4 py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap',
                      filters.conference === conf
                        ? 'bg-orange-500 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700'
                    )}
                  >
                    {conf}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Now toggle button */}
          <button
            onClick={onToggleNowMode}
            className={clsx(
              'shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer',
              filters.nowMode
                ? 'bg-green-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700 border border-slate-700'
            )}
          >
            <span className="relative flex items-center">
              <Zap className="w-4 h-4" />
              {filters.nowMode && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-300 rounded-full animate-ping" />
              )}
            </span>
            Now
          </button>

          {/* Filter toggle button */}
          <button
            onClick={() => setExpanded(!expanded)}
            className={clsx(
              'shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ml-auto',
              expanded || activeFilterCount > 0
                ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700 border border-slate-700'
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-orange-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>

        {/* Expandable filter content — overlays map on mobile */}
        {expanded && (
          <div className="space-y-3 pt-1 sm:relative absolute left-0 right-0 sm:bg-transparent bg-slate-900 sm:px-0 px-4 sm:pb-0 pb-4 sm:shadow-none shadow-lg shadow-black/40">
            {/* Now mode notice */}
            {filters.nowMode && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                <Zap className="w-4 h-4 shrink-0" />
                <span>Showing events happening now or starting within 1 hour. Day and time filters are overridden.</span>
              </div>
            )}

            {/* Day range slider */}
            <div className={clsx(filters.nowMode && 'opacity-30 pointer-events-none')}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-slate-400">
                  Days
                </div>
                <div className="text-sm text-slate-300 font-medium">
                  {rangeStart === 0 && rangeEnd === maxIdx
                    ? `${formatDayLabel(EVENT_DATES[0])} — ${formatDayLabel(EVENT_DATES[maxIdx])}`
                    : rangeStart === rangeEnd
                    ? formatDayLabel(EVENT_DATES[rangeStart])
                    : `${formatDayLabel(EVENT_DATES[rangeStart])} — ${formatDayLabel(EVENT_DATES[rangeEnd])}`}
                </div>
              </div>
              <div className="relative h-8 flex items-center">
                <div className="absolute w-full h-1.5 bg-slate-700 rounded-full" />
                <div
                  className="absolute h-1.5 bg-orange-500 rounded-full"
                  style={{
                    left: `${(rangeStart / maxIdx) * 100}%`,
                    right: `${100 - (rangeEnd / maxIdx) * 100}%`,
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={maxIdx}
                  value={rangeStart}
                  onChange={(e) => {
                    const v = Math.min(Number(e.target.value), rangeEnd);
                    onSetDayRange(v, rangeEnd, EVENT_DATES);
                  }}
                  className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                />
                <input
                  type="range"
                  min={0}
                  max={maxIdx}
                  value={rangeEnd}
                  onChange={(e) => {
                    const v = Math.max(Number(e.target.value), rangeStart);
                    onSetDayRange(rangeStart, v, EVENT_DATES);
                  }}
                  className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                />
              </div>
            </div>

            {/* Time slider */}
            {(() => {
              const formatHour = (h: number) => {
                const hr = h % 24;
                if (hr === 0) return '12am';
                if (hr === 12) return '12pm';
                return hr < 12 ? `${hr}am` : `${hr - 12}pm`;
              };

              const tStart = filters.timeStart;
              const tEnd = filters.timeEnd;
              const timeLabel = (tStart === 0 && tEnd === 24)
                ? `${formatHour(0)} — ${formatHour(0)}`
                : `${formatHour(tStart)} — ${formatHour(tEnd)}`;

              return (
                <div className={clsx(filters.nowMode && 'opacity-30 pointer-events-none')}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-wider text-slate-400">
                      Time
                    </div>
                    <div className="text-sm text-slate-300 font-medium">
                      {timeLabel}
                    </div>
                  </div>
                  <div className="relative h-8 flex items-center">
                    <div className="absolute w-full h-1.5 bg-slate-700 rounded-full" />
                    <div
                      className="absolute h-1.5 bg-blue-500 rounded-full"
                      style={{
                        left: `${(tStart / 24) * 100}%`,
                        right: `${100 - (tEnd / 24) * 100}%`,
                      }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={24}
                      value={tStart}
                      onChange={(e) => {
                        const v = Math.min(Number(e.target.value), tEnd);
                        onSetTimeRange(v, tEnd);
                      }}
                      className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                    />
                    <input
                      type="range"
                      min={0}
                      max={24}
                      value={tEnd}
                      onChange={(e) => {
                        const v = Math.max(Number(e.target.value), tStart);
                        onSetTimeRange(tStart, v);
                      }}
                      className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                    />
                  </div>
                </div>
              );
            })()}

            {/* Types (event format) + quick filters */}
            {(availableTypes.length > 0 || true) && (
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Type
                </div>
                <div className="overflow-x-auto flex gap-2 pb-1">
                  {availableTypes.map((vibe) => {
                    const isActive = filters.vibes.includes(vibe);
                    const vibeColor =
                      VIBE_COLORS[vibe] || VIBE_COLORS['default'];
                    const Icon = TAG_ICONS[vibe];
                    return (
                      <button
                        key={vibe}
                        onClick={() => onToggleVibe(vibe)}
                        className={clsx(
                          'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                          isActive
                            ? 'text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600 active:bg-slate-600'
                        )}
                        style={isActive ? { backgroundColor: vibeColor } : undefined}
                      >
                        {Icon && <Icon className="w-3.5 h-3.5" />}
                        {vibe}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tags (topics/interests) */}
            {availableVibes.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Tags
                </div>
                <div className="overflow-x-auto flex gap-2 pb-1">
                  {availableVibes.map((vibe) => {
                    const isActive = filters.vibes.includes(vibe);
                    const vibeColor =
                      VIBE_COLORS[vibe] || VIBE_COLORS['default'];
                    const Icon = TAG_ICONS[vibe];
                    return (
                      <button
                        key={vibe}
                        onClick={() => onToggleVibe(vibe)}
                        className={clsx(
                          'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                          isActive
                            ? 'text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600 active:bg-slate-600'
                        )}
                        style={isActive ? { backgroundColor: vibeColor } : undefined}
                      >
                        {Icon && <Icon className="w-3.5 h-3.5" />}
                        {vibe}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Clear all */}
            {activeFilterCount > 0 && (
              <div className="flex items-center">
                <button
                  onClick={onClearFilters}
                  className="flex items-center gap-1.5 text-orange-400 hover:text-orange-300 active:text-orange-300 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
