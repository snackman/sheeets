'use client';

import { memo, useState, useRef } from 'react';
import clsx from 'clsx';
import { X, ListFilter, Clock, Users, MapPin, Plus, Link2, Check, Loader2, ChevronDown } from 'lucide-react';
import { CalendarIcon } from './icons/CalendarIcon';
import type { FilterState } from '@/lib/types';
import { VIBE_COLORS, getTabConfig, TAG_GROUPS, GROUPED_TAGS } from '@/lib/constants';
import type { TabConfig } from '@/lib/conferences';
import { TAG_ICONS } from './TagBadge';
import { SearchBar } from './SearchBar';
import { DateTimePicker } from './DateTimePicker';
import UserAvatar from './UserAvatar';
import { trackConferenceSelect, trackDateTimeRange, trackTagToggle, trackNowMode, trackClearFilters, trackFriendFilter, trackFriendCodeGenerate, trackFriendCodeCopy } from '@/lib/analytics';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface FilterBarProps {
  filters: FilterState;
  onSetConference: (conf: string) => void;
  onSetDateTimeRange: (start: string, end: string) => void;
  onToggleVibe: (vibe: string) => void;
  onToggleNowMode: () => void;
  onToggleTagMatchAll: () => void;
  onClearFilters: () => void;
  activeFilterCount: number;
  availableConferences: string[];
  availableTypes: string[];
  availableVibes: string[];
  tagCounts: Map<string, number>;
  friendsForFilter: Array<{ userId: string; displayName: string; avatarUrl?: string | null; xHandle?: string | null }>;
  selectedFriends: string[];
  onToggleFriend: (friendId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  eventCount: number;
  onSubmitEvent?: () => void;
  onSignIn?: () => void;
  conferenceTabs?: TabConfig[];
  itineraryCount: number;
  onItineraryToggle: () => void;
  isItineraryActive: boolean;
}

export const FilterBar = memo(function FilterBar({
  filters,
  onSetConference,
  onSetDateTimeRange,
  onToggleVibe,
  onToggleNowMode,
  onToggleTagMatchAll,
  onClearFilters,
  activeFilterCount,
  availableConferences,
  availableTypes,
  availableVibes,
  tagCounts,
  friendsForFilter,
  selectedFriends,
  onToggleFriend,
  searchQuery,
  onSearchChange,
  eventCount,
  onSubmitEvent,
  onSignIn,
  conferenceTabs,
  itineraryCount,
  onItineraryToggle,
  isItineraryActive,
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
    <div className="relative bg-[var(--theme-bg-filter)] border-b border-[var(--theme-border-secondary)] z-30">
      <div className="px-2 sm:px-4 pt-3.5 pb-2 space-y-3">
        {/* Top row: Conference tabs + Filter toggle */}
        <div className="flex items-center gap-1.5 sm:gap-3 lg:justify-center">
          {/* Conference selector — dropdown on all screen sizes */}
          {availableConferences.length > 0 && (
            <div className="shrink-0">
              <button
                ref={(el) => { confBtnRef.current = el; }}
                onClick={() => setConfOpen(!confOpen)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 h-9 rounded-lg font-semibold cursor-pointer transition-colors border',
                  confOpen
                    ? 'text-[var(--theme-filter-active)] border-[var(--theme-filter-active)]'
                    : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)] border-[var(--theme-filter-control-border)]',
                  (filters.conference || 'All').length > 12 ? 'text-xs' : 'text-sm'
                )}
                style={confOpen ? { backgroundColor: 'var(--theme-filter-active-bg)' } : undefined}
              >
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">{filters.conference || 'All'}</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              </button>
              {confOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setConfOpen(false)} />
                  <div
                    className="fixed z-[70] bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg shadow-xl overflow-hidden min-w-[180px]"
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
                            ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                            : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:bg-[var(--theme-bg-tertiary)]'
                        )}
                      >
                        {conf}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Desktop: inline search bar between conference dropdown and Now */}
          <div className="hidden md:flex items-center gap-2 flex-1">
            <SearchBar value={searchQuery} onChange={onSearchChange} eventCount={eventCount} />
            {onSubmitEvent && (
              <button
                onClick={onSubmitEvent}
                className="shrink-0 h-9 flex items-center justify-center rounded-lg bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)] border border-[var(--theme-filter-control-border)] transition-colors cursor-pointer px-2 xl:px-3 gap-1.5"
                aria-label="Submit event"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden xl:inline text-sm font-medium">Add Event</span>
              </button>
            )}
          </div>

          {/* Spacer pushes Now + Filters to the right */}
          <div className="flex-1 lg:hidden" />

          {/* Now toggle button */}
          <button
            onClick={() => { trackNowMode(!filters.nowMode); onToggleNowMode(); }}
            aria-label="Now"
            className={clsx(
              'shrink-0 flex items-center gap-1 px-2.5 h-9 rounded-lg text-sm font-semibold transition-colors cursor-pointer',
              filters.nowMode
                ? 'text-[var(--theme-filter-active)] border border-[var(--theme-filter-active)]'
                : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)] border border-[var(--theme-filter-control-border)]'
            )}
            style={filters.nowMode ? { backgroundColor: 'var(--theme-filter-active-bg)' } : undefined}
          >
            <Clock className="w-4 h-4" />
          </button>

          {/* Filter toggle button */}
          <button
            onClick={() => setExpanded(!expanded)}
            aria-label="Filters"
            className={clsx(
              'shrink-0 flex items-center gap-1 px-2.5 h-9 rounded-lg text-sm font-medium transition-colors cursor-pointer',
              expanded
                ? 'text-[var(--theme-filter-active)] border border-[var(--theme-filter-active)]'
                : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)] border border-[var(--theme-filter-control-border)]'
            )}
            style={expanded ? { backgroundColor: 'var(--theme-filter-active-bg)' } : undefined}
          >
            <ListFilter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className={clsx(
                'text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1',
                expanded
                  ? 'bg-[var(--theme-filter-active)] text-[var(--theme-bg-filter)] border border-[var(--theme-filter-active)]'
                  : 'bg-[var(--theme-filter-badge-bg)] text-[var(--theme-filter-badge-text)] border border-[var(--theme-filter-badge-border)]'
              )}>
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Itinerary toggle */}
          <button
            onClick={onItineraryToggle}
            aria-label={`Itinerary: ${itineraryCount} events`}
            className={clsx(
              'shrink-0 flex items-center gap-1 px-2.5 h-9 rounded-lg text-sm font-medium transition-colors cursor-pointer',
              isItineraryActive
                ? 'text-[var(--theme-filter-active)] border border-[var(--theme-filter-active)]'
                : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)] border border-[var(--theme-filter-control-border)]'
            )}
            style={isItineraryActive ? { backgroundColor: 'var(--theme-filter-active-bg)' } : undefined}
          >
            <CalendarIcon className="w-5 h-5" />
            {itineraryCount > 0 && (
              <span className={clsx(
                'text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1',
                isItineraryActive
                  ? 'bg-[var(--theme-filter-active)] text-[var(--theme-bg-filter)] border border-[var(--theme-filter-active)]'
                  : 'bg-[var(--theme-text-secondary)] text-[var(--theme-bg-primary)]'
              )}>
                {itineraryCount}
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
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)] border border-[var(--theme-filter-control-border)] transition-colors cursor-pointer"
              aria-label="Submit event"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Expandable filter content — overlays map on mobile */}
        {expanded && (
          <div className="space-y-3 pt-1 sm:relative absolute left-0 right-0 sm:bg-transparent bg-[var(--theme-bg-primary)] sm:px-0 px-2 sm:pb-0 pb-4 sm:shadow-none shadow-lg shadow-black/40 sm:max-h-none max-h-[70vh] overflow-y-auto">
            {/* Now mode notice */}
            {filters.nowMode && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                <Clock className="w-4 h-4 shrink-0" />
                <span>Showing events happening now or starting within 1 hour. Start/end filters are overridden.</span>
              </div>
            )}

            {/* Date pickers row */}
            {(() => {
              const tabDates = getTabConfig(filters.conference, conferenceTabs).dates;
              return (
                <div className={clsx('flex gap-3 items-end', filters.nowMode && 'opacity-30 pointer-events-none')}>
                  <div className="w-40 shrink-0">
                    <div className="text-xs uppercase tracking-wider text-[var(--theme-filter-text)] mb-2">Start</div>
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
                  <div className="w-40 shrink-0">
                    <div className="text-xs uppercase tracking-wider text-[var(--theme-filter-text)] mb-2">End</div>
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
                </div>
              );
            })()}

            {/* Tag match mode toggle + Tag groups */}
            {(() => {
              // Union all available tags from both types and vibes
              const allAvailable = new Set([...availableTypes, ...availableVibes]);

              // Render each TAG_GROUP that has at least one available tag with count > 0
              const groupRows = TAG_GROUPS.map((group) => {
                const groupTags = group.tags.filter(
                  (tag) => allAvailable.has(tag) && (tagCounts.get(tag) ?? 0) > 0
                );
                if (groupTags.length === 0) return null;
                return (
                  <div key={group.label}>
                    <div className="text-xs uppercase tracking-wider text-[var(--theme-filter-text)] mb-1">{group.label}</div>
                    <div className="flex flex-wrap gap-2">
                      {groupTags.map((vibe) => {
                        const isActive = filters.vibes.includes(vibe);
                        const vibeColor = VIBE_COLORS[vibe] || VIBE_COLORS['default'];
                        const Icon = TAG_ICONS[vibe];
                        const count = tagCounts.get(vibe) ?? 0;
                        return (
                          <button
                            key={vibe}
                            onClick={() => { trackTagToggle(vibe, !filters.vibes.includes(vibe)); onToggleVibe(vibe); }}
                            className={clsx(
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                              isActive
                                ? 'bg-[var(--theme-filter-active-bg)] border'
                                : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:bg-[var(--theme-filter-control-border)] active:bg-[var(--theme-filter-control-border)] border border-[var(--theme-filter-control-border)]'
                            )}
                            style={isActive ? { borderColor: vibeColor, color: vibeColor } : undefined}
                          >
                            {Icon && <Icon className="w-3.5 h-3.5" />}
                            {vibe}
                            <span className={clsx('text-xs', isActive ? 'opacity-70' : 'opacity-60')}>
                              ({count})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });

              // "Other" catch-all for tags not in any TAG_GROUP
              const otherTags = [...allAvailable].filter(
                (tag) => !GROUPED_TAGS.has(tag) && (tagCounts.get(tag) ?? 0) > 0
              );

              return (
                <>
                  {/* Any/All toggle — only show when tags are selected */}
                  {filters.vibes.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--theme-filter-text)]">Match</span>
                      <button
                        onClick={onToggleTagMatchAll}
                        className={clsx(
                          'px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer',
                          !filters.tagMatchAll
                            ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                            : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)]'
                        )}
                      >
                        Any
                      </button>
                      <button
                        onClick={onToggleTagMatchAll}
                        className={clsx(
                          'px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer',
                          filters.tagMatchAll
                            ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                            : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)]'
                        )}
                      >
                        All
                      </button>
                    </div>
                  )}
                  {groupRows}
                  {otherTags.length > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wider text-[var(--theme-filter-text)] mb-1">Other</div>
                      <div className="flex flex-wrap gap-2">
                        {otherTags.map((vibe) => {
                          const isActive = filters.vibes.includes(vibe);
                          const vibeColor = VIBE_COLORS[vibe] || VIBE_COLORS['default'];
                          const Icon = TAG_ICONS[vibe];
                          const count = tagCounts.get(vibe) ?? 0;
                          return (
                            <button
                              key={vibe}
                              onClick={() => { trackTagToggle(vibe, !filters.vibes.includes(vibe)); onToggleVibe(vibe); }}
                              className={clsx(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap cursor-pointer',
                                isActive
                                  ? 'bg-[var(--theme-filter-active-bg)] border'
                                  : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:bg-[var(--theme-filter-control-border)] active:bg-[var(--theme-filter-control-border)] border border-[var(--theme-filter-control-border)]'
                              )}
                              style={isActive ? { borderColor: vibeColor, color: vibeColor } : undefined}
                            >
                              {Icon && <Icon className="w-3.5 h-3.5" />}
                              {vibe}
                              <span className={clsx('text-xs', isActive ? 'opacity-70' : 'opacity-60')}>
                                ({count})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Friends filter */}
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--theme-filter-text)] mb-1">
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
                            ? 'text-white'
                            : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:bg-[var(--theme-filter-control-border)] active:bg-[var(--theme-filter-control-border)]'
                        )}
                        style={isActive ? { backgroundColor: 'var(--friend-blue)' } : undefined}
                      >
                        <div className="w-5 h-5 rounded-full overflow-hidden shrink-0">
                          <UserAvatar
                            avatarUrl={friend.avatarUrl}
                            xHandle={friend.xHandle}
                            displayName={friend.displayName}
                            userId={friend.userId}
                            size="xs"
                            className="!w-full !h-full"
                          />
                        </div>
                        {friend.displayName}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div
                  className={clsx('bg-[var(--theme-filter-control-bg)] rounded-lg p-4 flex items-center gap-3 border border-[var(--theme-filter-control-border)]', !user && 'cursor-pointer hover:bg-[var(--theme-filter-control-border)] transition-colors')}
                >
                  <Users className="w-5 h-5 text-[var(--theme-filter-text)] shrink-0" />
                  <div className="flex-1 min-w-0" onClick={!user ? onSignIn : undefined}>
                    <p className="text-[var(--theme-filter-text)] text-sm">{user ? 'Add friends to see their plans' : 'Sign in to add friends'}</p>
                  </div>
                  {user && (
                    <button
                      onClick={handleCopyFriendLink}
                      disabled={friendLinkLoading}
                      className={clsx(
                        'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer',
                        friendLinkCopied
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-filter-active)] border border-[var(--theme-filter-control-border)]'
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
                          Copy friend link
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Clear all */}
            {activeFilterCount > 0 && (
              <div className="flex items-center">
                <button
                  onClick={() => { trackClearFilters(); onClearFilters(); }}
                  className="flex items-center gap-1.5 text-[var(--theme-filter-active)] hover:opacity-80 active:opacity-80 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer"
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
});
