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
  zoom?: number;
  label?: string;
  time?: string;
  orderNumber?: number;
}

export function MapMarker({
  latitude,
  longitude,
  vibe,
  eventCount = 1,
  onClick,
  zoom = 12,
  label,
  time,
  orderNumber,
}: MapMarkerProps) {
  const color = VIBE_COLORS[vibe] || VIBE_COLORS['default'];

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  const showLabel = zoom >= 14 && label;
  const showTime = zoom >= 16 && time;
  const isNumbered = orderNumber != null;

  return (
    <Marker latitude={latitude} longitude={longitude}>
      <button
        className="relative flex flex-col items-center cursor-pointer transition-transform hover:scale-110 active:scale-95 focus:outline-none p-2"
        onClick={handleClick}
        aria-label={`${vibe} event${eventCount > 1 ? ` (${eventCount} events)` : ''}`}
      >
        {/* Pin dot or numbered circle */}
        <div className="relative flex items-center justify-center">
          {isNumbered ? (
            <div
              className="rounded-full border-2 border-white/80 flex items-center justify-center text-white font-bold text-[10px] leading-none"
              style={{
                width: 20,
                height: 20,
                backgroundColor: color,
                boxShadow: `0 0 6px ${color}80`,
              }}
            >
              {orderNumber}
            </div>
          ) : (
            <div
              className="rounded-full border-2 border-white/80"
              style={{
                width: 14,
                height: 14,
                backgroundColor: color,
                boxShadow: `0 0 6px ${color}80`,
              }}
            />
          )}
          {!isNumbered && eventCount > 1 && (
            <span
              className="absolute -top-1 -right-2 bg-white text-gray-900 text-[9px] font-bold rounded-full flex items-center justify-center"
              style={{ width: 16, height: 16 }}
            >
              {eventCount}
            </span>
          )}
        </div>

        {/* Label card (zoom >= 14) */}
        {showLabel && (
          <div className="mt-0.5 px-1.5 py-0.5 rounded bg-white/90 dark:bg-slate-800/90 text-[10px] text-gray-900 dark:text-white max-w-[120px] truncate whitespace-nowrap leading-tight pointer-events-none">
            {label}
            {showTime && (
              <span className="ml-1 text-gray-500 dark:text-slate-400">{time}</span>
            )}
          </div>
        )}
      </button>
    </Marker>
  );
}
