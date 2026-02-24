'use client';

import { useState } from 'react';
import { Marker } from 'react-map-gl/mapbox';
import type { FriendLocation } from '@/lib/types';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

interface FriendMarkerProps {
  location: FriendLocation;
  zoom?: number;
}

export function FriendMarker({ location, zoom = 12 }: FriendMarkerProps) {
  const [imgError, setImgError] = useState(false);

  const name = location.display_name || (location.x_handle ? `@${location.x_handle}` : null) || 'Friend';
  const initial = (location.display_name || location.x_handle || 'F')[0].toUpperCase();
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
          style={{ backgroundColor: '#1e293b' }}
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
          <div className="mt-1 px-1.5 py-0.5 rounded bg-slate-800/90 text-[9px] text-white whitespace-nowrap max-w-[100px] truncate text-center leading-tight">
            <div className="font-medium truncate">{name.split(' ')[0]}</div>
            <div className="text-slate-400">{timeAgo(location.updated_at)}</div>
          </div>
        )}
      </div>
    </Marker>
  );
}
