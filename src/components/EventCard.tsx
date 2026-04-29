'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Calendar, Users, X, Link, Check, MapPinCheck, Loader2 } from 'lucide-react';
import type { ETHDenverEvent, ReactionEmoji } from '@/lib/types';
import { trackEventClick, trackCopyEventLink, trackFriendsGoingOpen, trackFriendsCheckedInOpen } from '@/lib/analytics';
import { trackAdEvent } from '@/lib/ad-tracking';
import { trackEvent } from '@/lib/event-tracking';
import { formatFriendsText } from '@/lib/user-display';
import { AddressLink } from './AddressLink';
import { StarButton } from './StarButton';
import { TagBadge } from './TagBadge';
import { OGImage } from './OGImage';
import { EmojiReactions } from './EmojiReactions';
import { CommentSection } from './CommentSection';

interface FriendInfo {
  userId: string;
  displayName: string;
}

interface EventCardProps {
  event: ETHDenverEvent;
  isInItinerary?: boolean;
  onItineraryToggle?: (eventId: string) => void;
  friendsCount?: number;
  friendsGoing?: FriendInfo[];
  checkedInFriends?: FriendInfo[];
  checkInCount?: number;
  reactions?: { emoji: ReactionEmoji; count: number; reacted: boolean }[];
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCount?: number;
  /** Conference context for featured event ad tracking */
  conference?: string;
  onCheckIn?: (eventId: string) => void;
  checkInLoading?: boolean;
  isLive?: boolean;
}

