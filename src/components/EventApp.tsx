'use client';

import { useState } from 'react';
import { ViewMode } from '@/lib/types';
import { useEvents } from '@/hooks/useEvents';
import { Header } from './Header';
import { ListView } from './ListView';
import { MapViewWrapper } from './MapViewWrapper';
import { Loading } from './Loading';

export function EventApp() {
  const { events, loading, error } = useEvents();
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900">
        <Header viewMode={viewMode} onViewChange={setViewMode} itineraryCount={0} />
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900">
        <Header viewMode={viewMode} onViewChange={setViewMode} itineraryCount={0} />
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 px-4">
          <div className="text-red-400 text-lg font-medium">Failed to load events</div>
          <p className="text-slate-500 text-sm text-center max-w-md">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      <Header
        viewMode={viewMode}
        onViewChange={setViewMode}
        itineraryCount={0}
      />

      {/* Event count bar */}
      <div className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-2">
          <p className="text-sm text-slate-400">
            Showing <span className="text-white font-medium">{events.length}</span> events
          </p>
        </div>
      </div>

      {/* Main content area */}
      <main>
        {viewMode === 'list' ? (
          <ListView events={events} totalCount={events.length} />
        ) : (
          <div className="h-[calc(100vh-110px)]">
            <MapViewWrapper events={events} />
          </div>
        )}
      </main>
    </div>
  );
}
