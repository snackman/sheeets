'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import MapGL, { NavigationControl, Marker } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import { LocateFixed } from 'lucide-react';
import type { ETHDenverEvent } from '@/lib/types';
import { DENVER_CENTER } from '@/lib/constants';
import { parseTimeToMinutes } from '@/lib/filters';
import { trackLocateMe } from '@/lib/analytics';
import { MapMarker } from './MapMarker';
import { EventPopup, MultiEventPopup } from './EventPopup';

interface MapViewProps {
  events: ETHDenverEvent[];
  onEventSelect?: (event: ETHDenverEvent) => void;
  itinerary?: Set<string>;
  onItineraryToggle?: (eventId: string) => void;
  isItineraryView?: boolean;
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
  itinerary,
  onItineraryToggle,
  isItineraryView = false,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const hasFittedRef = useRef(false);

  // Compute center from events with coordinates, excluding outliers
  // Returns null when no located events (e.g. "Now" filters everything out)
  const eventsCenter = useMemo(() => {
    const located = events.filter((e) => e.lat != null && e.lng != null);
    if (located.length === 0) return null;
    if (located.length <= 3) {
      const avgLat = located.reduce((s, e) => s + e.lat!, 0) / located.length;
      const avgLng = located.reduce((s, e) => s + e.lng!, 0) / located.length;
      return { lat: avgLat, lng: avgLng };
    }

    // Use IQR to exclude geographic outliers
    const lats = located.map((e) => e.lat!).sort((a, b) => a - b);
    const lngs = located.map((e) => e.lng!).sort((a, b) => a - b);

    const q1 = (arr: number[]) => arr[Math.floor(arr.length * 0.25)];
    const q3 = (arr: number[]) => arr[Math.floor(arr.length * 0.75)];

    const latQ1 = q1(lats), latQ3 = q3(lats), latIQR = latQ3 - latQ1;
    const lngQ1 = q1(lngs), lngQ3 = q3(lngs), lngIQR = lngQ3 - lngQ1;

    const margin = 1.5;
    const inliers = located.filter((e) =>
      e.lat! >= latQ1 - margin * latIQR &&
      e.lat! <= latQ3 + margin * latIQR &&
      e.lng! >= lngQ1 - margin * lngIQR &&
      e.lng! <= lngQ3 + margin * lngIQR
    );

    const pool = inliers.length > 0 ? inliers : located;
    const avgLat = pool.reduce((s, e) => s + e.lat!, 0) / pool.length;
    const avgLng = pool.reduce((s, e) => s + e.lng!, 0) / pool.length;
    return { lat: avgLat, lng: avgLng };
  }, [events]);

  const [viewState, setViewState] = useState({
    latitude: eventsCenter?.lat ?? DENVER_CENTER.lat,
    longitude: eventsCenter?.lng ?? DENVER_CENTER.lng,
    zoom: 12,
  });

  // Re-center when the events center changes significantly (e.g. switching conferences)
  // Skip if no located events (e.g. "Now" mode filters everything out)
  useEffect(() => {
    if (!eventsCenter) return;
    const dist = Math.abs(viewState.latitude - eventsCenter.lat) + Math.abs(viewState.longitude - eventsCenter.lng);
    if (dist > 1) {
      setViewState((prev) => ({ ...prev, latitude: eventsCenter.lat, longitude: eventsCenter.lng }));
    }
  }, [eventsCenter]); // eslint-disable-line react-hooks/exhaustive-deps

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) return;
    trackLocateMe();
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setLocating(false);
        mapRef.current?.flyTo({ center: [loc.lng, loc.lat], zoom: 14, duration: 1500 });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

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

  // Itinerary ordering: assign 1-based numbers sorted by date then start time
  const itineraryOrderMap = useMemo(() => {
    if (!isItineraryView) return new Map<string, number>();
    const sorted = [...events]
      .filter((e) => e.lat != null && e.lng != null)
      .sort((a, b) => {
        const dateCmp = a.dateISO.localeCompare(b.dateISO);
        if (dateCmp !== 0) return dateCmp;
        const aMin = parseTimeToMinutes(a.startTime) ?? 0;
        const bMin = parseTimeToMinutes(b.startTime) ?? 0;
        return aMin - bMin;
      });
    const map = new Map<string, number>();
    sorted.forEach((e, i) => map.set(e.id, i + 1));
    return map;
  }, [events, isItineraryView]);

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

      {/* Locate me button */}
      <div className="absolute top-2 left-2 z-10">
        <button
          onClick={handleLocateMe}
          disabled={locating}
          className={`p-2 rounded-lg shadow-lg border transition-colors cursor-pointer ${
            userLocation
              ? 'bg-blue-500 border-blue-400 text-white'
              : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
          } disabled:opacity-50`}
          title="Show my location"
          aria-label="Show my location"
        >
          <LocateFixed className={`w-4 h-4 ${locating ? 'animate-pulse' : ''}`} />
        </button>
      </div>

      {/* User location marker */}
      {userLocation && (
        <Marker latitude={userLocation.lat} longitude={userLocation.lng} anchor="center">
          <div className="relative">
            <div className="w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-lg" />
            <div className="absolute inset-0 w-4 h-4 bg-blue-400 rounded-full animate-ping opacity-40" />
          </div>
        </Marker>
      )}

      {locationMarkers.map(({ event, key, count }) => {
        const colocated = colocatedMap.get(key);
        // For co-located markers, label shows "N events"; for single, show event name
        const markerLabel = count > 1 ? `${count} events` : event.name;
        const markerOrganizer = count > 1 ? undefined : event.organizer;
        const markerTime = count > 1 ? undefined : event.startTime;
        // For itinerary view: single pin gets its number, co-located gets lowest number in group
        let orderNumber: number | undefined;
        if (isItineraryView) {
          if (count === 1) {
            orderNumber = itineraryOrderMap.get(event.id);
          } else if (colocated) {
            const nums = colocated
              .map((e) => itineraryOrderMap.get(e.id))
              .filter((n): n is number => n != null);
            orderNumber = nums.length > 0 ? Math.min(...nums) : undefined;
          }
        }
        return (
          <MapMarker
            key={`loc-${key}`}
            latitude={event.lat!}
            longitude={event.lng!}
            startMinutes={parseTimeToMinutes(event.startTime)}
            endMinutes={parseTimeToMinutes(event.endTime)}
            isAllDay={event.isAllDay}
            eventCount={count}
            onClick={() =>
              handleMarkerClick(event, event.lat!, event.lng!)
            }
            zoom={viewState.zoom}
            label={markerLabel}
            organizer={markerOrganizer}
            time={markerTime}
            orderNumber={orderNumber}
          />
        );
      })}

      {popupEvent && popupCoords && (
        <EventPopup
          event={popupEvent}
          latitude={popupCoords.lat}
          longitude={popupCoords.lng}
          onClose={handlePopupClose}
          isInItinerary={itinerary?.has(popupEvent.id)}
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
          itinerary={itinerary}
          onItineraryToggle={onItineraryToggle}
        />
      )}
    </MapGL>
  );
}
