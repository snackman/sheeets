'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  MapPin,
  Link2,
  RefreshCw,
  Unplug,
  Trash2,
  Loader2,
  Mail,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface ImportedEvent {
  id: string;
  event_name: string;
  event_start_at: string | null;
  event_end_at: string | null;
  location_raw: string | null;
  event_url: string | null;
  status: string | null;
  parse_confidence: number | null;
  source: string;
  created_at: string;
}

interface LumaEventHistoryProps {
  connectedEmail: string;
  onResync: () => void;
  getAuthHeaders: () => Record<string, string>;
}

export function LumaEventHistory({
  connectedEmail,
  onResync,
  getAuthHeaders,
}: LumaEventHistoryProps) {
  const { user } = useAuth();
  const [events, setEvents] = useState<ImportedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadEvents = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('imported_events')
        .select('*')
        .eq('user_id', user.id)
        .eq('source', 'gmail_luma')
        .order('event_start_at', { ascending: false, nullsFirst: false });

      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error('Failed to load events:', err);
      setErrorMessage('Failed to load imported events');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleDisconnect = async (deleteData: boolean) => {
    setDisconnecting(true);
    setShowDeleteConfirm(false);

    try {
      const res = await fetch('/api/gmail/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ deleteData }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Disconnect failed');
      }

      // Reload page to reset state
      window.location.href = '/import';
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to disconnect'
      );
      setDisconnecting(false);
    }
  };

  return (
    <div>
      {/* Connection status */}
      <div className="bg-stone-900 border border-stone-700 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center">
              <Mail className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <p className="text-white text-sm font-medium">Gmail Connected</p>
              <p className="text-stone-500 text-xs">{connectedEmail}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onResync}
              className="text-stone-400 hover:text-white text-sm flex items-center gap-1.5
                bg-stone-800 hover:bg-stone-700 rounded-lg px-3 py-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-sync
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={disconnecting}
              className="text-red-400 hover:text-red-300 text-sm flex items-center gap-1.5
                bg-stone-800 hover:bg-stone-700 rounded-lg px-3 py-1.5 transition-colors cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {disconnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Unplug className="w-3.5 h-3.5" />
              )}
              Disconnect
            </button>
          </div>
        </div>
      </div>

      {/* Disconnect confirmation dialog */}
      {showDeleteConfirm && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm font-medium mb-2">
                Disconnect Gmail?
              </p>
              <p className="text-stone-400 text-sm mb-4">
                Choose whether to keep or delete your imported event data.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleDisconnect(false)}
                  className="bg-stone-700 hover:bg-stone-600 text-white text-sm rounded-lg px-4 py-2
                    transition-colors cursor-pointer"
                >
                  Disconnect (keep data)
                </button>
                <button
                  onClick={() => handleDisconnect(true)}
                  className="bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg px-4 py-2
                    transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Disconnect &amp; delete all data
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="text-stone-500 hover:text-stone-300 text-sm px-3 py-2 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {errorMessage && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 mb-6">
          <p className="text-red-300 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Event list */}
      <div className="mb-4">
        <h2 className="text-white font-semibold text-lg">
          Imported Events{' '}
          <span className="text-stone-500 font-normal text-sm">
            ({events.length})
          </span>
        </h2>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-stone-400 animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-stone-500">No imported events yet.</p>
          <button
            onClick={onResync}
            className="text-amber-400 hover:text-amber-300 text-sm mt-2 cursor-pointer"
          >
            Sync now
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-stone-900 border border-stone-700 rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-white text-sm font-medium truncate">
                    {event.event_name || 'Untitled Event'}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                    {event.event_start_at && (
                      <span className="text-stone-400 text-xs flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(event.event_start_at)}
                      </span>
                    )}
                    {event.location_raw && (
                      <span className="text-stone-400 text-xs flex items-center gap-1 truncate max-w-[250px]">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        {event.location_raw}
                      </span>
                    )}
                    {event.event_url && (
                      <a
                        href={event.event_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-400/70 hover:text-amber-400 text-xs flex items-center gap-1"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        View on Luma
                      </a>
                    )}
                  </div>
                </div>

                {event.status && (
                  <StatusBadge status={event.status} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    approved: 'bg-green-500/10 text-green-400 border-green-500/20',
    rsvp: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    waitlist: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    unknown: 'bg-stone-800 text-stone-500 border-stone-700',
  };

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
        styles[status] || styles.unknown
      }`}
    >
      {status}
    </span>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
