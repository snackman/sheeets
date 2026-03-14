'use client';

import { useState } from 'react';
import { Marker } from 'react-map-gl/mapbox';
import type { FriendLocation } from '@/lib/types';
import { timeAgo } from '@/lib/time-parse';
import { getDisplayName, getDisplayInitial } from '@/lib/user-display';

interface FriendMarkerProps {
  location: FriendLocation;
  zoom?: number;
}

export function FriendMarker({ location, zoom = 12 }: FriendMarkerProps) {
  const [imgError, setImgError] = useState(false);

  const name = getDisplayName(location, 'Friend');
  const initial = getDisplayInitial(location);
  const showLabel = zoom >= 13;

  // Stale if >1h old
  const ageMs = Date.now() - new Date(location.updated_at).getTime();
  const isStale = ageMs > 60 * 60 * 1000;
  const isRecent = ageMs < 5 * 60 * 1000;

  const avatarUrl = location.x_handle
    ? `https://unavatar.io/x/${location.x_handle}`
    : null;

  return (
    <Marker latitude={location.lat} longitude={location.lng} anchor="center">
      <div
        className="relative flex flex-col items-center"
        style={{ opacity: isStale ? 0.5 : 1 }}
      >
        {/* Avatar circle */}
        <div
          className={`w-8 h-8 rounded-full border-2 shadow-lg flex items-center justify-center overflow-hidden ${
            isRecent ? 'border-green-400' : 'border-slate-400'
          }`}
          style={{ backgroundColor: '#1c1917' }}
        >
          {avatarUrl && !imgError ? (
            <img
              src={avatarUrl}
              alt={name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="text-sm font-bold text-white">{initial}</span>
          )}
        </div>

        {/* Online pulse dot */}
        {isRecent && (
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5">
            <div className="absolute inset-0 w-2.5 h-2.5 bg-green-400 rounded-full animate-ping opacity-40" />
            <div className="absolute inset-0 w-2.5 h-2.5 bg-green-400 rounded-full border border-slate-900" />
          </div>
        )}

        {/* Name + time label */}
        {showLabel && (
          <div className="mt-1 px-1.5 py-0.5 rounded bg-[var(--theme-bg-secondary)]/90 text-[9px] text-[var(--theme-text-primary)] whitespace-nowrap max-w-[100px] truncate text-center leading-tight">
            <div className="font-medium truncate">{name.split(' ')[0]}</div>
            <div className="text-[var(--theme-text-secondary)]">{timeAgo(location.updated_at)}</div>
          </div>
        )}
      </div>
    </Marker>
  );
}
