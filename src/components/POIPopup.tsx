'use client';

import { Popup } from 'react-map-gl/mapbox';
import { X, MapPin, Trash2 } from 'lucide-react';
import { POI_CATEGORIES } from '@/lib/constants';
import type { POI } from '@/lib/types';
import { AddressLink } from './AddressLink';

interface POIPopupProps {
  poi: POI;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Pick<POI, 'name' | 'category' | 'note' | 'is_public'>>) => void;
  currentUserId?: string;
  ownerName?: string;
}

export function POIPopup({ poi, onClose, onDelete, onUpdate, currentUserId, ownerName }: POIPopupProps) {
  const cat = POI_CATEGORIES.find((c) => c.value === poi.category) ?? POI_CATEGORIES[0];
  const isOwn = poi.user_id === currentUserId;

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
            className="shrink-0 p-1 text-violet-300 hover:text-white active:text-white transition-colors"
            aria-label="Close popup"
          >
            <X size={14} />
          </button>
        </div>

        {/* Address */}
        {poi.address && (
          <AddressLink
            address={poi.address}
            lat={poi.lat}
            lng={poi.lng}
            isPrivatePin={!poi.is_public}
            className="text-violet-400 hover:text-violet-200 text-xs mt-1.5 flex items-center gap-1 transition-colors"
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{poi.address}</span>
          </AddressLink>
        )}

        {/* Note */}
        {poi.note && (
          <p className="text-violet-300 text-xs mt-1.5 italic line-clamp-2">{poi.note}</p>
        )}

        {/* Friend attribution */}
        {!isOwn && ownerName && (
          <p className="text-xs text-violet-400 mt-1">Shared by {ownerName}</p>
        )}

        {/* Share toggle & delete — own POIs only */}
        {isOwn && (
          <div className="mt-2 pt-2 border-t border-violet-800">
            {/* Share toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-violet-300">Share with friends</span>
              <button
                onClick={() => onUpdate?.(poi.id, { is_public: !poi.is_public })}
                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
                  poi.is_public ? 'bg-cyan-500' : 'bg-violet-700'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  poi.is_public ? 'translate-x-4' : ''
                }`} />
              </button>
            </div>

            {/* Delete button */}
            <button
              onClick={() => onDelete(poi.id)}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 active:text-red-300 transition-colors cursor-pointer mt-2"
            >
              <Trash2 className="w-3 h-3" />
              Remove pin
            </button>
          </div>
        )}
      </div>
    </Popup>
  );
}
