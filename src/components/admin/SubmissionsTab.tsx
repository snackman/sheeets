'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Check, X, Pencil, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import type { Submission } from '@/lib/types';

interface TabConfig {
  gid: number;
  name: string;
  slug: string;
  timezone: string;
  dates: string[];
  center: { lat: number; lng: number };
}

interface Props {
  allConferenceTabs: TabConfig[];
  password: string;
}

const inputClass = 'bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-white text-sm w-full focus:border-blue-500 focus:outline-none';
const btnPrimary = 'bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer';
const btnDanger = 'bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer';

function timeAgo(date: string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
};

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

const EDITABLE_FIELDS: { key: string; label: string; type: 'text' | 'boolean' }[] = [
  { key: 'event_name', label: 'Name', type: 'text' },
  { key: 'event_date', label: 'Date', type: 'text' },
  { key: 'start_time', label: 'Start Time', type: 'text' },
  { key: 'end_time', label: 'End Time', type: 'text' },
  { key: 'organizer', label: 'Organizer', type: 'text' },
  { key: 'address', label: 'Address', type: 'text' },
  { key: 'cost', label: 'Cost', type: 'text' },
  { key: 'tags', label: 'Tags', type: 'text' },
  { key: 'link', label: 'Link', type: 'text' },
  { key: 'has_food', label: 'Food', type: 'boolean' },
  { key: 'has_bar', label: 'Bar', type: 'boolean' },
  { key: 'note', label: 'Note', type: 'text' },
];

