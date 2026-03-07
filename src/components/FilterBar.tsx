'use client';

import { useState, useRef } from 'react';
import clsx from 'clsx';
import { X, SlidersHorizontal, Zap, Users, MapPin, Plus, Link2, Check, Loader2 } from 'lucide-react';
import type { FilterState } from '@/lib/types';
import { VIBE_COLORS, getTabConfig } from '@/lib/constants';
import { TAG_ICONS } from './TagBadge';
import { SearchBar } from './SearchBar';
import { DateTimePicker } from './DateTimePicker';
import { trackConferenceSelect, trackDateTimeRange, trackTagToggle, trackNowMode, trackClearFilters, trackFriendFilter, trackFriendCodeGenerate, trackFriendCodeCopy } from '@/lib/analytics';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

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

  // Friend invite link state
  const { user } = useAuth();
  const [friendLinkCopied, setFriendLinkCopied] = useState(false);
  const [friendLinkLoading, setFriendLinkLoading] = useState(false);

  async function handleCopyFriendLink() {
    if (!user || friendLinkLoading) return;
    setFriendLinkLoading(true);

    try {
      // Try to fetch existing code
      const { data: existing } = await supabase
        .from('friend_codes')
        .select('code')
        .eq('user_id', user.id)
        .single();

      let code = existing?.code;

      if (!code) {
        // Generate a new code (8 char alphanumeric)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const arr = new Uint8Array(8);
        crypto.getRandomValues(arr);
        code = Array.from(arr, (b) => chars[b % chars.length]).join('');

        const { error } = await supabase
          .from('friend_codes')
          .insert({ user_id: user.id, code });

        if (error) {
          // Could be a race condition — try fetching again
          const { data: retry } = await supabase
            .from('friend_codes')
            .select('code')
            .eq('user_id', user.id)
            .single();
          code = retry?.code;
          if (!code) throw error;
        }

        trackFriendCodeGenerate();
      }

      const link = `${window.location.origin}?fc=${code}`;
      await navigator.clipboard.writeText(link);
      trackFriendCodeCopy();
      setFriendLinkCopied(true);
      setTimeout(() => setFriendLinkCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy friend link:', err);
    }

    setFriendLinkLoading(false);
  }

  return (
    <div className="relative bg-stone-950 border-b border-stone-800 z-30">
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
                    'flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white font-semibold cursor-pointer',
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
                      className="fixed z-[70] bg-stone-900 border border-stone-700 rounded-lg shadow-xl overflow-hidden min-w-[180px]"
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
                              ? 'bg-amber-500 text-white'
                              : 'text-stone-300 hover:bg-stone-800 active:bg-stone-800'
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
              <div className="hidden sm:flex rounded-lg border border-stone-700 overflow-hidden">
                {availableConferences.map((conf) => (
                  <button
                    key={conf}
                    onClick={() => { trackConferenceSelect(conf); onSetConference(conf); }}
                    className={clsx(
                      'px-4 py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap',
                      filters.conference === conf
                        ? 'bg-amber-500 text-white'
                        : 'bg-stone-900 text-stone-400 hover:text-stone-200 hover:bg-stone-800 active:text-stone-200 active:bg-stone-800'
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
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors cursor-pointer"
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
                : 'bg-stone-900 text-stone-400 hover:text-stone-200 hover:bg-stone-800 active:text-stone-200 active:bg-stone-800 border border-stone-700'
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
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'bg-stone-900 text-stone-400 hover:text-stone-200 hover:bg-stone-800 active:text-stone-200 active:bg-stone-800 border border-stone-700'
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
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
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors cursor-pointer"
              aria-label="Submit event"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Expandable filter content — overlays map on mobile */}
        {expanded && (
          <div className="space-y-3 pt-1 sm:relative absolute left-0 right-0 sm:bg-transparent bg-stone-950 sm:px-0 px-2 sm:pb-0 pb-4 sm:shadow-none shadow-lg shadow-black/40">
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
                    <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">Start</div>
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
                      <div className="text-xs uppercase tracking-wider text-stone-400 mb-1">Type</div>
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
                                  : 'bg-stone-800 text-stone-300 hover:bg-stone-700 active:bg-stone-700'
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
                    <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">End</div>
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
                      <div className="text-xs uppercase tracking-wider text-stone-400 mb-1">Tags</div>
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
                                  : 'bg-stone-800 text-stone-300 hover:bg-stone-700 active:bg-stone-700'
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
            <div>
              <div className="text-xs uppercase tracking-wider text-stone-400 mb-1">
                Friends
              </div>
              {friendsForFilter.length > 0 ? (
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
                            : 'bg-stone-800 text-stone-300 hover:bg-stone-700 active:bg-stone-700'
                        )}
                      >
                        <Users className="w-3.5 h-3.5" />
                        {friend.displayName}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-stone-700/50 rounded-lg p-4 flex items-center gap-3">
                  <Users className="w-5 h-5 text-stone-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-stone-400 text-sm">Invite friends to see their plans</p>
                  </div>
                  {user ? (
                    <button
                      onClick={handleCopyFriendLink}
                      disabled={friendLinkLoading}
                      className={clsx(
                        'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                        friendLinkCopied
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-orange-500 hover:bg-orange-600 text-white'
                      )}
                    >
                      {friendLinkCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Copied!
                        </>
                      ) : friendLinkLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Copying...
                        </>
                      ) : (
                        <>
                          <Link2 className="w-3.5 h-3.5" />
                          Copy invite link
                        </>
                      )}
                    </button>
                  ) : (
                    <span className="shrink-0 text-stone-500 text-sm">Sign in to invite</span>
                  )}
                </div>
              )}
            </div>

            {/* Clear all */}
            {activeFilterCount > 0 && (
              <div className="flex items-center">
                <button
                  onClick={() => { trackClearFilters(); onClearFilters(); }}
                  className="flex items-center gap-1.5 text-amber-400 hover:text-amber-300 active:text-amber-300 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer"
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
