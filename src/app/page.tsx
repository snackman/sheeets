'use client';

import { useEvents } from '@/hooks/useEvents';

export default function Home() {
  const { events, loading, error } = useEvents();

  if (loading) return <div className="p-8 text-white">Loading events...</div>;
  if (error) return <div className="p-8 text-red-500">Error: {error}</div>;

  const vibes = [...new Set(events.map(e => e.vibe).filter(Boolean))].sort();
  const dates = [...new Set(events.map(e => e.dateISO).filter(Boolean))].sort();

  return (
    <div className="p-8 bg-gray-900 text-white min-h-screen">
      <h1 className="text-3xl font-bold mb-4">ETHDenver 2025 Side Events</h1>
      <p className="mb-2">Total events: {events.length}</p>
      <p className="mb-2">Dates: {dates.join(', ')}</p>
      <p className="mb-2">Vibes: {vibes.join(', ')}</p>
      <p className="mb-4">Events with addresses: {events.filter(e => e.address).length}</p>

      <h2 className="text-xl font-bold mb-2">First 10 Events:</h2>
      <div className="space-y-2">
        {events.slice(0, 10).map(event => (
          <div key={event.id} className="p-3 bg-gray-800 rounded">
            <div className="font-bold">{event.name}</div>
            <div className="text-sm text-gray-400">
              {event.date} · {event.startTime} · {event.vibe} · {event.address}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
