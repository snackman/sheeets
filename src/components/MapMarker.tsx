'use client';

import { useCallback } from 'react';
import { Marker } from 'react-map-gl/mapbox';
import { VIBE_COLORS } from '@/lib/constants';

interface MapMarkerProps {
  latitude: number;
  longitude: number;
  vibe: string;
  eventCount?: number;
  onClick: () => void;
}

export function MapMarker({
  latitude,
  longitude,
  vibe,
  eventCount = 1,
  onClick,
}: MapMarkerProps) {
  const color = VIBE_COLORS[vibe] || VIBE_COLORS['default'];

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  return (
    <Marker latitude={latitude} longitude={longitude}>
      <button
        className="relative flex items-center justify-center cursor-pointer transition-transform hover:scale-125 focus:outline-none"
        onClick={handleClick}
        aria-label={`${vibe} event${eventCount > 1 ? ` (${eventCount} events)` : ''}`}
      >
        <div
          className="rounded-full border-2 border-white/80"
          style={{
            width: 14,
            height: 14,
            backgroundColor: color,
            boxShadow: `0 0 6px ${color}80`,
          }}
        />
        {eventCount > 1 && (
          <span
            className="absolute -top-1 -right-2 bg-white text-gray-900 text-[9px] font-bold rounded-full flex items-center justify-center"
            style={{ width: 16, height: 16 }}
          >
            {eventCount}
          </span>
        )}
      </button>
    </Marker>
  );
}
