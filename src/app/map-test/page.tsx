'use client';

import { useEvents } from '@/hooks/useEvents';
import { MapViewWrapper } from '@/components/MapViewWrapper';

export default function MapTest() {
  const { events, loading, error } = useEvents();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        Loading events...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-red-500">
        {error}
      </div>
    );
  }

  // For testing: give events fake coordinates scattered around Denver
  // Some events share coordinates to test co-location handling
  const sharedLocations = [
    { lat: 39.7392, lng: -104.9903 },
    { lat: 39.7422, lng: -104.9873 },
    { lat: 39.7362, lng: -104.9943 },
  ];

  const testEvents = events.slice(0, 50).map((event, i) => {
    // Every 5th event shares a location with a previous one (co-location test)
    if (i > 0 && i % 5 === 0) {
      const sharedIdx = i % sharedLocations.length;
      return {
        ...event,
        lat: sharedLocations[sharedIdx].lat,
        lng: sharedLocations[sharedIdx].lng,
      };
    }

    return {
      ...event,
      lat: 39.7392 + (Math.random() - 0.5) * 0.05,
      lng: -104.9903 + (Math.random() - 0.5) * 0.08,
    };
  });

  return (
    <div className="h-screen w-screen">
      <MapViewWrapper events={testEvents} />
    </div>
  );
}