function FriendsGoingModal({
  eventName,
  friends,
  onClose,
  title = 'Friends Going',
  accentColor = 'blue',
}: {
  eventName: string;
  friends: FriendInfo[];
  onClose: () => void;
  title?: string;
  accentColor?: 'blue' | 'green';
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const avatarBg = accentColor === 'green' ? 'bg-green-500/20' : '';
  const avatarBgStyle = accentColor === 'green' ? undefined : { backgroundColor: 'color-mix(in srgb, var(--friend-blue) 20%, transparent)' };
  const avatarText = accentColor === 'green' ? 'text-green-400' : '';

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)]">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-[var(--theme-text-primary)]">{title}</h3>
            <p className="text-xs text-[var(--theme-text-secondary)] truncate">{eventName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer shrink-0 ml-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Friends list */}
        <div className="overflow-y-auto max-h-[60vh] p-3 space-y-2">
          {friends.map((friend) => (
            <div
              key={friend.userId}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--theme-bg-tertiary)] transition-colors"
            >
              <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center shrink-0`} style={avatarBgStyle}>
                <span className={`text-sm font-medium ${avatarText}`} style={accentColor !== 'green' ? { color: 'var(--friend-blue)' } : undefined}>
                  {friend.displayName[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
              <span className="text-sm text-[var(--theme-text-primary)] truncate">{friend.displayName}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function EventCard({
  event,
  isInItinerary = false,
  onItineraryToggle,
  friendsCount,
  friendsGoing,
  checkedInFriends,
  checkInCount,
  reactions,
  onToggleReaction,
  commentCount,
  conference,
  onCheckIn,
  checkInLoading,
  isLive,
}: EventCardProps) {
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [showCheckedInModal, setShowCheckedInModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const featuredImpressionTracked = useRef(false);
  const eventImpressionTracked = useRef(false);

  // Track featured event impressions via IntersectionObserver
  useEffect(() => {
    if (!event.isFeatured) return;
    const el = cardRef.current;
    if (!el || featuredImpressionTracked.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !featuredImpressionTracked.current) {
          featuredImpressionTracked.current = true;
          trackAdEvent({
            ad_id: `featured-${event.id}`,
            ad_name: event.name,
            placement: 'featured-event',
            event_type: 'impression',
            conference,
          });
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [event.id, event.name, event.isFeatured, conference]);

  // Track event impressions via IntersectionObserver (all events in list view)
  useEffect(() => {
    const el = cardRef.current;
    if (!el || eventImpressionTracked.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !eventImpressionTracked.current) {
          eventImpressionTracked.current = true;
          trackEvent({
            event_id: event.id,
            event_name: event.name,
            event_type: 'impression',
            conference,
            source: 'list',
          });
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [event.id, event.name, conference]);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!event.link) return;
    navigator.clipboard.writeText(event.link).then(() => {
      trackCopyEventLink(event.name);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div ref={cardRef} className={`rounded-lg p-4 transition-colors group flex gap-4 overflow-hidden ${
      event.isFeatured
        ? 'bg-[var(--theme-bg-card)] border-2 hover:bg-[var(--theme-bg-card-hover)]'
        : 'bg-[var(--theme-bg-card)] border border-[var(--theme-border-primary)] hover:bg-[var(--theme-bg-card-hover)] hover:border-[var(--theme-border-primary)] active:bg-[var(--theme-bg-card-hover)]'
    }`}
      style={event.isFeatured ? { borderColor: 'var(--theme-popup-featured-border)' } : undefined}
    >
      {/* Left: cover image */}
      {event.link && <OGImage url={event.link} eventId={event.id} rsvpUrl={event.link} />}

      {/* Right: event details */}
      <div className="flex-1 min-w-0">
        {/* Top row: Name + Star */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-[var(--theme-text-primary)] text-sm sm:text-base leading-tight">
              {event.link ? (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[var(--theme-accent)] active:text-[var(--theme-accent)] transition-colors"
                  onClick={() => {
                    trackEventClick(event.name, event.link!);
                    trackEvent({
                      event_id: event.id,
                      event_name: event.name,
                      event_type: 'click',
                      conference,
                      url: event.link!,
                      source: 'list',
                    });
                    if (event.isFeatured) {
                      trackAdEvent({
                        ad_id: `featured-${event.id}`,
                        ad_name: event.name,
                        placement: 'featured-event',
                        event_type: 'click',
                        url: event.link!,
                        conference,
                      });
                    }
                  }}
                >
                  {event.name}
                </a>
              ) : (
                event.name
              )}
            </h3>
            {event.organizer && (
              <p className="text-[var(--theme-text-muted)] text-xs mt-0.5">{event.organizer}</p>
            )}
          </div>

          <div className="flex flex-col items-center shrink-0">
            {onItineraryToggle && (
              <StarButton
                eventId={event.id}
                isStarred={isInItinerary}
                onToggle={onItineraryToggle}
                friendsCount={friendsCount}
              />
            )}
            {event.link && (
              <button
                onClick={handleCopyLink}
                className="p-1 text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] transition-colors cursor-pointer"
                aria-label="Copy event link"
                title="Copy link"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Link className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Date + Time */}
        <div className="relative w-fit mt-1">
          <p className="text-[var(--theme-text-secondary)] text-sm flex items-start gap-1">
            <Calendar className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{event.date} · {timeDisplay}</span>
          </p>
          {(checkInCount ?? 0) > 0 && (
            <span className="absolute -top-1 -right-3 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-green-500 text-white text-[9px] font-bold px-0.5 pointer-events-none">
              {checkInCount}
            </span>
          )}
        </div>

        {/* Address */}
        {event.address && (
          <AddressLink address={event.address} navAddress={event.matchedAddress} lat={event.lat} lng={event.lng}
            eventId={event.id} eventName={event.name}
            className="w-full text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] text-sm mt-1 flex items-start gap-1 overflow-hidden transition-colors min-w-0">
            <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="truncate">{event.address}</span>
          </AddressLink>
        )}

        {/* Badges row */}
        {event.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {event.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}

        {/* Check In button (live + RSVP'd only) */}
        {isInItinerary && isLive && onCheckIn && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCheckIn(event.id);
            }}
            disabled={checkInLoading}
            className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer w-fit"
          >
            {checkInLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <MapPinCheck className="w-3.5 h-3.5" />
            )}
            Check In
          </button>
        )}

        {/* Friends going row */}
        {friendsGoing && friendsGoing.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              trackFriendsGoingOpen(event.name);
              setShowFriendsModal(true);
            }}
            className="flex items-center gap-2 mt-2 px-2 py-1.5 -mx-1 rounded-lg hover:bg-[var(--theme-bg-tertiary)]/50 transition-colors cursor-pointer group/friends w-fit"
          >
            <Users className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--friend-blue)' }} />
            <span className="text-xs transition-colors" style={{ color: 'var(--friend-blue)' }}>
              {formatFriendsText(friendsGoing)}
            </span>
          </button>
        )}

        {/* Friends checked in row (green) */}
        {checkedInFriends && checkedInFriends.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              trackFriendsCheckedInOpen(event.name);
              setShowCheckedInModal(true);
            }}
            className="flex items-center gap-2 mt-1 px-2 py-1.5 -mx-1 rounded-lg hover:bg-[var(--theme-bg-tertiary)]/50 transition-colors cursor-pointer group/checkin w-fit"
          >
            <MapPin className="w-3.5 h-3.5 text-green-400 shrink-0" />
            <span className="text-xs text-green-400 group-hover/checkin:text-green-300 transition-colors">
              {formatFriendsText(checkedInFriends)} checked in
            </span>
          </button>
        )}

        {/* Note */}
        {event.note && (
          <p className="text-[var(--theme-text-faint)] text-xs mt-1 italic truncate">{event.note}</p>
        )}

        {/* Emoji reactions + Comments inline */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {onToggleReaction && (
            <EmojiReactions
              eventId={event.id}
              reactions={reactions}
              onToggle={onToggleReaction}
            />
          )}
          <CommentSection eventId={event.id} commentCount={commentCount} />
        </div>
      </div>

      {/* Friends going modal */}
      {showFriendsModal && friendsGoing && friendsGoing.length > 0 && (
        <FriendsGoingModal
          eventName={event.name}
          friends={friendsGoing}
          onClose={() => setShowFriendsModal(false)}
        />
      )}

      {/* Friends checked in modal (green) */}
      {showCheckedInModal && checkedInFriends && checkedInFriends.length > 0 && (
        <FriendsGoingModal
          eventName={event.name}
          friends={checkedInFriends}
          onClose={() => setShowCheckedInModal(false)}
          title="Friends Checked In"
          accentColor="green"
        />
      )}
    </div>
  );
}
