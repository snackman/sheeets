'use client';

import { useCallback } from 'react';
import { Marker } from 'react-map-gl/mapbox';
import { MapPin, BedDouble, Utensils, Wine, Laptop, Users } from 'lucide-react';
import { POI_CATEGORIES } from '@/lib/constants';
import type { POI } from '@/lib/types';

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  MapPin,
  BedDouble,
  Utensils,
  Wine,
  Laptop,
  Users,
};

interface POIMarkerProps {
  poi: POI;
  onSelect: (poi: POI) => void;
  isOwn?: boolean;
  zoom?: number;
}

export function POIMarker({ poi, onSelect, isOwn = true, zoom = 12 }: POIMarkerProps) {
  const cat = POI_CATEGORIES.find((c) => c.value === poi.category) ?? POI_CATEGORIES[0];
  const Icon = CATEGORY_ICONS[cat.icon] ?? MapPin;
  const showLabel = zoom >= 11.5;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(poi);
    },
    [poi, onSelect]
  );

  return (
    <Marker latitude={poi.lat} longitude={poi.lng}>
      <div className="relative" style={{ width: 0, height: 0 }}>
        <button
          className="absolute cursor-pointer transition-transform hover:scale-110 active:scale-95 focus:outline-none"
          style={{ transform: 'translate(-50%, -50%)' }}
          onClick={handleClick}
          aria-label={poi.name}
        >
          <div
            className={`flex items-center justify-center rounded-full border-2 shadow-lg ${
              isOwn !== false ? 'border-white/60' : 'border-dashed border-white/40'
            }`}
            style={{ width: 24, height: 24, backgroundColor: cat.color }}
          >
            <Icon className="w-3.5 h-3.5 text-white" />
          </div>
        </button>

        {showLabel && (
          <div
            className="absolute cursor-pointer"
            style={{ left: 0, top: 18, transform: 'translateX(-50%)' }}
            onClick={handleClick}
          >
            <div className="px-2 py-0.5 rounded bg-sky-900/90 hover:bg-sky-800/90 text-[10px] text-white max-w-[120px] leading-tight transition-colors whitespace-nowrap truncate">
              {poi.name}
            </div>
          </div>
        )}
      </div>
    </Marker>
  );
}
