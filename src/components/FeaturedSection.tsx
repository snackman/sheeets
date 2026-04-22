'use client';

import { Star } from 'lucide-react';
import type { ETHDenverEvent, ReactionEmoji } from '@/lib/types';
import { EventCard } from './EventCard';

interface FeaturedSectionProps {
  featuredEvents: ETHDenverEvent[];
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  friendsCountByEvent?: Map<string, number>;
  friendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkedInFriendsByEvent?: Map<string, { userId: string; displayName: string }[]>;
  checkInCounts?: Map<string, number>;
  reactionsByEvent?: Map<string, { emoji: ReactionEmoji; count: number; reacted: boolean }[]>;
  onToggleReaction?: (eventId: string, emoji: ReactionEmoji) => void;
  commentCounts?: Map<string, number>;
  conference?: string;
}

export function FeaturedSection({
  featuredEvents,
  itinerary,
  onItineraryToggle,
  friendsCountByEvent,
  friendsByEvent,
  checkedInFriendsByEvent,
  checkInCounts,
  reactionsByEvent,
  onToggleReaction,
  commentCounts,
  conference,
}: FeaturedSectionProps) {
  if (!featuredEvents || featuredEvents.length === 0) return null;

  return (
    <div className="mb-4">
      {/* Section header */}
      <div className="flex items-center gap-2 py-2">
        <Star
          className="w-4 h-4 fill-current"
          style={{ color: 'var(--theme-popup-featured-border)' }}
        />
        <h2
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: 'var(--theme-popup-featured-border)' }}
        >
          Featured
        </h2>
      </div>

      {/* Responsive grid of EventCards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {featuredEvents.map((event) => (
          <EventCard
            key={`featured-${event.id}`}
            event={event}
            isInItinerary={itinerary?.has(event.id)}
            onItineraryToggle={onItineraryToggle}
            friendsCount={friendsCountByEvent?.get(event.id)}
            friendsGoing={friendsByEvent?.get(event.id)}
            checkedInFriends={checkedInFriendsByEvent?.get(event.id)}
            checkInCount={checkInCounts?.get(event.id)}
            reactions={reactionsByEvent?.get(event.id)}
            onToggleReaction={onToggleReaction}
            commentCount={commentCounts?.get(event.id)}
            conference={conference}
          />
        ))}
      </div>

      {/* Bottom divider */}
      <div className="border-b border-[var(--theme-border-secondary)] mt-4" />
    </div>
  );
}
