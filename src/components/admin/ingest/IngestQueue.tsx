'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Check, X, ShieldCheck, ShieldOff, ExternalLink, RotateCcw, Sparkles } from 'lucide-react';
import type { TabConfig } from '@/lib/conferences';
import { inputClass } from '../styles';
import { isSafeHttpUrl } from '@/lib/utils';
import type { IngestCandidateClient } from './types';
import { REJECT_REASON_OPTIONS } from './types';
import { adminFetch } from '@/lib/admin-fetch';

interface Props {
  allConferenceTabs: TabConfig[];
  password: string;
}

type StatusFilter = 'queued' | 'auto_published' | 'auto_rejected' | 'approved' | 'rejected' | 'duplicate' | 'error' | 'all';

const STATUS_TABS: StatusFilter[] = ['queued', 'auto_published', 'auto_rejected', 'approved', 'rejected', 'duplicate', 'error', 'all'];

const STATUS_BADGE: Record<string, string> = {
  queued: 'bg-amber-500/20 text-amber-400',
  auto_published: 'bg-green-500/20 text-green-400',
  approved: 'bg-green-500/20 text-green-400',
  auto_rejected: 'bg-red-500/20 text-red-400',
  rejected: 'bg-red-500/20 text-red-400',
  duplicate: 'bg-stone-700 text-stone-300',
  error: 'bg-red-600/30 text-red-300',
  unpublished: 'bg-stone-700 text-stone-300',
  unpublished_external: 'bg-stone-700 text-stone-300',
  filtered_out: 'bg-stone-700 text-stone-300',
  pending_classify: 'bg-stone-700 text-stone-300',
};

/** Human-readable source badge (Phase 3 — "see the submission source in the
 *  Queue", plan §7 item 4). Any kind not listed just shows its raw value. */
const SOURCE_KIND_LABELS: Record<string, string> = {
  luma_ical: 'Luma calendar',
  telegram_channel: 'Telegram',
  host_submission: 'Host submission',
};

function scorePillClass(score: number | null, publishThreshold = 85, reviewThreshold = 40): string {
  if (score == null) return 'bg-stone-700 text-stone-300';
  if (score >= publishThreshold) return 'bg-green-500/20 text-green-400';
  if (score >= reviewThreshold) return 'bg-amber-500/20 text-amber-400';
  return 'bg-red-500/20 text-red-400';
}

