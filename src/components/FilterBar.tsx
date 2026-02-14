'use client';

import { useState, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { X, SlidersHorizontal, ChevronDown, Zap, Users } from 'lucide-react';
import type { FilterState } from '@/lib/types';
import { EVENT_DATES, VIBE_COLORS } from '@/lib/constants';
import { TAG_ICONS } from './TagBadge';
import { SearchBar } from './SearchBar';
import { trackConferenceSelect, trackTagToggle, trackDayRange, trackTimeRange, trackNowMode, trackClearFilters, trackFriendFilter } from '@/lib/analytics';

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
  friendsForFilter: Array<{ userId: string; displayName: string }>;
  selectedFriends: string[];
  onToggleFriend: (friendId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  eventCount: number;
}

/** Format an ISO date string to "Mon Feb 10" style label */
function formatDayLabel(isoDate: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(isoDate + 'T12:00:00');
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

/** Format a fractional hour (0-24 in 0.5 increments) to "12:00 AM" style */
function formatTimeLabel(fractionalHour: number): string {
  const h = Math.floor(fractionalHour) % 24;
  const m = fractionalHour % 1 === 0.5 ? '30' : '00';
  const period = h < 12 || h === 24 ? 'AM' : 'PM';
  const displayH = h === 0 || h === 24 ? 12 : h > 12 ? h - 12 : h;
  // Special case: value 24 means "12:00 AM" (end of day / midnight)
  if (fractionalHour === 24) return '12:00 AM';
  return `${displayH}:${m} ${period}`;
}

/** Generate time options: 0, 0.5, 1, ... 24 */
const TIME_OPTIONS: { value: number; label: string }[] = [];
for (let v = 0; v <= 24; v += 0.5) {
  TIME_OPTIONS.push({ value: v, label: formatTimeLabel(v) });
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
  friendsForFilter,
  selectedFriends,
  onToggleFriend,
  searchQuery,
  onSearchChange,
  eventCount,
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
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-3 space-y-3">
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
                          onClick={() => { trackConferenceSelect(conf); onSetConference(conf); setConfOpen(false); }}
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
                    onClick={() => { trackConferenceSelect(conf); onSetConference(conf); }}
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
            onClick={() => { trackNowMode(!filters.nowMode); onToggleNowMode(); }}
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

        {/* Search bar */}
        <SearchBar value={searchQuery} onChange={onSearchChange} eventCount={eventCount} />

        {/* Expandable filter content — overlays map on mobile */}
        {expanded && (
          <div className="space-y-3 pt-1 sm:relative absolute left-0 right-0 sm:bg-transparent bg-slate-900 sm:px-0 px-2 sm:pb-0 pb-4 sm:shadow-none shadow-lg shadow-black/40">
            {/* Now mode notice */}
            {filters.nowMode && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                <Zap className="w-4 h-4 shrink-0" />
                <span>Showing events happening now or starting within 1 hour. Day and time filters are overridden.</span>
              </div>
            )}

            {/* Day + Time range selectors — single row */}
            <div className={clsx('flex gap-4', filters.nowMode && 'opacity-30 pointer-events-none')}>
              {/* Days */}
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Days</div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={rangeStart}
                      onChange={(e) => {
                        const s = Number(e.target.value);
                        const end = Math.max(s, rangeEnd);
                        trackDayRange(EVENT_DATES[s], EVENT_DATES[end]);
                        onSetDayRange(s, end, EVENT_DATES);
                      }}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg text-white text-xs px-2 py-1.5 focus:border-orange-500 focus:outline-none appearance-none cursor-pointer pr-6"
                    >
                      {EVENT_DATES.map((date, i) => (
                        <option key={date} value={i}>{formatDayLabel(date)}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  </div>
                  <span className="text-slate-500 text-xs shrink-0">&mdash;</span>
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={rangeEnd}
                      onChange={(e) => {
                        const end = Number(e.target.value);
                        const start = Math.min(rangeStart, end);
                        trackDayRange(EVENT_DATES[start], EVENT_DATES[end]);
                        onSetDayRange(start, end, EVENT_DATES);
                      }}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg text-white text-xs px-2 py-1.5 focus:border-orange-500 focus:outline-none appearance-none cursor-pointer pr-6"
                    >
                      {EVENT_DATES.map((date, i) => (
                        <option key={date} value={i}>{formatDayLabel(date)}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  </div>
                </div>
              </div>

              {/* Time */}
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Time</div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={filters.timeStart}
                      onChange={(e) => {
                        const s = Number(e.target.value);
                        const end = Math.max(s, filters.timeEnd);
                        trackTimeRange(s, end);
                        onSetTimeRange(s, end);
                      }}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg text-white text-xs px-2 py-1.5 focus:border-orange-500 focus:outline-none appearance-none cursor-pointer pr-6"
                    >
                      {TIME_OPTIONS.filter((o) => o.value < 24).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  </div>
                  <span className="text-slate-500 text-xs shrink-0">&mdash;</span>
                  <div className="relative flex-1 min-w-0">
                    <select
                      value={filters.timeEnd}
                      onChange={(e) => {
                        const end = Number(e.target.value);
                        const start = Math.min(filters.timeStart, end);
                        trackTimeRange(start, end);
                        onSetTimeRange(start, end);
                      }}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg text-white text-xs px-2 py-1.5 focus:border-orange-500 focus:outline-none appearance-none cursor-pointer pr-6"
                    >
                      {TIME_OPTIONS.filter((o) => o.value > 0).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Friends filter */}
            {friendsForFilter.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Friends
                </div>
                <div className="overflow-x-auto flex gap-2 pb-1">
                  {friendsForFilter.map((friend) => {
                    const isActive = selectedFriends.includes(friend.userId);
                    return (
                      <button
                        key={friend.userId}
                        onClick={() => { trackFriendFilter(friend.displayName, !isActive); onToggleFriend(friend.userId); }}
                        className={clsx(
                          'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                          isActive
                            ? 'bg-blue-500 text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600 active:bg-slate-600'
                        )}
                      >
                        <Users className="w-3.5 h-3.5" />
                        {friend.displayName}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                        onClick={() => { trackTagToggle(vibe, !filters.vibes.includes(vibe)); onToggleVibe(vibe); }}
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
                        onClick={() => { trackTagToggle(vibe, !filters.vibes.includes(vibe)); onToggleVibe(vibe); }}
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
                  onClick={() => { trackClearFilters(); onClearFilters(); }}
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
