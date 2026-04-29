'use client';

import { Popup } from 'react-map-gl/mapbox';
import { X, Calendar, MapPin, Users, MapPinCheck, Loader2 } from 'lucide-react';
import type { ETHDenverEvent, ReactionEmoji } from '@/lib/types';
import { trackEventClick } from '@/lib/analytics';
import { trackEvent } from '@/lib/event-tracking';
import { StarButton } from './StarButton';
import { AddressLink } from './AddressLink';
import { TagBadge } from './TagBadge';
import { OGImage } from './OGImage';
import { EmojiReactions } from './EmojiReactions';
import { CommentSection } from './CommentSection';

interface FriendInfo {
  userId: string;
  displayName: string;
}

interface EventPopupProps {
  event: ETHDenverEvent;
  latitude: number;
  longitude: number;
  onClose: () => void;
  isInItinerary?: boolean;
  onItineraryToggle?: (eventId: string) => void;
  friendsCount?: number;
  friendsGoing?: FriendInfo[];
  checkedInFriends?: FriendInfo[];
  checkInCount?: number;
  reactions?: { emoji: ReactionEmoji; count: number; reacted: boolean }[];
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCount?: number;
  conference?: string;
  onCheckIn?: (eventId: string) => void;
  checkInLoading?: boolean;
  isLive?: boolean;
}

interface MultiEventPopupProps {
  events: ETHDenverEvent[];
  latitude: number;
  longitude: number;
  onClose: () => void;
  onSelectEvent?: (event: ETHDenverEvent) => void;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  friendsCountByEvent?: Map<string, number>;
  friendsByEvent?: Map<string, FriendInfo[]>;
  checkedInFriendsByEvent?: Map<string, FriendInfo[]>;
  checkInCounts?: Map<string, number>;
  reactionsByEvent?: Map<string, { emoji: ReactionEmoji; count: number; reacted: boolean }[]>;
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCounts?: Map<string, number>;
}

function formatFriendsText(friends: FriendInfo[]): string {
  const names = friends.map((f) => f.displayName.split(' ')[0]);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

function FriendsRow({ friends }: { friends: FriendInfo[] }) {
  if (!friends || friends.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mt-1.5">
      <Users className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--friend-blue)' }} />
      <span className="text-[10px] truncate" style={{ color: 'var(--friend-blue)', opacity: 0.8 }}>
        {formatFriendsText(friends)}
      </span>
    </div>
  );
}

function CheckedInFriendsRow({ friends }: { friends: FriendInfo[] }) {
  if (!friends || friends.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mt-1">
      <MapPin className="w-2.5 h-2.5 text-green-400 shrink-0" />
      <span className="text-[10px] text-green-400/80 truncate">
        {formatFriendsText(friends)} checked in
      </span>
    </div>
  );
}

function SingleEventContent({
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
}: {
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
  conference?: string;
  onCheckIn?: (eventId: string) => void;
  checkInLoading?: boolean;
  isLive?: boolean;
}) {
  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div className="w-[300px] max-w-[calc(100vw-3rem)] flex gap-3">
      {/* Left: cover image */}
      {event.link && <OGImage key={event.id} url={event.link} eventId={event.id} rsvpUrl={event.link} />}

      {/* Right: event details */}
      <div className="flex-1 min-w-0">
        {/* Top row: Name + Star */}
        <div className="flex items-start gap-1">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-[var(--theme-text-primary)] leading-tight line-clamp-2">
              {event.link ? (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[var(--theme-accent)] transition-colors"
                  onClick={() => {
                    trackEventClick(event.name, event.link!);
                    trackEvent({
                      event_id: event.id,
                      event_name: event.name,
                      event_type: 'click',
                      conference,
                      url: event.link!,
                      source: 'map-popup',
                    });
                  }}
                >
                  {event.name}
                </a>
              ) : (
                event.name
              )}
            </h3>
            {event.organizer && (
              <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">{event.organizer}</p>
)}
          </div>
          {onItineraryToggle && (
            <StarButton
              eventId={event.id}
              isStarred={isInItinerary}
              onToggle={onItineraryToggle}
              size="sm"
              friendsCount={friendsCount}
            />
          )}
        </div>

        {/* Date + Time */}
        <div className="relative w-fit mt-1.5">
          <p className="text-[var(--theme-text-secondary)] text-xs flex items-center gap-1">
            <Calendar className="w-3 h-3 shrink-0" />
            <span>{event.date} · {timeDisplay}</span>
          </p>
          {(checkInCount ?? 0) > 0 && (
            <span className="absolute -top-0.5 -right-2.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-green-500 text-white text-[8px] font-bold px-0.5 pointer-events-none">
              {checkInCount}
            </span>
          )}
        </div>

        {/* Address */}
        {event.address && (
          <AddressLink address={event.address} navAddress={event.matchedAddress} lat={event.lat} lng={event.lng}
            eventId={event.id} eventName={event.name}
            className="w-full text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] text-xs mt-1 flex items-center gap-1 overflow-hidden transition-colors">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{event.address}</span>
          </AddressLink>
        )}

        {/* Tags row (icons only) */}
        {event.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-2">
            {event.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} iconOnly />
            ))}
          </div>
        )}

        {/* Friends going */}
        {friendsGoing && <FriendsRow friends={friendsGoing} />}

        {/* Friends checked in (green) */}
        {checkedInFriends && <CheckedInFriendsRow friends={checkedInFriends} />}

        {/* Note */}
        {event.note && (
          <p className="text-[var(--theme-text-faint)] text-xs mt-1 italic line-clamp-2">{event.note}</p>
        )}

        {/* Emoji reactions + Comments inline */}
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          {onToggleReaction && (
            <EmojiReactions
              eventId={event.id}
              reactions={reactions}
              onToggle={onToggleReaction}
              compact
            />
          )}
          <CommentSection eventId={event.id} commentCount={commentCount} />
        </div>

        {/* Check In button (live events only) */}
        {isLive && onCheckIn && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCheckIn(event.id);
            }}
            disabled={checkInLoading}
            className="flex items-center gap-1 mt-1.5 px-2 py-1 rounded-md bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-[10px] font-medium transition-colors cursor-pointer w-fit"
          >
            {checkInLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <MapPinCheck className="w-3 h-3" />
            )}
            Check In
          </button>
        )}
      </div>
    </div>
  );
}

