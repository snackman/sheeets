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
}

export function POIMarker({ poi, onSelect }: POIMarkerProps) {
  const cat = POI_CATEGORIES.find((c) => c.value === poi.category) ?? POI_CATEGORIES[0];
  const Icon = CATEGORY_ICONS[cat.icon] ?? MapPin;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(poi);
    },
    [poi, onSelect]
  );

  return (
    <Marker latitude={poi.lat} longitude={poi.lng}>
      <button
        className="cursor-pointer transition-transform hover:scale-110 active:scale-95 focus:outline-none"
        onClick={handleClick}
        aria-label={poi.name}
      >
        <div
          className="flex items-center justify-center rounded-full border-2 border-white/60 shadow-lg"
          style={{ width: 24, height: 24, backgroundColor: cat.color }}
        >
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
      </button>
    </Marker>
  );
}