export default function IngestQueue({ allConferenceTabs, password }: Props) {
  const [candidates, setCandidates] = useState<IngestCandidateClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('queued');
  const [conferenceFilter, setConferenceFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingReject, setPendingReject] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      if (conferenceFilter) params.set('conference', conferenceFilter);
      const res = await adminFetch(`/api/admin/ingest/queue?${params}`, password);
      const json = await res.json();
      setCandidates(json.candidates ?? []);
      setNote(json.error ? `Error: ${json.error}` : null);
      setSelected(new Set());
    } catch (err) {
      setNote(`Error: ${err instanceof Error ? err.message : 'Failed to load'}`);
    } finally {
      setLoading(false);
    }
  }, [password, statusFilter, conferenceFilter]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const runAction = useCallback(
    async (ids: string[], action: string, extra?: { reason?: string; note?: string; edits?: Record<string, unknown> }) => {
      // In-flight guard: never fire the same (or any) action while one is
      // already running — a double 'a' press or a double-click must not
      // send a second request for a candidate that's already mid-approve
      // (review finding, HIGH item 3).
      if (actionLoading) return;
      setActionLoading(ids.join(','));
      try {
        const res = await fetch('/api/admin/ingest/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, action, ids, ...extra }),
        });
        const json = await res.json();
        const results: { id: string; ok: boolean; error?: string }[] = json.results ?? [];
        const okIds = results.filter((r) => r.ok).map((r) => r.id);
        const failures = results.filter((r) => !r.ok);

        // Remove whatever actually succeeded, even on a partial failure —
        // the old all-or-nothing `json.success` check left successfully
        // approved/rejected items sitting in the list looking untouched
        // (review finding, HIGH item 3).
        if (okIds.length > 0) {
          setCandidates((prev) => prev.filter((c) => !okIds.includes(c.id)));
          setSelected((prev) => {
            const next = new Set(prev);
            for (const id of okIds) next.delete(id);
            return next;
          });
        }

        if (!json.success || failures.length > 0) {
          const message =
            json.error ||
            failures.map((f) => `${f.id}: ${f.error}`).join('\n') ||
            'Unknown error';
          alert(`Failed:\n${message}`);
        }
        if (failures.length === 0) {
          setPendingReject(null);
          setEditingId(null);
        }
      } catch (err) {
        alert(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      } finally {
        setActionLoading(null);
      }
    },
    [password, actionLoading]
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeIndex = useMemo(() => candidates.findIndex((c) => c.id === activeId), [candidates, activeId]);

  // Keyboard shortcuts (§9.2): j/k move, a approve, r reject off-theme, e edit.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (candidates.length === 0) return;
      if (e.key === 'j') {
        e.preventDefault();
        setActiveId(candidates[Math.min(candidates.length - 1, activeIndex + 1)]?.id ?? candidates[0].id);
      } else if (e.key === 'k') {
        e.preventDefault();
        setActiveId(candidates[Math.max(0, activeIndex - 1)]?.id ?? candidates[0].id);
      } else if (e.key === 'a' && activeId) {
        e.preventDefault();
        // In-flight guard + only from the Queued filter (review finding,
        // HIGH item 3) — approving from another filter (e.g. "All") risks
        // approving something that isn't actually in an approvable status.
        if (actionLoading || statusFilter !== 'queued') return;
        runAction([activeId], 'approve');
      } else if (e.key === 'r' && activeId) {
        e.preventDefault();
        // Reject only from the Queued filter too — the server now rejects
        // the request outright for anything already final (review
        // finding, MEDIUM item 2); keep the shortcut from even trying.
        if (actionLoading || statusFilter !== 'queued') return;
        runAction([activeId], 'reject', { reason: 'off_theme' });
      } else if (e.key === 'e' && activeId) {
        e.preventDefault();
        if (actionLoading) return;
        setEditingId(activeId);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [candidates, activeIndex, activeId, runAction, actionLoading, statusFilter]);

  const selectedIds = Array.from(selected);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 bg-stone-900 rounded-lg p-1">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === s ? 'bg-stone-800 text-white' : 'text-stone-400 hover:text-white'
              }`}
            >
              {s.replace(/_/g, ' ')}
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
        <span className="text-xs text-stone-500">j/k move · a approve · r reject (off-theme) · e edit</span>
      </div>

      {note && <p className="text-sm text-amber-400">{note}</p>}

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 bg-stone-900 border border-stone-700 rounded-lg px-3 py-2">
          <span className="text-sm text-stone-300">{selectedIds.length} selected</span>
          {/* Approve only from the Queued filter (review finding, HIGH item
              3) — every other filter can contain statuses that aren't
              actually approvable server-side. */}
          {statusFilter === 'queued' && (
            <button
              onClick={() => runAction(selectedIds, 'approve')}
              disabled={actionLoading !== null}
              className="text-xs bg-green-600 hover:bg-green-700 text-white rounded-md px-2.5 py-1 cursor-pointer disabled:opacity-50"
            >
              Approve selected
            </button>
          )}
          {/* Reject only from the Queued filter (review finding, MEDIUM
              item 2) — the server now refuses to reject anything already
              final. */}
          {statusFilter === 'queued' && (
            <button
              onClick={() => runAction(selectedIds, 'reject', { reason: 'off_theme' })}
              disabled={actionLoading !== null}
              className="text-xs bg-red-600 hover:bg-red-700 text-white rounded-md px-2.5 py-1 cursor-pointer disabled:opacity-50"
            >
              Reject selected (off-theme)
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
        </div>
      )}

      {!loading && candidates.length === 0 && (
        <div className="text-center py-12 text-stone-500">
          <p className="text-lg">No {statusFilter === 'all' ? '' : statusFilter.replace(/_/g, ' ')} candidates</p>
          <p className="text-sm mt-1">Run a Luma calendar source from the Config tab to populate this queue.</p>
        </div>
      )}

      {!loading &&
        candidates.map((c) => {
          const isActioning = actionLoading?.split(',').includes(c.id);
          const isActive = activeId === c.id;
          const isEditing = editingId === c.id;
          const isPendingReject = pendingReject === c.id;

          return (
            <div
              key={c.id}
              className={`bg-stone-900 border rounded-xl overflow-hidden ${isActive ? 'border-blue-500' : 'border-stone-800'}`}
            >
              <div className="px-4 py-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleSelect(c.id)}
                  className="mt-1 cursor-pointer"
                />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setActiveId(c.id)}>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    {c.event.link && isSafeHttpUrl(c.event.link) ? (
                      <a
                        href={c.event.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-white hover:text-blue-300 inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.event.name} <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="font-medium text-white">{c.event.name}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[c.status] ?? 'bg-stone-700 text-stone-300'}`}>{c.status}</span>
                    <span className="text-xs bg-stone-800 text-stone-400 px-2 py-0.5 rounded-full">{c.conference}</span>
                    <span className="text-xs bg-stone-800 text-stone-400 px-2 py-0.5 rounded-full">{SOURCE_KIND_LABELS[c.source_kind] ?? c.source_kind}</span>
                    {c.final_score != null && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${scorePillClass(c.final_score)}`}>score {c.final_score}</span>
                    )}
                    {c.possible_duplicate_of && (
                      <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">possible dup</span>
                    )}
                    {c.llm_flags?.includes('instructions_in_content') && (
                      <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">injection flag</span>
                    )}
                  </div>
                  <div className="text-sm text-stone-400">
                    {c.event.sheetDate} · {c.event.startTime} {c.event.address ? `· ${c.event.address}` : ''}
                    {c.event.organizer ? ` · ${c.event.organizer}` : ''}
                  </div>
                  {c.llm_reason && <div className="text-sm text-stone-300 mt-1">{c.llm_reason}</div>}
                  {Object.keys(c.signal_breakdown || {}).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(c.signal_breakdown).map(([label, points]) => (
                        <span key={label} className="text-xs bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded">
                          {label} {points > 0 ? '+' : ''}{points}
                        </span>
                      ))}
                    </div>
                  )}
                  {c.llm_tags && c.llm_tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {c.llm_tags.map((t) => (
                        <span key={t} className="text-xs bg-blue-500/10 text-blue-300 px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-1.5 shrink-0">
                  {['queued', 'auto_rejected', 'error', 'pending_classify'].includes(c.status) && (
                    <>
                      {/* Approve (and edit-then-approve) only from the Queued
                          filter (review finding, HIGH item 3) — viewing
                          "Error"/"Auto-rejected"/"All" shouldn't offer a
                          one-click approve on something that needed a closer
                          look to get there. */}
                      {statusFilter === 'queued' && (
                        <>
                          <button
                            onClick={() => runAction([c.id], 'approve')}
                            disabled={isActioning}
                            title="Approve"
                            className="bg-green-600 hover:bg-green-700 text-white rounded-lg p-2 cursor-pointer disabled:opacity-50"
                          >
                            {isActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => setEditingId(isEditing ? null : c.id)}
                            disabled={isActioning}
                            title="Edit & approve"
                            className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg px-2 py-2 text-xs cursor-pointer disabled:opacity-50"
                          >
                            Edit
                          </button>
                        </>
                      )}
                      {/* Reject only from the Queued filter (review
                          finding, MEDIUM item 2) — published events must
                          go through Unpublish instead. */}
                      {statusFilter === 'queued' && (
                        <button
                          onClick={() => setPendingReject(isPendingReject ? null : c.id)}
                          disabled={isActioning}
                          title="Reject"
                          className="bg-red-600 hover:bg-red-700 text-white rounded-lg p-2 cursor-pointer disabled:opacity-50"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => runAction([c.id], 'rescore')}
                        disabled={isActioning}
                        title="Re-score"
                        className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg p-2 cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {(c.status === 'auto_published' || c.status === 'approved') && (
                    <button
                      onClick={() => runAction([c.id], 'unpublish')}
                      disabled={isActioning}
                      title="Unpublish"
                      className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-2.5 py-2 text-xs cursor-pointer disabled:opacity-50"
                    >
                      Unpublish
                    </button>
                  )}
                  {['rejected', 'auto_rejected'].includes(c.status) && (
                    <button
                      onClick={() => runAction([c.id], 'restore')}
                      disabled={isActioning}
                      title="Restore to queue"
                      className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg p-2 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => runAction([c.id], 'trust_host')}
                    disabled={isActioning}
                    title="Trust host"
                    className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg p-2 cursor-pointer disabled:opacity-50"
                  >
                    <ShieldCheck className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => runAction([c.id], 'block_host')}
                    disabled={isActioning}
                    title="Block host"
                    className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg p-2 cursor-pointer disabled:opacity-50"
                  >
                    <ShieldOff className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {isPendingReject && (
                <div className="border-t border-stone-800 px-4 py-3 flex flex-wrap gap-2">
                  {REJECT_REASON_OPTIONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => runAction([c.id], 'reject', { reason: r.value })}
                      className="text-xs bg-stone-800 hover:bg-red-600 text-stone-300 hover:text-white px-2.5 py-1.5 rounded-md cursor-pointer"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}

              {isEditing && (
                <div className="border-t border-stone-800 px-4 py-3 space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input className={inputClass} placeholder="Name" defaultValue={c.event.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} />
                    <input className={inputClass} placeholder="Date (e.g. Oct 14)" defaultValue={c.event.sheetDate} onChange={(e) => setEditDraft((d) => ({ ...d, date: e.target.value }))} />
                    <input className={inputClass} placeholder="Start time" defaultValue={c.event.startTime} onChange={(e) => setEditDraft((d) => ({ ...d, startTime: e.target.value }))} />
                    <input className={inputClass} placeholder="Organizer" defaultValue={c.event.organizer} onChange={(e) => setEditDraft((d) => ({ ...d, organizer: e.target.value }))} />
                    <input className={inputClass} placeholder="Address" defaultValue={c.event.address} onChange={(e) => setEditDraft((d) => ({ ...d, address: e.target.value }))} />
                    <input className={inputClass} placeholder="Cost" defaultValue={c.event.cost} onChange={(e) => setEditDraft((d) => ({ ...d, cost: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => runAction([c.id], 'approve', { edits: editDraft })}
                      disabled={isActioning}
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50"
                    >
                      Save & approve
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setEditDraft({}); }}
                      className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg px-3 py-2 text-sm cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