export function EventPopup({
  event,
  latitude,
  longitude,
  onClose,
  isInItinerary,
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
}: EventPopupProps) {
  return (
    <Popup
      latitude={latitude}
      longitude={longitude}
      onClose={onClose}
      closeButton={false}
      closeOnClick={false}
      anchor="bottom"
      offset={16}
      className={`map-popup${event.isFeatured ? ' map-popup-featured' : ''}`}
    >
      <SingleEventContent
        event={event}
        isInItinerary={isInItinerary}
        onItineraryToggle={onItineraryToggle}
        friendsCount={friendsCount}
        friendsGoing={friendsGoing}
        checkedInFriends={checkedInFriends}
        checkInCount={checkInCount}
        reactions={reactions}
        onToggleReaction={onToggleReaction}
        commentCount={commentCount}
        conference={conference}
        onCheckIn={onCheckIn}
        checkInLoading={checkInLoading}
        isLive={isLive}
      />
    </Popup>
  );
}

export function MultiEventPopup({
  events,
  latitude,
  longitude,
  onClose,
  onSelectEvent,
  itinerary,
  onItineraryToggle,
  friendsCountByEvent,
  friendsByEvent,
  checkedInFriendsByEvent,
  checkInCounts,
  commentCounts,
}: MultiEventPopupProps) {
  return (
    <Popup
      latitude={latitude}
      longitude={longitude}
      onClose={onClose}
      closeButton={false}
      closeOnClick={false}
      anchor="bottom"
      offset={16}
      className="map-popup"
    >
      <div className="w-[300px] max-w-[calc(100vw-3rem)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-sm text-[var(--theme-text-primary)]">
            {events.length} events at this location
          </h3>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] active:text-[var(--theme-text-primary)] transition-colors"
            aria-label="Close popup"
          >
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[260px] overflow-y-auto space-y-2 pr-1">
          {events.map((event) => {
            const timeDisplay = event.isAllDay
              ? 'All Day'
              : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;
            const isInItinerary = itinerary?.has(event.id) ?? false;
            const eventFriends = friendsByEvent?.get(event.id);
            const eventCheckedIn = checkedInFriendsByEvent?.get(event.id);
            return (
              <div
                key={event.id}
                className="flex gap-2.5 p-2.5 bg-[var(--theme-bg-tertiary)]/50 hover:bg-[var(--theme-bg-tertiary)]/70 active:bg-[var(--theme-bg-tertiary)]/70 rounded-lg transition-colors cursor-pointer"
                onClick={() => onSelectEvent?.(event)}
              >
                {/* Cover image */}
                {event.link && <OGImage key={event.id} url={event.link} eventId={event.id} rsvpUrl={event.link} />}

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-1">
                    {onItineraryToggle && (
                      <StarButton
                        eventId={event.id}
                        isStarred={isInItinerary}
                        onToggle={onItineraryToggle}
                        size="sm"
                        friendsCount={friendsCountByEvent?.get(event.id)}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--theme-text-primary)] leading-tight truncate">
                        {event.name}
                      </p>
                      {event.organizer && (
                        <p className="text-[10px] text-[var(--theme-text-muted)] mt-0.5 truncate">{event.organizer}</p>
                      )}
                    </div>
                  </div>
                  <div className="relative w-fit mt-1">
                    <p className="text-[var(--theme-text-secondary)] text-[10px] flex items-center gap-1">
                      <Calendar className="w-2.5 h-2.5 shrink-0" />
                      <span>{event.date} · {timeDisplay}</span>
                    </p>
                    {(checkInCounts?.get(event.id) ?? 0) > 0 && (
                      <span className="absolute -top-0.5 -right-2 min-w-[12px] h-[12px] flex items-center justify-center rounded-full bg-green-500 text-white text-[7px] font-bold px-0.5 pointer-events-none">
                        {checkInCounts!.get(event.id)}
                      </span>
                    )}
                  </div>
                  {event.address && (
                    <AddressLink address={event.address} navAddress={event.matchedAddress} lat={event.lat} lng={event.lng}
                      eventId={event.id} eventName={event.name}
                      className="w-full text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] text-[10px] mt-0.5 flex items-center gap-1 overflow-hidden transition-colors">
                      <MapPin className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{event.address}</span>
                    </AddressLink>
                  )}
                  {event.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      {event.tags.map((tag) => (
                        <TagBadge key={tag} tag={tag} iconOnly />
                      ))}
                    </div>
                  )}
                  {eventFriends && <FriendsRow friends={eventFriends} />}
                  {eventCheckedIn && <CheckedInFriendsRow friends={eventCheckedIn} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Popup>
  );
}
