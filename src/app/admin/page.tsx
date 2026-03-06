'use client';

import { useState, useEffect, useMemo } from 'react';
import { Star, Search, Loader2, ArrowLeft } from 'lucide-react';
import { fetchEvents } from '@/lib/fetch-events';
import { EVENT_TABS } from '@/lib/constants';
import type { ETHDenverEvent } from '@/lib/types';

const SESSION_KEY = 'sheeets-admin-auth';

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [events, setEvents] = useState<ETHDenverEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [conference, setConference] = useState(EVENT_TABS[0]?.name || '');
  const [search, setSearch] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Check session on mount
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === 'true') {
      setAuthed(true);
    }
  }, []);

  // Fetch events when authed
  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    fetchEvents()
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [authed]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (password === 'trusttheplan') {
      setAuthed(true);
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
  }

  const filtered = useMemo(() => {
    let list = events.filter((e) => e.conference === conference);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.organizer.toLowerCase().includes(q)
      );
    }
    // Sort: featured first, then by date + time
    return list.sort((a, b) => {
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;
      const d = a.dateISO.localeCompare(b.dateISO);
      if (d !== 0) return d;
      return a.startTime.localeCompare(b.startTime);
    });
  }, [events, conference, search]);

  async function toggleFeatured(event: ETHDenverEvent) {
    setTogglingId(event.id);
    try {
      const res = await fetch('/api/admin/toggle-featured', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'trusttheplan',
          conference: event.conference,
          eventName: event.name,
          featured: !event.isFeatured,
        }),
      });

      if (res.ok) {
        // Update local state
        setEvents((prev) =>
          prev.map((e) =>
            e.id === event.id ? { ...e, isFeatured: !e.isFeatured } : e
          )
        );
      }
    } catch {
      // ignore
    }
    setTogglingId(null);
  }

  const featuredCount = events.filter(
    (e) => e.conference === conference && e.isFeatured
  ).length;

  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm"
        >
          <h1 className="text-lg font-bold text-white mb-4">Admin Access</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500 mb-3"
            autoFocus
          />
          <button
            type="submit"
            className="w-full px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 px-4 py-3">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <a href="/" className="text-slate-400 hover:text-white transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </a>
              <h1 className="text-lg font-bold">Featured Events</h1>
              <span className="text-xs text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">
                {featuredCount} featured
              </span>
            </div>
          </div>

          {/* Conference tabs + search */}
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {EVENT_TABS.map((tab) => (
                <button
                  key={tab.gid}
                  onClick={() => setConference(tab.name)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    conference === tab.name
                      ? 'bg-orange-500 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
            </div>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg text-white text-sm pl-9 pr-3 py-1.5 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading events...
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((event) => (
              <div
                key={event.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  event.isFeatured
                    ? 'bg-orange-500/10 border border-orange-500/20'
                    : 'hover:bg-slate-800/50'
                }`}
              >
                {/* Featured toggle */}
                <button
                  onClick={() => toggleFeatured(event)}
                  disabled={togglingId === event.id}
                  className="shrink-0 cursor-pointer disabled:opacity-50"
                  title={event.isFeatured ? 'Remove featured' : 'Mark as featured'}
                >
                  {togglingId === event.id ? (
                    <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                  ) : (
                    <Star
                      className={`w-5 h-5 transition-colors ${
                        event.isFeatured
                          ? 'text-orange-400 fill-orange-400'
                          : 'text-slate-600 hover:text-slate-400'
                      }`}
                    />
                  )}
                </button>

                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {event.name}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {event.organizer && `${event.organizer} · `}
                    {event.date} · {event.startTime}
                  </p>
                </div>

                {/* Status */}
                {event.isFeatured && (
                  <span className="text-[10px] font-medium text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full shrink-0">
                    FEATURED
                  </span>
                )}
              </div>
            ))}

            {filtered.length === 0 && (
              <p className="text-center text-slate-500 py-10">No events found</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
