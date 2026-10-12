'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Play, Trash2 } from 'lucide-react';
import type { TabConfig } from '@/lib/conferences';
import { inputClass, btnPrimary } from '../styles';
import type { IngestProfileClient, IngestSourceClient, IngestGateClient } from './types';

interface Props {
  allConferenceTabs: TabConfig[];
  password: string;
}

/** Human-readable labels for `ingest_sources.kind` (Phase 3 adds Telegram
 *  channels and the passive host-submission intake — §9.1/§9.3). */
const SOURCE_KIND_LABELS: Record<string, string> = {
  luma_ical: 'Luma calendar',
  telegram_channel: 'Telegram',
  host_submission: 'Host submission',
};

const THEME_PRESETS = [
  { value: 'crypto', label: 'Crypto / Web3' },
  { value: 'ai', label: 'AI / Machine Learning' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'art', label: 'Art' },
  { value: 'music', label: 'Music' },
  { value: 'tech', label: 'General Tech' },
  { value: 'custom', label: 'Custom' },
];

export default function IngestConfig({ allConferenceTabs, password }: Props) {
  const [conference, setConference] = useState(allConferenceTabs[0]?.name || '');
  const [profile, setProfile] = useState<IngestProfileClient | null>(null);
  const [sources, setSources] = useState<IngestSourceClient[]>([]);
  const [gate, setGate] = useState<IngestGateClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newThemeKey, setNewThemeKey] = useState('crypto');
  const [calendarInput, setCalendarInput] = useState('');
  const [telegramInput, setTelegramInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolvePreview, setResolvePreview] = useState<{ apiId: string; name: string | null; upcomingCount: number | null } | null>(null);
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ password, conference });
      const res = await fetch(`/api/admin/ingest/config?${params}`);
      const json = await res.json();
      const found = (json.profiles ?? []).find((p: IngestProfileClient) => p.conference === conference);
      setProfile(found ?? null);
      setSources(json.sources ?? []);
      setGate(json.gate ?? null);
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed to load'}`);
    } finally {
      setLoading(false);
    }
  }, [password, conference]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(patch: Partial<IngestProfileClient>) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ingest/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, conference, theme_key: profile?.theme_key ?? newThemeKey, ...patch }),
      });
      const json = await res.json();
      if (json.profile) {
        setProfile(json.profile);
        setMessage('Saved.');
      } else {
        setMessage(`Error: ${json.error}`);
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setSaving(false);
    }
  }

  async function enableIngestion() {
    await saveProfile({ theme_key: newThemeKey as IngestProfileClient['theme_key'], enabled: true });
  }

  async function resolveCalendar() {
    if (!calendarInput.trim()) return;
    setResolving(true);
    setResolvePreview(null);
    try {
      const params = new URLSearchParams({ password, resolveCalendar: calendarInput.trim() });
      const res = await fetch(`/api/admin/ingest/config?${params}`);
      const json = await res.json();
      if (json.resolved) {
        setResolvePreview({ apiId: json.resolved.apiId, name: json.resolved.name, upcomingCount: json.upcomingCount });
      } else {
        setMessage(`Error: ${json.error}`);
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setResolving(false);
    }
  }

  async function addSource() {
    if (!calendarInput.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/ingest/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, conference, kind: 'luma_ical', input: calendarInput.trim() }),
      });
      const json = await res.json();
      if (json.source) {
        setCalendarInput('');
        setResolvePreview(null);
        await load();
      } else {
        setMessage(`Error: ${json.error}`);
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setSaving(false);
    }
  }

  /** Phase 3 (plans/event-ingestion.md §3.4/§9.1): a Telegram channel is
   *  always `discovery` trust — the config POST route enforces this
   *  server-side too, so there's no `trust` field to pass here. */
  async function addTelegramSource() {
    if (!telegramInput.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/ingest/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, conference, kind: 'telegram_channel', input: telegramInput.trim() }),
      });
      const json = await res.json();
      if (json.source) {
        setTelegramInput('');
        await load();
      } else {
        setMessage(`Error: ${json.error}`);
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleSource(id: string, enabled: boolean) {
    await fetch('/api/admin/ingest/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, id, enabled }),
    });
    await load();
  }

  async function removeSource(id: string) {
    if (!confirm('Remove this source?')) return;
    await fetch('/api/admin/ingest/config', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, id }),
    });
    await load();
  }

  async function runNow(sourceId: string, dryRun: boolean) {
    setRunningSourceId(sourceId);
    setRunResult(null);
    try {
      const res = await fetch('/api/admin/ingest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, sourceId, dryRun }),
      });
      const json = await res.json();
      if (json.success) {
        const r = json.results?.[0];
        const countsStr = r?.counts ? Object.entries(r.counts).map(([k, v]) => `${k}:${v}`).join(' ') : '';
        setRunResult(`${dryRun ? 'Dry run' : 'Run'} ${r?.status ?? 'done'}. ${countsStr}`);
      } else {
        setRunResult(`Error: ${json.error}`);
      }
      await load();
    } catch (err) {
      setRunResult(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setRunningSourceId(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <select
        value={conference}
        onChange={(e) => setConference(e.target.value)}
        className="bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
      >
        {allConferenceTabs.map((t) => (
          <option key={t.gid} value={t.name}>{t.name}</option>
        ))}
      </select>

      {message && <p className="text-sm text-amber-400">{message}</p>}
      {loading && <Loader2 className="w-5 h-5 animate-spin text-stone-400" />}

      {!loading && !profile && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
          <p className="text-sm text-stone-300">Ingestion isn&apos;t enabled for {conference} yet.</p>
          <div className="flex items-center gap-2">
            <select
              value={newThemeKey}
              onChange={(e) => setNewThemeKey(e.target.value)}
              className="bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-sm text-white"
            >
              {THEME_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <button onClick={enableIngestion} disabled={saving} className={btnPrimary}>
              {saving ? 'Enabling…' : 'Enable ingestion'}
            </button>
          </div>
        </div>
      )}

      {!loading && profile && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Theme profile</h3>
            <label className="flex items-center gap-2 text-sm text-stone-300 cursor-pointer">
              <input
                type="checkbox"
                checked={profile.enabled}
                onChange={(e) => saveProfile({ enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={profile.theme_key}
              onChange={(e) => saveProfile({ theme_key: e.target.value as IngestProfileClient['theme_key'] })}
              className={inputClass}
            >
              {THEME_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <div className="flex flex-col gap-1">
              <label
                className={`flex items-center gap-2 text-sm text-stone-300 ${
                  !profile.auto_publish_enabled && !gate?.eligible ? 'opacity-60' : ''
                }`}
                title={!profile.auto_publish_enabled && gate ? gate.reason : undefined}
              >
                <input
                  type="checkbox"
                  checked={profile.auto_publish_enabled}
                  disabled={!profile.auto_publish_enabled && !gate?.eligible}
                  onChange={(e) => saveProfile({ auto_publish_enabled: e.target.checked })}
                />
                Auto-publish (off = shadow mode; everything routes to the queue)
              </label>
              {!profile.auto_publish_enabled && gate && (
                <p className="text-xs text-stone-500">
                  {gate.eligible ? gate.reason : `Locked: ${gate.reason}`}
                </p>
              )}
              {profile.auto_publish_kill_reason && (
                <p className="text-xs text-red-400">
                  Kill switch fired{profile.auto_publish_killed_at ? ` on ${new Date(profile.auto_publish_killed_at).toLocaleString()}` : ''}: {profile.auto_publish_kill_reason}
                </p>
              )}
            </div>
          </div>

          <textarea
            defaultValue={profile.theme_description}
            onBlur={(e) => saveProfile({ theme_description: e.target.value })}
            className={`${inputClass} h-20`}
            placeholder="Theme description shown to the classifier"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              className={inputClass}
              defaultValue={profile.include_keywords.join(', ')}
              onBlur={(e) => saveProfile({ include_keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="Include keywords, comma separated"
            />
            <input
              className={inputClass}
              defaultValue={profile.exclude_keywords.join(', ')}
              onBlur={(e) => saveProfile({ exclude_keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="Exclude keywords, comma separated"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumField label="Review threshold" value={profile.review_threshold} onSave={(v) => saveProfile({ review_threshold: v })} />
            <NumField label="Publish threshold" value={profile.publish_threshold} onSave={(v) => saveProfile({ publish_threshold: v })} />
            <NumField label="Radius (km)" value={profile.radius_km} onSave={(v) => saveProfile({ radius_km: v })} />
            <NumField label="Max $/run LLM calls" value={profile.max_llm_calls_per_run} onSave={(v) => saveProfile({ max_llm_calls_per_run: v })} />
            <NumField label="Window pre-days" value={profile.window_pre_days} onSave={(v) => saveProfile({ window_pre_days: v })} />
            <NumField label="Window post-days" value={profile.window_post_days} onSave={(v) => saveProfile({ window_post_days: v })} />
            <NumField label="Max publish/run" value={profile.max_publish_per_run} onSave={(v) => saveProfile({ max_publish_per_run: v })} />
            <label className="flex items-center gap-2 text-sm text-stone-300 self-end pb-1">
              <input type="checkbox" checked={profile.allow_online} onChange={(e) => saveProfile({ allow_online: e.target.checked })} />
              Allow online
            </label>
          </div>

          {profile.trusted_hosts.length > 0 && (
            <div className="text-xs text-stone-400">
              Trusted: {profile.trusted_hosts.map((h) => h.name).join(', ')}
            </div>
          )}
          {profile.blocked_hosts.length > 0 && (
            <div className="text-xs text-stone-400">
              Blocked: {profile.blocked_hosts.map((h) => h.name).join(', ')}
            </div>
          )}
        </div>
      )}

      {!loading && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">Sources</h3>

          <div className="flex gap-2">
            <input
              className={`${inputClass} flex-1`}
              placeholder="luma.com/<slug> or cal-… id"
              value={calendarInput}
              onChange={(e) => { setCalendarInput(e.target.value); setResolvePreview(null); }}
            />
            <button onClick={resolveCalendar} disabled={resolving} className="bg-stone-700 hover:bg-stone-600 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50">
              {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Preview'}
            </button>
            <button onClick={addSource} disabled={saving || !calendarInput.trim()} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-1">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          {resolvePreview && (
            <p className="text-xs text-stone-400">
              Resolved: {resolvePreview.name || resolvePreview.apiId} ({resolvePreview.apiId})
              {resolvePreview.upcomingCount != null && ` — ${resolvePreview.upcomingCount} upcoming events`}
            </p>
          )}

          {/* Phase 3 (plans/event-ingestion.md §3.4/§9.1): Telegram channels.
              Always discovery trust — capped at review, never auto-published
              (enforced server-side too). Accepts a handle, @handle, or a
              t.me/<handle> link. */}
          <div className="flex gap-2">
            <input
              className={`${inputClass} flex-1`}
              placeholder="Telegram channel: handle, @handle, or t.me/<handle>"
              value={telegramInput}
              onChange={(e) => setTelegramInput(e.target.value)}
            />
            <button onClick={addTelegramSource} disabled={saving || !telegramInput.trim()} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-1">
              <Plus className="w-4 h-4" /> Add channel
            </button>
          </div>

          {runResult && <p className="text-xs text-amber-300">{runResult}</p>}

          <div className="space-y-2">
            {sources.length === 0 && <p className="text-sm text-stone-500">No sources configured for {conference}.</p>}
            {sources.map((s) => (
              <div key={s.id} className="flex items-center gap-3 bg-stone-800/50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate flex items-center gap-1.5">
                    {s.label || s.kind}
                    <span className="text-[10px] uppercase tracking-wide bg-stone-700 text-stone-300 px-1.5 py-0.5 rounded">
                      {SOURCE_KIND_LABELS[s.kind] ?? s.kind}
                    </span>
                  </div>
                  <div className="text-xs text-stone-500">
                    {s.trust}
                    {s.trust === 'discovery' && ' (capped at review — never auto-published)'}
                    {' · '}
                    {s.enabled ? 'enabled' : 'disabled'}
                    {s.last_run_at && ` · last run ${new Date(s.last_run_at).toLocaleString()}`}
                    {s.last_status && ` (${s.last_status})`}
                  </div>
                </div>
                {s.kind !== 'host_submission' && (
                  <>
                    <button onClick={() => runNow(s.id, true)} disabled={runningSourceId === s.id} title="Dry run" className="text-xs bg-stone-700 hover:bg-stone-600 text-white rounded-md px-2.5 py-1.5 cursor-pointer disabled:opacity-50">
                      Dry run
                    </button>
                    <button onClick={() => runNow(s.id, false)} disabled={runningSourceId === s.id} title="Run now" className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-2.5 py-1.5 cursor-pointer disabled:opacity-50 flex items-center gap-1 text-xs">
                      {runningSourceId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run now
                    </button>
                  </>
                )}
                <button onClick={() => toggleSource(s.id, !s.enabled)} className="text-xs bg-stone-700 hover:bg-stone-600 text-white rounded-md px-2.5 py-1.5 cursor-pointer">
                  {s.enabled ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => removeSource(s.id)} className="text-stone-400 hover:text-red-400 cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  return (
    <label className="text-xs text-stone-400">
      {label}
      <input
        type="number"
        defaultValue={value}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onSave(v);
        }}
        className={`${inputClass} mt-1`}
      />
    </label>
  );
}
