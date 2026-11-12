'use client';

import { Marker } from 'react-map-gl/mapbox';
import type { FriendLocation } from '@/lib/types';
import { timeAgo } from '@/lib/time-parse';
import { getDisplayName } from '@/lib/user-display';
import UserAvatar from './UserAvatar';
import { useNow } from '@/hooks/useNow';

interface FriendMarkerProps {
  location: FriendLocation;
  zoom?: number;
}

export function FriendMarker({ location, zoom = 12 }: FriendMarkerProps) {
  const name = getDisplayName(location, 'Friend');
  const showLabel = zoom >= 13;

  // Stale if >1h old
  const now = useNow();
  const ageMs = now - new Date(location.updated_at).getTime();
  const isStale = ageMs > 60 * 60 * 1000;
  const isRecent = ageMs < 5 * 60 * 1000;

  return (
    <Marker latitude={location.lat} longitude={location.lng} anchor="center">
      <div
        className="relative flex flex-col items-center"
        style={{ opacity: isStale ? 0.5 : 1 }}
      >
        {/* Avatar circle */}
        <div
          className={`rounded-full border-2 shadow-lg overflow-hidden ${
            isRecent ? 'border-success-dot' : 'border-[var(--theme-text-muted)]'
          }`}
        >
          <UserAvatar size="sm" avatarUrl={location.avatar_url} xHandle={location.x_handle} displayName={location.display_name} />
        </div>

        {/* Online pulse dot */}
        {isRecent && (
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5">
            <div className="absolute inset-0 w-2.5 h-2.5 bg-success-dot rounded-full animate-ping opacity-40" />
            <div className="absolute inset-0 w-2.5 h-2.5 bg-success-dot rounded-full border border-[var(--theme-bg-primary)]" />
          </div>
        )}

        {/* Name + time label */}
        {showLabel && (
          <div className="mt-1 px-1.5 py-0.5 rounded bg-[var(--theme-bg-secondary)]/90 text-2xs text-[var(--theme-text-primary)] whitespace-nowrap max-w-[100px] truncate text-center leading-tight">
            <div className="font-medium truncate">{name.split(' ')[0]}</div>
            <div className="text-[var(--theme-text-secondary)]">{timeAgo(location.updated_at)}</div>
          </div>
        )}
      </div>
    </Marker>
  );
}