export default function SubmissionsTab({ allConferenceTabs, password }: Props) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [conferenceFilter, setConferenceFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string | boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const pendingCount = submissions.filter((s) => s.status === 'pending').length;

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ password, status: statusFilter });
      if (conferenceFilter) params.set('conference', conferenceFilter);
      const res = await fetch(`/api/admin/submissions?${params}`);
      const json = await res.json();
      if (json.submissions) {
        setSubmissions(json.submissions);
      }
    } catch (err) {
      console.error('Failed to fetch submissions:', err);
    } finally {
      setLoading(false);
    }
  }, [password, statusFilter, conferenceFilter]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const handleApprove = async (id: string, edits?: Record<string, string | boolean>) => {
    setActionLoading(id);
    try {
      const body: Record<string, unknown> = { password, action: 'approve', id };
      if (edits) body.edits = edits;
      const res = await fetch('/api/admin/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setEditingId(null);
        setExpandedId(null);
        await fetchSubmissions();
      } else {
        alert(`Failed: ${json.error}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch('/api/admin/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          action: 'reject',
          id,
          rejection_reason: rejectReason || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setRejectingId(null);
        setRejectReason('');
        setExpandedId(null);
        await fetchSubmissions();
      } else {
        alert(`Failed: ${json.error}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const startEditing = (sub: Submission) => {
    setEditingId(sub.id);
    const fields: Record<string, string | boolean> = {};
    for (const f of EDITABLE_FIELDS) {
      fields[f.key] = sub[f.key as keyof Submission] as string | boolean;
    }
    setEditFields(fields);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditFields({});
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Top bar: status filters + conference dropdown */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-stone-900 rounded-lg p-1">
          {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                statusFilter === s
                  ? 'bg-stone-800 text-white'
                  : 'text-stone-400 hover:text-white'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === 'pending' && statusFilter === 'pending' && pendingCount > 0 && (
                <span className="ml-1.5 bg-amber-500/20 text-amber-400 text-xs px-1.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <select
          value={conferenceFilter}
          onChange={(e) => setConferenceFilter(e.target.value)}
          className="bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">All conferences</option>
          {allConferenceTabs.map((t) => (
            <option key={t.gid} value={t.name}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
        </div>
      )}

      {/* Empty state */}
      {!loading && submissions.length === 0 && (
        <div className="text-center py-12 text-stone-500">
          <p className="text-lg">No {statusFilter === 'all' ? '' : statusFilter} submissions</p>
          <p className="text-sm mt-1">Submissions from the Add Event form will appear here.</p>
        </div>
      )}

      {/* Submissions list */}
      {!loading && submissions.map((sub) => {
        const isExpanded = expandedId === sub.id;
        const isEditing = editingId === sub.id;
        const isRejecting = rejectingId === sub.id;
        const isActioning = actionLoading === sub.id;

        return (
          <div
            key={sub.id}
            className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden"
          >
            {/* Collapsed card header */}
            <button
              onClick={() => {
                setExpandedId(isExpanded ? null : sub.id);
                if (isExpanded) {
                  setEditingId(null);
                  setRejectingId(null);
                }
              }}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-stone-800/50 transition-colors cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-white truncate">{sub.event_name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[sub.status]}`}>
                    {sub.status}
                  </span>
                  <span className="text-xs bg-stone-700 text-stone-300 px-2 py-0.5 rounded-full">
                    {sub.conference}
                  </span>
                </div>
                <div className="text-sm text-stone-400 truncate">
                  {sub.event_date}{sub.start_time ? ` at ${sub.start_time}` : ''}{sub.organizer ? ` -- ${sub.organizer}` : ''}
                </div>
              </div>
              <span className="text-xs text-stone-500 whitespace-nowrap">{timeAgo(sub.created_at)}</span>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-stone-500 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-500 shrink-0" />
              )}
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t border-stone-800 px-4 py-4 space-y-4">
                {/* Field grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {EDITABLE_FIELDS.map((f) => {
                    const value = isEditing
                      ? editFields[f.key]
                      : (sub[f.key as keyof Submission] as string | boolean);

                    return (
                      <div key={f.key}>
                        <label className="text-xs text-stone-500 uppercase tracking-wide mb-1 block">
                          {f.label}
                        </label>
                        {isEditing ? (
                          f.type === 'boolean' ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={value as boolean}
                                onChange={(e) =>
                                  setEditFields((prev) => ({ ...prev, [f.key]: e.target.checked }))
                                }
                                className="rounded border-stone-600 bg-stone-800"
                              />
                              <span className="text-sm text-white">{value ? 'Yes' : 'No'}</span>
                            </label>
                          ) : (
                            <input
                              type="text"
                              value={value as string}
                              onChange={(e) =>
                                setEditFields((prev) => ({ ...prev, [f.key]: e.target.value }))
                              }
                              className={inputClass}
                            />
                          )
                        ) : f.type === 'boolean' ? (
                          <span className={`text-sm ${value ? 'text-green-400' : 'text-stone-500'}`}>
                            {value ? 'Yes' : 'No'}
                          </span>
                        ) : f.key === 'link' && value ? (
                          <a
                            href={value as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate"
                          >
                            {value as string}
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-sm text-white">{(value as string) || '--'}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Coords info */}
                {(sub.coords_lat || sub.coords_lng) && (
                  <div className="text-xs text-stone-500">
                    Coords: {sub.coords_lat}, {sub.coords_lng}
                  </div>
                )}

                {/* Rejection reason (if rejected) */}
                {sub.status === 'rejected' && sub.rejection_reason && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <span className="text-xs text-red-400 uppercase tracking-wide">Rejection reason:</span>
                    <p className="text-sm text-red-300 mt-1">{sub.rejection_reason}</p>
                  </div>
                )}

                {/* Approved info */}
                {sub.status === 'approved' && sub.sheet_row && (
                  <div className="text-xs text-green-400">
                    Written to sheet row {sub.sheet_row}
                    {sub.reviewed_at && ` -- ${timeAgo(sub.reviewed_at)}`}
                  </div>
                )}

                {/* Action buttons (only for pending) */}
                {sub.status === 'pending' && !isEditing && !isRejecting && (
                  <div className="flex gap-2 pt-2 border-t border-stone-800">
                    <button
                      onClick={() => handleApprove(sub.id)}
                      disabled={isActioning}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Approve
                    </button>
                    <button
                      onClick={() => startEditing(sub)}
                      className={btnPrimary + ' flex items-center gap-1.5'}
                    >
                      <Pencil className="w-4 h-4" />
                      Edit & Approve
                    </button>
                    <button
                      onClick={() => setRejectingId(sub.id)}
                      className={btnDanger + ' flex items-center gap-1.5'}
                    >
                      <X className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                )}

                {/* Edit mode actions */}
                {isEditing && (
                  <div className="flex gap-2 pt-2 border-t border-stone-800">
                    <button
                      onClick={() => handleApprove(sub.id, editFields)}
                      disabled={isActioning}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save & Approve
                    </button>
                    <button
                      onClick={cancelEditing}
                      className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Reject mode */}
                {isRejecting && (
                  <div className="space-y-2 pt-2 border-t border-stone-800">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection (optional)"
                      className={inputClass}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReject(sub.id)}
                        disabled={isActioning}
                        className={btnDanger + ' flex items-center gap-1.5 disabled:opacity-50'}
                      >
                        {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                        Confirm Reject
                      </button>
                      <button
                        onClick={() => {
                          setRejectingId(null);
                          setRejectReason('');
                        }}
                        className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
