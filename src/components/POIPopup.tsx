'use client';

import { Popup } from 'react-map-gl/mapbox';
import { X, MapPin, Trash2 } from 'lucide-react';
import { POI_CATEGORIES } from '@/lib/constants';
import type { POI } from '@/lib/types';

interface POIPopupProps {
  poi: POI;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function POIPopup({ poi, onClose, onDelete }: POIPopupProps) {
  const cat = POI_CATEGORIES.find((c) => c.value === poi.category) ?? POI_CATEGORIES[0];

  return (
    <Popup
      latitude={poi.lat}
      longitude={poi.lng}
      onClose={onClose}
      closeButton={false}
      closeOnClick={false}
      anchor="bottom"
      offset={16}
      className="map-popup"
    >
      <div className="w-[220px]">
        {/* Header */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-white leading-tight truncate">
              {poi.name}
            </h3>
            <span
              className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/90"
              style={{ backgroundColor: cat.color + '33', color: cat.color }}
            >
              {cat.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-slate-400 hover:text-white active:text-white transition-colors"
            aria-label="Close popup"
          >
            <X size={14} />
          </button>
        </div>

        {/* Address */}
        {poi.address && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(poi.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-slate-300 text-xs mt-1.5 flex items-center gap-1 transition-colors"
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{poi.address}</span>
          </a>
        )}

        {/* Note */}
        {poi.note && (
          <p className="text-slate-400 text-xs mt-1.5 italic line-clamp-2">{poi.note}</p>
        )}

        {/* Delete button */}
        <div className="mt-2 pt-2 border-t border-slate-700">
          <button
            onClick={() => onDelete(poi.id)}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 active:text-red-300 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            Remove pin
          </button>
        </div>
      </div>
    </Popup>
  );
}
