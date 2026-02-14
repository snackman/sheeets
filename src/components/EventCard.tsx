'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Calendar, Users, X } from 'lucide-react';
import { ETHDenverEvent } from '@/lib/types';
import { trackEventClick } from '@/lib/analytics';
import { StarButton } from './StarButton';
import { TagBadge } from './TagBadge';
import { OGImage } from './OGImage';

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
}

function FriendsGoingModal({
  eventName,
  friends,
  onClose,
}: {
  eventName: string;
  friends: FriendInfo[];
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-white">Friends Going</h3>
            <p className="text-xs text-slate-400 truncate">{eventName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0 ml-2"
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
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-750 hover:bg-slate-700 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                <span className="text-sm font-medium text-blue-400">
                  {friend.displayName[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
              <span className="text-sm text-white truncate">{friend.displayName}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function formatFriendsText(friends: FriendInfo[]): string {
  const names = friends.map((f) => f.displayName.split(' ')[0] || f.displayName);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

export function EventCard({
  event,
  isInItinerary = false,
  onItineraryToggle,
  friendsCount,
  friendsGoing,
}: EventCardProps) {
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:bg-slate-750 hover:border-slate-600 active:bg-slate-750 active:border-slate-600 transition-colors group flex gap-4">
      {/* Left: cover image */}
      {event.link && <OGImage url={event.link} eventId={event.id} />}

      {/* Right: event details */}
      <div className="flex-1 min-w-0">
        {/* Top row: Star, Name */}
        <div className="flex items-start gap-2">
          {onItineraryToggle ? (
            <StarButton
              eventId={event.id}
              isStarred={isInItinerary}
              onToggle={onItineraryToggle}
              friendsCount={friendsCount}
            />
          ) : (
            <div className="w-5 shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white text-sm sm:text-base leading-tight">
              {event.link ? (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-orange-400 active:text-orange-400 transition-colors"
                  onClick={() => trackEventClick(event.name, event.link!)}
                >
                  {event.name}
                </a>
              ) : (
                event.name
              )}
            </h3>
            {event.organizer && (
              <p className="text-slate-500 text-xs mt-0.5">{event.organizer}</p>
            )}
          </div>
        </div>

        {/* Date + Time */}
        <p className="text-slate-400 text-sm mt-1 flex items-start gap-1">
          <Calendar className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{event.date} · {timeDisplay}</span>
        </p>

        {/* Address */}
        {event.address && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-slate-300 text-sm mt-1 flex items-start gap-1 transition-colors"
          >
            <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="truncate">{event.address}</span>
          </a>
        )}

        {/* Badges row */}
        {event.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {event.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        )}

        {/* Friends going row */}
        {friendsGoing && friendsGoing.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowFriendsModal(true);
            }}
            className="flex items-center gap-2 mt-2 px-2 py-1.5 -mx-1 rounded-lg hover:bg-slate-700/50 transition-colors cursor-pointer group/friends w-fit"
          >
            <Users className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <div className="flex items-center -space-x-1">
              {friendsGoing.slice(0, 3).map((friend) => (
                <div
                  key={friend.userId}
                  className="w-5 h-5 rounded-full bg-blue-500/20 border border-slate-800 flex items-center justify-center"
                >
                  <span className="text-[10px] font-medium text-blue-400">
                    {friend.displayName[0]?.toUpperCase() ?? '?'}
                  </span>
                </div>
              ))}
            </div>
            <span className="text-xs text-blue-400 group-hover/friends:text-blue-300 transition-colors">
              {formatFriendsText(friendsGoing)}
            </span>
          </button>
        )}

        {/* Note */}
        {event.note && (
          <p className="text-slate-600 text-xs mt-1 italic">{event.note}</p>
        )}
      </div>

      {/* Friends going modal */}
      {showFriendsModal && friendsGoing && friendsGoing.length > 0 && (
        <FriendsGoingModal
          eventName={event.name}
          friends={friendsGoing}
          onClose={() => setShowFriendsModal(false)}
        />
      )}
    </div>
  );
}
