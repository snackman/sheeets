'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Play, Trash2, Check, X } from 'lucide-react';
import type { TabConfig } from '@/lib/conferences';
import { inputClass, btnPrimary } from '../styles';
import type {
  IngestProfileClient,
  IngestSourceClient,
  IngestGateClient,
  IngestSourceAvailabilityClient,
  MiraSeriesMenuItemClient,
  IngestSourceProposalClient,
} from './types';
import { adminFetch } from '@/lib/admin-fetch';

interface Props {
  allConferenceTabs: TabConfig[];
  password: string;
}

/** Human-readable labels for `ingest_sources.kind` (Phase 3 added Telegram
 *  channels and the passive host-submission intake; Phase 4 added X
 *  accounts, Meetup searches and sponsor event pages — §9.1/§9.3). */
const SOURCE_KIND_LABELS: Record<string, string> = {
  luma_ical: 'Luma calendar',
  telegram_channel: 'Telegram',
  host_submission: 'Host submission',
  x_account: 'X account',
  meetup_search: 'Meetup search',
  sponsor_pages: 'Sponsor pages',
  mira_series: 'Mira series',
  sheet_tracker: 'Sheet tracker',
};

/** Why a source kind that needs credentials is shown as unavailable (§9.1
 *  item 4: "Each source type shows whether it's configured"). */
