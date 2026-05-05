'use client';

import { Popup } from 'react-map-gl/mapbox';
import { X, Calendar, MapPin } from 'lucide-react';
import type { ETHDenverEvent, ReactionEmoji, FriendInfo } from '@/lib/types';
import { shortenAddress } from '@/lib/utils';
import { StarButton } from './StarButton';
import { FriendAvatarStack } from './FriendAvatarStack';
import { AddressLink } from './AddressLink';
import { TagBadge } from './TagBadge';
import { OGImage } from './OGImage';
import { EventCard } from './EventCard';

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
  liveUrgency?: 'green' | 'yellow' | 'red';
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
  liveUrgency,
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
      <div className="w-[300px] max-w-[calc(100vw-3rem)]">
        <EventCard
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
          liveUrgency={liveUrgency}
          compact
        />
      </div>
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
  reactionsByEvent,
  onToggleReaction,
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
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--theme-text-primary)] leading-tight truncate">
                        {event.name}
                      </p>
                      {event.organizer && (
                        <p className="text-[10px] text-[var(--theme-text-muted)] mt-0.5 truncate">{event.organizer}</p>
                      )}
                    </div>
                    {onItineraryToggle && (
                      <StarButton
                        eventId={event.id}
                        isStarred={isInItinerary}
                        onToggle={onItineraryToggle}
                        size="sm"
                        friendsCount={friendsCountByEvent?.get(event.id)}
                      />
                    )}
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
                      <span className="truncate">{shortenAddress(event.address)}</span>
                    </AddressLink>
                  )}
                  {event.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      {event.tags.map((tag) => (
                        <TagBadge key={tag} tag={tag} iconOnly />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Popup>
  );
}
