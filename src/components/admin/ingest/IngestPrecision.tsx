'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { TabConfig } from '@/lib/conferences';
import type { IngestPrecisionResponseClient } from './types';

interface Props {
  allConferenceTabs: TabConfig[];
  password: string;
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

function PrecisionCard({ title, sampleSize, positive, precision, hint }: { title: string; sampleSize: number; positive: number; precision: number | null; hint?: string }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-1">
      <div className="text-xs text-stone-500">{title}</div>
      <div className="text-2xl font-semibold text-white">{pct(precision)}</div>
      <div className="text-xs text-stone-400">
        {positive} / {sampleSize} items
      </div>
      {hint && <div className="text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

/** Event-ingestion Precision sub-tab (Phase 2, plans/event-ingestion.md §11):
 *  precision at the publish threshold, review-queue approval rate, volume
 *  per source, LLM spend vs the monthly cap, and recent false
 *  positives/negatives for spot-checking. */
export default function IngestPrecision({ allConferenceTabs, password }: Props) {
  const [conference, setConference] = useState(allConferenceTabs[0]?.name || '');
  const [data, setData] = useState<IngestPrecisionResponseClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!conference) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ password, conference });
      const res = await fetch(`/api/admin/ingest/precision?${params}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        setData(null);
      } else {
        setData(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password, conference]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <select
        value={conference}
        onChange={(e) => setConference(e.target.value)}
        className="bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
      >
        {allConferenceTabs.map((t) => (
          <option key={t.gid} value={t.name}>{t.name}</option>
        ))}
      </select>

      {error && <p className="text-sm text-amber-400">{error}</p>}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <PrecisionCard
              title="Precision at publish (shadow)"
              sampleSize={data.shadow.sampleSize}
              positive={data.shadow.positive}
              precision={data.shadow.precision}
              hint="Among queued items that would have auto-published, the share approved. This is the auto-publish gate."
            />
            <PrecisionCard
              title="Live auto-publish precision (rolling)"
              sampleSize={data.live.sampleSize}
              positive={data.live.positive}
              precision={data.live.precision}
              hint="Most recent real auto-published items still live vs. taken down. Drives the kill switch."
            />
            <PrecisionCard
              title="Review-queue approval rate"
              sampleSize={data.review.sampleSize}
              positive={data.review.positive}
              precision={data.review.precision}
              hint="Approved / (approved + off-theme rejected), across all reviewed items."
            />
          </div>

          <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              {data.gate.eligible ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <XCircle className="w-4 h-4 text-amber-400" />
              )}
              <h3 className="text-sm font-semibold text-white">Auto-publish gate</h3>
            </div>
            <p className="text-xs text-stone-400">{data.gate.reason}</p>
            {data.profile?.auto_publish_kill_reason && (
              <p className="text-xs text-red-400">
                Kill switch fired{data.profile.auto_publish_killed_at ? ` on ${new Date(data.profile.auto_publish_killed_at).toLocaleString()}` : ''}: {data.profile.auto_publish_kill_reason}
              </p>
            )}
          </div>

          <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-white">LLM spend this month</h3>
            <p className="text-xs text-stone-400">
              ${data.budget.spentUsd.toFixed(2)} / ${data.budget.capUsd.toFixed(2)} cap
            </p>
            <div className="w-full bg-stone-800 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 ${data.budget.spentUsd >= data.budget.capUsd ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, (data.budget.spentUsd / Math.max(data.budget.capUsd, 0.01)) * 100)}%` }}
              />
            </div>
          </div>

          <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-white">Volume per source</h3>
            {data.volumeBySource.length === 0 && <p className="text-sm text-stone-500">No sources with candidates yet.</p>}
            {data.volumeBySource.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-stone-500 border-b border-stone-800">
                      <th className="py-1.5 pr-3">Source</th>
                      <th className="py-1.5 pr-3">Kind</th>
                      <th className="py-1.5 pr-3">Total</th>
                      <th className="py-1.5 pr-3">Published</th>
                      <th className="py-1.5 pr-3">Queued</th>
                      <th className="py-1.5 pr-3">Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.volumeBySource.map((s) => (
                      <tr key={s.source_id} className="border-b border-stone-900">
                        <td className="py-1.5 pr-3 text-stone-300">{s.label}</td>
                        <td className="py-1.5 pr-3 text-stone-500 text-xs">{s.kind}</td>
                        <td className="py-1.5 pr-3 text-stone-400">{s.total}</td>
                        <td className="py-1.5 pr-3 text-stone-400">{s.published}</td>
                        <td className="py-1.5 pr-3 text-stone-400">{s.queued}</td>
                        <td className="py-1.5 pr-3 text-stone-400">{s.rejected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-white">Recent false positives</h3>
              <p className="text-xs text-stone-500">Published, then taken down by an admin.</p>
              {data.falsePositives.length === 0 && <p className="text-xs text-stone-500">None recorded.</p>}
              {data.falsePositives.map((l) => (
                <div key={l.id} className="text-xs text-stone-400 border-t border-stone-800 pt-2">
                  <div className="text-stone-200">{l.example?.name ?? '(untitled)'}</div>
                  <div>score {l.model_score ?? '—'} · {new Date(l.created_at).toLocaleDateString()}{l.reason ? ` · ${l.reason}` : ''}</div>
                </div>
              ))}
            </div>
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-white">Recent false negatives</h3>
              <p className="text-xs text-stone-500">The model would have rejected it; an admin approved it anyway.</p>
              {data.falseNegatives.length === 0 && <p className="text-xs text-stone-500">None recorded.</p>}
              {data.falseNegatives.map((l) => (
                <div key={l.id} className="text-xs text-stone-400 border-t border-stone-800 pt-2">
                  <div className="text-stone-200">{l.example?.name ?? '(untitled)'}</div>
                  <div>score {l.model_score ?? '—'} · {new Date(l.created_at).toLocaleDateString()}{l.reason ? ` · ${l.reason}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