const UNAVAILABLE_REASON: Record<string, string> = {
  x_account: 'not configured — set X_BEARER_TOKEN',
  meetup_search: 'requires Meetup Pro — set MEETUP_CLIENT_ID/MEETUP_CLIENT_SECRET/MEETUP_REFRESH_TOKEN',
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
  const [availability, setAvailability] = useState<IngestSourceAvailabilityClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newThemeKey, setNewThemeKey] = useState('crypto');
  const [calendarInput, setCalendarInput] = useState('');
  const [telegramInput, setTelegramInput] = useState('');
  const [xInput, setXInput] = useState('');
  const [meetupInput, setMeetupInput] = useState('');
  const [sponsorPagesInput, setSponsorPagesInput] = useState('');
  const [miraInput, setMiraInput] = useState('');
  const [miraSeriesMenu, setMiraSeriesMenu] = useState<MiraSeriesMenuItemClient[] | null>(null);
  const [sheetTrackerInput, setSheetTrackerInput] = useState('');
  const [proposals, setProposals] = useState<IngestSourceProposalClient[]>([]);
  const [decidingProposalId, setDecidingProposalId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvePreview, setResolvePreview] = useState<{ apiId: string; name: string | null; upcomingCount: number | null } | null>(null);
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ conference });
      const [res, proposalsRes] = await Promise.all([
        adminFetch(`/api/admin/ingest/config?${params}`, password),
        adminFetch(`/api/admin/ingest/source-proposals?${params}`, password),
      ]);
      const json = await res.json();
      const found = (json.profiles ?? []).find((p: IngestProfileClient) => p.conference === conference);
      setProfile(found ?? null);
      setSources(json.sources ?? []);
      setGate(json.gate ?? null);
      setAvailability(json.sourceAvailability ?? null);
      const proposalsJson = await proposalsRes.json();
      setProposals(proposalsJson.proposals ?? []);
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed to load'}`);
    } finally {
      setLoading(false);
    }
  }, [password, conference]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMiraSeriesMenu() {
    if (miraSeriesMenu) return; // fetched once per page load — the list barely changes.
    try {
      const params = new URLSearchParams({ listMiraSeries: '1' });
      const res = await adminFetch(`/api/admin/ingest/config?${params}`, password);
      const json = await res.json();
      setMiraSeriesMenu(json.series ?? []);
    } catch {
      setMiraSeriesMenu([]);
    }
  }

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
      const params = new URLSearchParams({ resolveCalendar: calendarInput.trim() });
      const res = await adminFetch(`/api/admin/ingest/config?${params}`, password);
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

  /** Shared "add a discovery-trust source" flow for X/Meetup/sponsor pages/
   *  Mira/sheet trackers — always discovery trust, enforced server-side
   *  too, so there's no `trust` field to pass, same as
   *  `addTelegramSource`. */
  async function addSimpleSource(kind: 'x_account' | 'meetup_search' | 'sponsor_pages' | 'mira_series' | 'sheet_tracker', input: string, onSuccess: () => void) {
    if (!input.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/ingest/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, conference, kind, input: input.trim() }),
      });
      const json = await res.json();
      if (json.source) {
        onSuccess();
        if (json.warning) setMessage(json.warning);
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

  async function decideProposal(id: string, decision: 'accepted' | 'dismissed') {
    setDecidingProposalId(id);
    try {
      const res = await fetch('/api/admin/ingest/source-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, id, decision }),
      });
      const json = await res.json();
      if (!json.success) setMessage(`Error: ${json.error}`);
      // Minor review finding: Accept re-enables an existing-but-disabled
      // source rather than silently leaving it off — surface that so an
      // admin isn't left wondering why "accepted" didn't seem to do much.
      else if (json.reenabled) setMessage('Accepted — this source already existed and was disabled, so it has been re-enabled.');
      await load();
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setDecidingProposalId(null);
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

          {/* Phase 4 item 1 (§3.7/§9.1): X accounts. Always discovery
              trust. Disabled unless X_BEARER_TOKEN is set — shown as a
              "not configured" badge rather than hiding the control, so
              Snax can see what's missing. */}
          <div className="flex gap-2 items-center">
            <input
              className={`${inputClass} flex-1`}
              placeholder="X account: handle, @handle, or x.com/<handle>"
              value={xInput}
              onChange={(e) => setXInput(e.target.value)}
            />
            <button
              onClick={() => addSimpleSource('x_account', xInput, () => setXInput(''))}
              disabled={saving || !xInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add account
            </button>
            {availability && !availability.x_account && (
              <span className="text-[10px] uppercase tracking-wide bg-amber-900/60 text-amber-300 px-1.5 py-0.5 rounded whitespace-nowrap">
                not configured
              </span>
            )}
          </div>

          {/* Phase 4 item 3 (§3.3/§9.1): Meetup search. Always discovery
              trust. Disabled unless Meetup OAuth credentials are set. */}
          <div className="flex gap-2 items-center">
            <input
              className={`${inputClass} flex-1`}
              placeholder="Meetup search: topic keyword (e.g. defi, ai builders)"
              value={meetupInput}
              onChange={(e) => setMeetupInput(e.target.value)}
            />
            <button
              onClick={() => addSimpleSource('meetup_search', meetupInput, () => setMeetupInput(''))}
              disabled={saving || !meetupInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add search
            </button>
            {availability && !availability.meetup_search && (
              <span className="text-[10px] uppercase tracking-wide bg-amber-900/60 text-amber-300 px-1.5 py-0.5 rounded whitespace-nowrap">
                requires Meetup Pro
              </span>
            )}
          </div>

          {/* Phase 4 item 2 (§3.6/§9.1): sponsor event pages. Always
              discovery trust. Needs no credentials — one or more URLs
              (one per line), or "*" to discover pages from this
              conference's sponsors' own websites automatically. */}
          <div className="flex gap-2 items-start">
            <textarea
              className={`${inputClass} flex-1 h-16`}
              placeholder={'Sponsor event pages: one URL per line, or "*" to discover from sponsors'}
              value={sponsorPagesInput}
              onChange={(e) => setSponsorPagesInput(e.target.value)}
            />
            <button
              onClick={() => addSimpleSource('sponsor_pages', sponsorPagesInput, () => setSponsorPagesInput(''))}
              disabled={saving || !sponsorPagesInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-1 self-start"
            >
              <Plus className="w-4 h-4" /> Add pages
            </button>
          </div>

          {/* Mira (miragather.com) series. Always discovery trust. Needs
              no credentials — a series slug, a miragather.com/<slug> link,
              or pick one from the dropdown (populated on first focus). */}
          <div className="flex gap-2 items-center">
            <input
              className={`${inputClass} flex-1`}
              placeholder="Mira series: slug or miragather.com/<slug>"
              value={miraInput}
              onChange={(e) => setMiraInput(e.target.value)}
              onFocus={loadMiraSeriesMenu}
              list="mira-series-menu"
            />
            {miraSeriesMenu && (
              <datalist id="mira-series-menu">
                {miraSeriesMenu.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.title} — {s.location ?? ''} ({s.numEvents ?? 0} events)
                  </option>
                ))}
              </datalist>
            )}
            <button
              onClick={() => addSimpleSource('mira_series', miraInput, () => setMiraInput(''))}
              disabled={saving || !miraInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add series
            </button>
          </div>

          {/* Public community-tracker Google Sheet. Always discovery
              trust. Needs no credentials — a sheet id or a full
              docs.google.com/spreadsheets/d/<id>/... link (optionally with
              gid=; defaults to the first tab). */}
          <div className="flex gap-2 items-center">
            <input
              className={`${inputClass} flex-1`}
              placeholder="Sheet tracker: sheet id or docs.google.com/spreadsheets/d/<id>/... link"
              value={sheetTrackerInput}
              onChange={(e) => setSheetTrackerInput(e.target.value)}
            />
            <button
              onClick={() => addSimpleSource('sheet_tracker', sheetTrackerInput, () => setSheetTrackerInput(''))}
              disabled={saving || !sheetTrackerInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add sheet
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
                    {availability && availability[s.kind as keyof IngestSourceAvailabilityClient] === false && (
                      <span className="text-amber-400"> · {UNAVAILABLE_REASON[s.kind] ?? 'not configured'}</span>
                    )}
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

      {/* Calendar auto-discovery (daily job, plan item 3): calendars the
          daily job found with enough in-window events for this conference
          but that aren't configured as a source yet. Accept creates a real
          curated `luma_ical` source; Dismiss is permanent — a dismissed
          calendar is never re-proposed, no matter how many future runs
          still find it eligible. */}
      {!loading && proposals.length > 0 && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">Proposed sources</h3>
          <div className="space-y-2">
            {proposals.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-stone-800/50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{p.calendar_name || p.calendar_api_id}</div>
                  <div className="text-xs text-stone-500">
                    {p.evidence.inWindowCount} in-window event{p.evidence.inWindowCount === 1 ? '' : 's'}
                    {' · '}
                    {p.evidence.newCount} not yet discovered
                  </div>
                  {p.evidence.sample.length > 0 && (
                    <div className="text-xs text-stone-600 truncate">
                      e.g. {p.evidence.sample.map((s) => s.name).join(', ')}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => decideProposal(p.id, 'accepted')}
                  disabled={decidingProposalId === p.id}
                  title="Accept — adds this as a curated Luma calendar source"
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-2.5 py-1.5 cursor-pointer disabled:opacity-50 flex items-center gap-1 text-xs"
                >
                  <Check className="w-3.5 h-3.5" /> Accept
                </button>
                <button
                  onClick={() => decideProposal(p.id, 'dismissed')}
                  disabled={decidingProposalId === p.id}
                  title="Dismiss — never proposed again"
                  className="text-xs bg-stone-700 hover:bg-stone-600 text-white rounded-md px-2.5 py-1.5 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> Dismiss
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
