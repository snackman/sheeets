'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import type { TabConfig } from '@/lib/conferences';
import type { IngestRunClient } from './types';
import { adminFetch } from '@/lib/admin-fetch';

interface Props {
  allConferenceTabs: TabConfig[];
  password: string;
}

const STATUS_COLOR: Record<string, string> = {
  ok: 'text-green-400',
  partial: 'text-amber-400',
  error: 'text-red-400',
  skipped: 'text-stone-500',
  running: 'text-blue-400',
};

export default function IngestLog({ allConferenceTabs, password }: Props) {
  const [runs, setRuns] = useState<IngestRunClient[]>([]);
  const [budget, setBudget] = useState<{ spentUsd: number; capUsd: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [conference, setConference] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (conference) params.set('conference', conference);
      const res = await adminFetch(`/api/admin/ingest/runs?${params}`, password);
      const json = await res.json();
      setRuns(json.runs ?? []);
      setBudget(json.budget ?? null);
    } finally {
      setLoading(false);
    }
  }, [password, conference]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={conference}
          onChange={(e) => setConference(e.target.value)}
          className="bg-stone-800 border border-stone-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">All conferences</option>
          {allConferenceTabs.map((t) => (
            <option key={t.gid} value={t.name}>{t.name}</option>
          ))}
        </select>
        {budget && (
          <span className="text-xs text-stone-400">
            This month: ${budget.spentUsd.toFixed(2)} / ${budget.capUsd.toFixed(2)} LLM budget
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
        </div>
      )}

      {!loading && runs.length === 0 && <p className="text-sm text-stone-500 py-8 text-center">No runs yet.</p>}

      {!loading && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-800">
                <th className="py-2 pr-3">Started</th>
                <th className="py-2 pr-3">Conference</th>
                <th className="py-2 pr-3">Trigger</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Counts</th>
                <th className="py-2 pr-3">Tokens</th>
                <th className="py-2 pr-3">Est. $</th>
                <th className="py-2 pr-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-stone-900">
                  <td className="py-2 pr-3 text-stone-400 whitespace-nowrap">{new Date(r.started_at).toLocaleString()}</td>
                  <td className="py-2 pr-3 text-stone-300">{r.conference}</td>
                  <td className="py-2 pr-3 text-stone-400">{r.trigger}</td>
                  <td className={`py-2 pr-3 font-medium ${STATUS_COLOR[r.status] ?? 'text-stone-300'}`}>{r.status}</td>
                  <td className="py-2 pr-3 text-stone-400 text-xs">
                    {Object.entries(r.counts || {}).map(([k, v]) => `${k}:${v}`).join(' ')}
                  </td>
                  <td className="py-2 pr-3 text-stone-400 text-xs">{r.llm_input_tokens}/{r.llm_output_tokens}</td>
                  <td className="py-2 pr-3 text-stone-400 text-xs">${Number(r.est_cost_usd).toFixed(4)}</td>
                  <td className="py-2 pr-3 text-red-400 text-xs max-w-xs truncate">{r.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
