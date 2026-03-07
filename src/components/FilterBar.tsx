'use client';

import { useState, useRef } from 'react';
import clsx from 'clsx';
import { X, SlidersHorizontal, Zap, Users, MapPin, Plus } from 'lucide-react';
import type { FilterState } from '@/lib/types';
import { VIBE_COLORS, getTabConfig } from '@/lib/constants';
import { TAG_ICONS } from './TagBadge';
import { SearchBar } from './SearchBar';
import { DateTimePicker } from './DateTimePicker';
import { trackConferenceSelect, trackDateTimeRange, trackTagToggle, trackNowMode, trackClearFilters, trackFriendFilter } from '@/lib/analytics';

interface FilterBarProps {
  filters: FilterState;
  onSetConference: (conf: string) => void;
  onSetDateTimeRange: (start: string, end: string) => void;
  onToggleVibe: (vibe: string) => void;
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
  onSubmitEvent?: () => void;
}

export function FilterBar({
  filters,
  onSetConference,
  onSetDateTimeRange,
  onToggleVibe,
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
  onSubmitEvent,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [confOpen, setConfOpen] = useState(false);
  const confBtnRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="relative bg-blue-950 border-b border-blue-800 z-30">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-3 space-y-3">
        {/* Top row: Conference tabs + Filter toggle */}
        <div className="flex items-center gap-3 lg:justify-center">
          {/* Conference selector — dropdown on mobile, inline tabs on desktop */}
          {availableConferences.length > 1 && (
            <>
              {/* Mobile: dropdown button */}
              <div className="sm:hidden shrink-0">
                <button
                  ref={(el) => { confBtnRef.current = el; }}
                  onClick={() => setConfOpen(!confOpen)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-2 rounded-lg bg-yellow-500 text-white font-semibold cursor-pointer',
                    (filters.conference || 'All').length > 12 ? 'text-xs' : 'text-sm'
                  )}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{filters.conference || 'All'}</span>
                </button>
                {confOpen && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setConfOpen(false)} />
                    <div
                      className="fixed z-[70] bg-blue-900 border border-blue-700 rounded-lg shadow-xl overflow-hidden min-w-[180px]"
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
                              ? 'bg-yellow-500 text-white'
                              : 'text-blue-300 hover:bg-blue-800 active:bg-blue-800'
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
              <div className="hidden sm:flex rounded-lg border border-blue-700 overflow-hidden">
                {availableConferences.map((conf) => (
                  <button
                    key={conf}
                    onClick={() => { trackConferenceSelect(conf); onSetConference(conf); }}
                    className={clsx(
                      'px-4 py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap',
                      filters.conference === conf
                        ? 'bg-yellow-500 text-white'
                        : 'bg-blue-900 text-blue-400 hover:text-blue-200 hover:bg-blue-800 active:text-blue-200 active:bg-blue-800'
                    )}
                  >
                    {conf}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Desktop: inline search bar between conference tabs and Now */}
          <div className="hidden md:flex items-center gap-2 flex-1">
            <SearchBar value={searchQuery} onChange={onSearchChange} eventCount={eventCount} />
            {onSubmitEvent && (
              <button
                onClick={onSubmitEvent}
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors cursor-pointer"
                aria-label="Submit event"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Spacer pushes Now + Filters to the right */}
          <div className="flex-1 md:hidden" />

          {/* Now toggle button */}
          <button
            onClick={() => { trackNowMode(!filters.nowMode); onToggleNowMode(); }}
            className={clsx(
              'shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer',
              filters.nowMode
                ? 'bg-green-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]'
                : 'bg-blue-900 text-blue-400 hover:text-blue-200 hover:bg-blue-800 active:text-blue-200 active:bg-blue-800 border border-blue-700'
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
              'shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer',
              expanded || activeFilterCount > 0
                ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                : 'bg-blue-900 text-blue-400 hover:text-blue-200 hover:bg-blue-800 active:text-blue-200 active:bg-blue-800 border border-blue-700'
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-yellow-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Search bar — mobile only (desktop is inline in the row above) */}
        <div className="md:hidden flex items-center gap-2">
          <SearchBar value={searchQuery} onChange={onSearchChange} eventCount={eventCount} />
          {onSubmitEvent && (
            <button
              onClick={onSubmitEvent}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white transition-colors cursor-pointer"
              aria-label="Submit event"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Expandable filter content — overlays map on mobile */}
        {expanded && (
          <div className="space-y-3 pt-1 sm:relative absolute left-0 right-0 sm:bg-transparent bg-blue-950 sm:px-0 px-2 sm:pb-0 pb-4 sm:shadow-none shadow-lg shadow-black/40">
            {/* Now mode notice */}
            {filters.nowMode && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                <Zap className="w-4 h-4 shrink-0" />
                <span>Showing events happening now or starting within 1 hour. Day and time filters are overridden.</span>
              </div>
            )}

            {/* Start + Type row */}
            {(() => {
              const tabDates = getTabConfig(filters.conference).dates;
              return (
                <div className={clsx('flex gap-3 items-end', filters.nowMode && 'opacity-30 pointer-events-none')}>
                  <div className="w-40 shrink-0">
                    <div className="text-xs uppercase tracking-wider text-blue-400 mb-2">Start</div>
                    <DateTimePicker
                      value={filters.startDateTime}
                      min={`${tabDates[0]}T00:00`}
                      max={filters.endDateTime}
                      dates={tabDates}
                      onChange={(v) => {
                        trackDateTimeRange(v, filters.endDateTime);
                        onSetDateTimeRange(v, filters.endDateTime);
                      }}
                    />
                  </div>
                  {(availableTypes.length > 0) && (
                    <div className="flex-1 min-w-0">
                      <div className="text-xs uppercase tracking-wider text-blue-400 mb-1">Type</div>
                      <div className="overflow-x-auto flex gap-2 pb-1">
                        {availableTypes.map((vibe) => {
                          const isActive = filters.vibes.includes(vibe);
                          const vibeColor = VIBE_COLORS[vibe] || VIBE_COLORS['default'];
                          const Icon = TAG_ICONS[vibe];
                          return (
                            <button
                              key={vibe}
                              onClick={() => { trackTagToggle(vibe, !filters.vibes.includes(vibe)); onToggleVibe(vibe); }}
                              className={clsx(
                                'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                                isActive
                                  ? 'text-white'
                                  : 'bg-blue-800 text-blue-300 hover:bg-blue-700 active:bg-blue-700'
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
                </div>
              );
            })()}

            {/* End + Tags row */}
            {(() => {
              const tabDates = getTabConfig(filters.conference).dates;
              return (
                <div className={clsx('flex gap-3 items-end', filters.nowMode && 'opacity-30 pointer-events-none')}>
                  <div className="w-40 shrink-0">
                    <div className="text-xs uppercase tracking-wider text-blue-400 mb-2">End</div>
                    <DateTimePicker
                      value={filters.endDateTime}
                      min={filters.startDateTime}
                      max={`${tabDates[tabDates.length - 1]}T23:30`}
                      dates={tabDates}
                      onChange={(v) => {
                        trackDateTimeRange(filters.startDateTime, v);
                        onSetDateTimeRange(filters.startDateTime, v);
                      }}
                    />
                  </div>
                  {availableVibes.length > 0 && (
                    <div className="flex-1 min-w-0">
                      <div className="text-xs uppercase tracking-wider text-blue-400 mb-1">Tags</div>
                      <div className="overflow-x-auto flex gap-2 pb-1">
                        {availableVibes.map((vibe) => {
                          const isActive = filters.vibes.includes(vibe);
                          const vibeColor = VIBE_COLORS[vibe] || VIBE_COLORS['default'];
                          const Icon = TAG_ICONS[vibe];
                          return (
                            <button
                              key={vibe}
                              onClick={() => { trackTagToggle(vibe, !filters.vibes.includes(vibe)); onToggleVibe(vibe); }}
                              className={clsx(
                                'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                                isActive
                                  ? 'text-white'
                                  : 'bg-blue-800 text-blue-300 hover:bg-blue-700 active:bg-blue-700'
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
                </div>
              );
            })()}

            {/* Friends filter */}
            {friendsForFilter.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-blue-400 mb-1">
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
                            : 'bg-blue-800 text-blue-300 hover:bg-blue-700 active:bg-blue-700'
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

            {/* Clear all */}
            {activeFilterCount > 0 && (
              <div className="flex items-center">
                <button
                  onClick={() => { trackClearFilters(); onClearFilters(); }}
                  className="flex items-center gap-1.5 text-yellow-400 hover:text-yellow-300 active:text-yellow-300 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer"
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
