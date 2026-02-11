'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import MapGL, { NavigationControl } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import type { ETHDenverEvent } from '@/lib/types';
import { DENVER_CENTER } from '@/lib/constants';
import { MapMarker } from './MapMarker';
import { EventPopup, MultiEventPopup } from './EventPopup';

interface MapViewProps {
  events: ETHDenverEvent[];
  onEventSelect?: (event: ETHDenverEvent) => void;
  starred?: Set<string>;
  itinerary?: Set<string>;
  onStarToggle?: (eventId: string) => void;
  onItineraryToggle?: (eventId: string) => void;
}

/**
 * Round a coordinate to 5 decimal places for co-location grouping.
 * 5 decimals gives ~1.1 m accuracy, enough to detect same-address events.
 */
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function MapView({
  events,
  onEventSelect,
  starred,
  itinerary,
  onStarToggle,
  onItineraryToggle,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);

  const [viewState, setViewState] = useState({
    latitude: DENVER_CENTER.lat,
    longitude: DENVER_CENTER.lng,
    zoom: 12,
  });

  const [popupEvent, setPopupEvent] = useState<ETHDenverEvent | null>(null);
  const [popupEvents, setPopupEvents] = useState<ETHDenverEvent[] | null>(null);
  const [popupCoords, setPopupCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // Group events by co-located coordinates
  const colocatedMap = useMemo(() => {
    const map = new Map<string, ETHDenverEvent[]>();
    for (const event of events) {
      if (event.lat == null || event.lng == null) continue;
      const key = coordKey(event.lat, event.lng);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(event);
    }
    return map;
  }, [events]);

  // Unique location markers (one per coordinate, with co-location count)
  const locationMarkers = useMemo(() => {
    const seen = new Set<string>();
    const result: { event: ETHDenverEvent; key: string; count: number }[] = [];

    for (const event of events) {
      if (event.lat == null || event.lng == null) continue;
      const key = coordKey(event.lat, event.lng);
      if (seen.has(key)) continue;
      seen.add(key);

      const colocated = colocatedMap.get(key);
      result.push({ event, key, count: colocated ? colocated.length : 1 });
    }

    return result;
  }, [events, colocatedMap]);

  const handleMarkerClick = useCallback(
    (event: ETHDenverEvent, lat: number, lng: number) => {
      const key = coordKey(lat, lng);
      const colocated = colocatedMap.get(key);

      if (colocated && colocated.length > 1) {
        // Multiple events at this location
        setPopupEvent(null);
        setPopupEvents(colocated);
        setPopupCoords({ lat, lng });
      } else {
        // Single event
        setPopupEvents(null);
        setPopupEvent(event);
        setPopupCoords({ lat, lng });
      }
    },
    [colocatedMap]
  );

  const handlePopupClose = useCallback(() => {
    setPopupEvent(null);
    setPopupEvents(null);
    setPopupCoords(null);
  }, []);

  const handleMultiEventSelect = useCallback(
    (event: ETHDenverEvent) => {
      setPopupEvents(null);
      setPopupEvent(event);
      onEventSelect?.(event);
    },
    [onEventSelect]
  );

  const handleMapClick = useCallback(() => {
    handlePopupClose();
  }, [handlePopupClose]);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (!mapboxToken) {
    return (
      <div className="w-full h-full bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 text-lg mb-2">
            Mapbox token not configured
          </p>
          <p className="text-slate-500 text-sm">
            Set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local
          </p>
        </div>
      </div>
    );
  }

  return (
    <MapGL
      ref={mapRef}
      {...viewState}
      onMove={(evt) => setViewState(evt.viewState)}
      onClick={handleMapClick}
      mapStyle="mapbox://styles/mapbox/dark-v11"
      mapboxAccessToken={mapboxToken}
      style={{ width: '100%', height: '100%' }}
      maxZoom={20}
      minZoom={9}
    >
      <NavigationControl position="top-right" />

      {locationMarkers.map(({ event, key, count }) => (
        <MapMarker
          key={`loc-${key}`}
          latitude={event.lat!}
          longitude={event.lng!}
          vibe={event.vibe || 'default'}
          eventCount={count}
          onClick={() =>
            handleMarkerClick(event, event.lat!, event.lng!)
          }
        />
      ))}

      {popupEvent && popupCoords && (
        <EventPopup
          event={popupEvent}
          latitude={popupCoords.lat}
          longitude={popupCoords.lng}
          onClose={handlePopupClose}
          isStarred={starred?.has(popupEvent.id)}
          isInItinerary={itinerary?.has(popupEvent.id)}
          onStarToggle={onStarToggle}
          onItineraryToggle={onItineraryToggle}
        />
      )}

      {popupEvents && popupCoords && (
        <MultiEventPopup
          events={popupEvents}
          latitude={popupCoords.lat}
          longitude={popupCoords.lng}
          onClose={handlePopupClose}
          onSelectEvent={handleMultiEventSelect}
        />
      )}
    </MapGL>
  );
}
