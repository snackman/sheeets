'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Calendar, Users, X, Link, Check } from 'lucide-react';
import type { ETHDenverEvent, ReactionEmoji } from '@/lib/types';
import { trackEventClick } from '@/lib/analytics';
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

  const avatarBg = accentColor === 'green' ? 'bg-green-500/20' : 'bg-blue-500/20';
  const avatarText = accentColor === 'green' ? 'text-green-400' : 'text-blue-400';

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative bg-stone-900 border border-stone-700 rounded-xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-700">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-white">{title}</h3>
            <p className="text-xs text-stone-400 truncate">{eventName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-white transition-colors cursor-pointer shrink-0 ml-2"
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
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-800 transition-colors"
            >
              <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center shrink-0`}>
                <span className={`text-sm font-medium ${avatarText}`}>
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
}: EventCardProps) {
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [showCheckedInModal, setShowCheckedInModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!event.link) return;
    navigator.clipboard.writeText(event.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const timeDisplay = event.isAllDay
    ? 'All Day'
    : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

  return (
    <div className={`rounded-lg p-4 transition-colors group flex gap-4 overflow-hidden ${
      event.isFeatured
        ? 'bg-stone-900 border-2 border-amber-500/50 hover:bg-stone-800 hover:border-amber-500/70 active:bg-stone-800 active:border-amber-500/70'
        : 'bg-stone-900 border border-stone-700 hover:bg-stone-800 hover:border-stone-600 active:bg-stone-800 active:border-stone-600'
    }`}>
      {/* Left: cover image */}
      {event.link && <OGImage url={event.link} eventId={event.id} />}

      {/* Right: event details */}
      <div className="flex-1 min-w-0">
        {/* Top row: Name + Star */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white text-sm sm:text-base leading-tight">
              {event.link ? (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-amber-400 active:text-amber-400 transition-colors"
                  onClick={() => trackEventClick(event.name, event.link!)}
                >
                  {event.name}
                </a>
              ) : (
                event.name
              )}
            </h3>
            {event.organizer && (
              <p className="text-stone-500 text-xs mt-0.5">{event.organizer}</p>
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
                className="p-1 text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
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
          <p className="text-stone-400 text-sm flex items-start gap-1">
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
            className="w-full text-stone-500 hover:text-stone-300 text-sm mt-1 flex items-start gap-1 overflow-hidden transition-colors min-w-0">
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

        {/* Friends going row */}
        {friendsGoing && friendsGoing.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowFriendsModal(true);
            }}
            className="flex items-center gap-2 mt-2 px-2 py-1.5 -mx-1 rounded-lg hover:bg-stone-800/50 transition-colors cursor-pointer group/friends w-fit"
          >
            <Users className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-xs text-blue-400 group-hover/friends:text-blue-300 transition-colors">
              {formatFriendsText(friendsGoing)}
            </span>
          </button>
        )}

        {/* Friends checked in row (green) */}
        {checkedInFriends && checkedInFriends.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowCheckedInModal(true);
            }}
            className="flex items-center gap-2 mt-1 px-2 py-1.5 -mx-1 rounded-lg hover:bg-stone-800/50 transition-colors cursor-pointer group/checkin w-fit"
          >
            <MapPin className="w-3.5 h-3.5 text-green-400 shrink-0" />
            <span className="text-xs text-green-400 group-hover/checkin:text-green-300 transition-colors">
              {formatFriendsText(checkedInFriends)} checked in
            </span>
          </button>
        )}

        {/* Note */}
        {event.note && (
          <p className="text-stone-600 text-xs mt-1 italic truncate">{event.note}</p>
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
