'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Star, Search, Loader2, ArrowLeft, Plus, Trash2, Pencil, Save, X, GripVertical, Copy, MapPin, ChevronDown, FlaskConical, Play, Pause, Trophy, BarChart3, Eye, MousePointer, Download, ClipboardCopy, Check } from 'lucide-react';
import { fetchEvents } from '@/lib/fetch-events';
import { EVENT_TABS } from '@/lib/constants';
import { THEME_OPTIONS, type ThemeId } from '@/lib/themes';
import type { ETHDenverEvent } from '@/lib/types';
import type { AdminConfig, SponsorEntry, NativeAd, UpsellCopy, AdInventoryItem, AdvertisePageConfig, ABTest, ABTestVariant, ABTestStatus, ABVariantResult } from '@/lib/types';

const SESSION_KEY = 'sheeets-admin-auth';

type AdminTab = 'featured' | 'sponsors' | 'nativeAds' | 'upsell' | 'adInventory' | 'theme' | 'abTests' | 'adReports';

const TAB_LABELS: { key: AdminTab; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'sponsors', label: 'Sponsors' },
  { key: 'nativeAds', label: 'Native Ads' },
  { key: 'upsell', label: 'Upsell Copy' },
  { key: 'adInventory', label: 'Ad Inventory' },
  { key: 'theme', label: 'Theme' },
  { key: 'abTests', label: 'A/B Tests' },
  { key: 'adReports', label: 'Ad Reports' },
];

const AB_PLACEMENTS = [
  { value: 'native-ad-content', label: 'Native Ad Content', hint: 'Test different ad creatives (title, description, image, link)' },
  { value: 'sponsor-copy', label: 'Sponsor Ticker Copy', hint: 'Test different sponsor messaging' },
  { value: 'ad-frequency', label: 'Ad Frequency (ListView)', hint: 'Test how often ads appear in the list' },
  { value: 'hero-copy', label: 'Hero Copy (/ads)', hint: 'Test /ads page headline and CTA' },
  { value: 'tier-layout', label: 'Tier Layout (/ads)', hint: 'Test tier grid layout on /ads page' },
  { value: 'custom', label: 'Custom', hint: 'Custom placement with JSON config' },
];

const inputClass = 'bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-white text-sm w-full focus:border-blue-500 focus:outline-none';
const btnPrimary = 'bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer';
const btnDanger = 'bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer';

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [events, setEvents] = useState<ETHDenverEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [conference, setConference] = useState(EVENT_TABS[0]?.name || '');
  const [search, setSearch] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('featured');
  const [adminConfig, setAdminConfig] = useState<AdminConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Sponsors state
  const [sponsors, setSponsors] = useState<SponsorEntry[]>([]);
  const [editingSponsorIndex, setEditingSponsorIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Native Ads state
  const [nativeAds, setNativeAds] = useState<NativeAd[]>([]);
  const [editingAdId, setEditingAdId] = useState<string | null>(null);

  // Upsell state
  const [upsellCopy, setUpsellCopy] = useState<UpsellCopy>({
    heading: '',
    body: '',
    cta_text: '',
    cta_url: '',
  });

  // Ad Inventory state
  const [adConference, setAdConference] = useState(EVENT_TABS[0]?.name || '');
  const [adInventory, setAdInventory] = useState<AdInventoryItem[]>([]);
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(null);
  const [adPageConfig, setAdPageConfig] = useState<AdvertisePageConfig>({
    heroHeading: '',
    heroSubheading: '',
    statsLine: '',
    ctaText: '',
    ctaUrl: '',
    ctaSecondaryText: '',
    ctaSecondaryUrl: '',
    footerText: '',
    tiersEnabled: true,
    tiers: [],
  });
  const [showCopyFrom, setShowCopyFrom] = useState(false);
  const [adConfOpen, setAdConfOpen] = useState(false);

  // Theme state
  const [themeConference, setThemeConference] = useState(EVENT_TABS[0]?.name || '');
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>('dark');

  // A/B Tests state
  const [abTests, setAbTests] = useState<ABTest[]>([]);
  const [abEditingId, setAbEditingId] = useState<string | null>(null);
  const [abViewResults, setAbViewResults] = useState<string | null>(null);
  const [abResults, setAbResults] = useState<Record<string, ABVariantResult[]>>({});
  const [abResultsLoading, setAbResultsLoading] = useState(false);
  const [abNewTest, setAbNewTest] = useState<ABTest | null>(null);

  // Ad Reports state
  interface AdReportRow {
    ad_id: string;
    ad_name: string;
    placement: string;
    impressions: number;
    unique_impressions: number;
    clicks: number;
    unique_clicks: number;
    ctr: number;
    first_seen: string;
    last_seen: string;
  }
  interface AdReportData {
    ads: AdReportRow[];
    totals: { impressions: number; clicks: number; ctr: number };
    period: { start: string; end: string };
  }
  const [adReport, setAdReport] = useState<AdReportData | null>(null);
  const [adReportLoading, setAdReportLoading] = useState(false);
  const [adReportConference, setAdReportConference] = useState('');
  const [adReportRange, setAdReportRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [adReportSort, setAdReportSort] = useState<'impressions' | 'ctr'>('impressions');
  const [adReportCopied, setAdReportCopied] = useState(false);

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

  // Fetch admin config when authed
  useEffect(() => {
    if (!authed) return;
    setConfigLoading(true);
    fetch('/api/admin/config')
      .then(res => res.json())
      .then((data: AdminConfig) => {
        setAdminConfig(data);
        setSponsors(data.sponsors || []);
        setNativeAds(data.native_ads || []);
        setUpsellCopy(data.upsell_copy || { heading: '', body: '', cta_text: '', cta_url: '' });
        setAbTests((data.ab_tests as ABTest[]) || []);
      })
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, [authed]);

  // Conference list for ad inventory tab (EVENT_TABS + any from config keys)
  const adConferenceList = useMemo(() => {
    const names = new Set(EVENT_TABS.map(t => t.name));
    if (adminConfig) {
      for (const key of Object.keys(adminConfig)) {
        const match = key.match(/^(?:ad_inventory|advertise_page):(.+)$/);
        if (match) names.add(match[1]);
      }
    }
    return Array.from(names);
  }, [adminConfig]);

  // Other conferences that have saved config (for copy-from)
  const copyFromConferences = useMemo(() => {
    if (!adminConfig) return [];
    return adConferenceList.filter(c => c !== adConference && (
      adminConfig[`ad_inventory:${c}`] || adminConfig[`advertise_page:${c}`]
    ));
  }, [adminConfig, adConference, adConferenceList]);

  // Load per-conference ad config when conference changes
  useEffect(() => {
    if (!adminConfig) return;
    const inv = adminConfig[`ad_inventory:${adConference}`] as AdInventoryItem[] | undefined;
    setAdInventory(inv && Array.isArray(inv) ? inv : []);
    const page = adminConfig[`advertise_page:${adConference}`] as AdvertisePageConfig | undefined;
    setAdPageConfig(page || {
      heroHeading: '', heroSubheading: '', statsLine: '',
      ctaText: '', ctaUrl: '', ctaSecondaryText: '', ctaSecondaryUrl: '',
      footerText: '', tiersEnabled: true, tiers: [],
    });
    setEditingInventoryId(null);
    setShowCopyFrom(false);
  }, [adConference, adminConfig]);

  // Load per-conference theme when themeConference changes
  useEffect(() => {
    if (!adminConfig) return;
    const t = adminConfig[`theme:${themeConference}`] as string | undefined;
    if (t === 'dark' || t === 'paper' || t === 'light' || t === 'sxsw' || t === 'sxsw2' || t === 'gdc' || t === 'ethcc') {
      setSelectedTheme(t);
    } else {
      setSelectedTheme('dark');
    }
  }, [themeConference, adminConfig]);

  function handleCopyFrom(sourceConf: string) {
    if (!adminConfig) return;
    const inv = adminConfig[`ad_inventory:${sourceConf}`] as AdInventoryItem[] | undefined;
    const page = adminConfig[`advertise_page:${sourceConf}`] as AdvertisePageConfig | undefined;
    if (inv) setAdInventory(structuredClone(inv));
    if (page) setAdPageConfig(structuredClone(page));
    setShowCopyFrom(false);
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (password === 'trusttheplan') {
      setAuthed(true);
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
  }

  async function saveConfig(key: string, value: unknown) {
    setSaving(true);
    setSaveMessage('');
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'trusttheplan', key, value }),
      });
      if (res.ok) {
        setSaveMessage('Saved!');
        setTimeout(() => setSaveMessage(''), 2000);
      } else {
        const data = await res.json();
        setSaveMessage(`Error: ${data.error}`);
      }
    } catch {
      setSaveMessage('Failed to save');
    }
    setSaving(false);
  }

  // A/B Test helpers
  function createEmptyTest(): ABTest {
    const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
      id,
      name: '',
      description: '',
      status: 'draft',
      placement: 'ad-frequency',
      conference: '',
      variants: [
        { id: 'control', name: 'Control', weight: 50, config: {} },
        { id: 'variant-a', name: 'Variant A', weight: 50, config: {} },
      ],
      created_at: new Date().toISOString(),
    };
  }

  async function saveAbTests(tests: ABTest[]) {
    setAbTests(tests);
    await saveConfig('ab_tests', tests);
  }

  function updateTestStatus(testId: string, status: ABTestStatus, winnerId?: string) {
    const updated = abTests.map(t => {
      if (t.id !== testId) return t;
      const patch: Partial<ABTest> = { status };
      if (status === 'running' && !t.started_at) patch.started_at = new Date().toISOString();
      if (status === 'completed') {
        patch.completed_at = new Date().toISOString();
        if (winnerId) patch.winnerId = winnerId;
      }
      return { ...t, ...patch };
    });
    saveAbTests(updated);
  }

  const fetchResults = useCallback(async (testId: string) => {
    setAbResultsLoading(true);
    try {
      const res = await fetch(`/api/ab/results?test_id=${testId}`);
      if (res.ok) {
        const data = await res.json();
        setAbResults(prev => ({ ...prev, [testId]: data.variants }));
      }
    } catch { /* ignore */ }
    setAbResultsLoading(false);
  }, []);

  const fetchAdReport = useCallback(async () => {
    setAdReportLoading(true);
    try {
      const params = new URLSearchParams({ password: 'trusttheplan' });
      if (adReportConference) params.set('conference', adReportConference);
      if (adReportRange !== 'all') {
        const now = new Date();
        const days = adReportRange === '7d' ? 7 : adReportRange === '30d' ? 30 : 90;
        const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        params.set('start_date', start.toISOString());
        params.set('end_date', now.toISOString());
      } else {
        // All time: use a far past date
        params.set('start_date', '2020-01-01T00:00:00.000Z');
        params.set('end_date', new Date().toISOString());
      }
      const res = await fetch(`/api/ads/report?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAdReport(data);
      }
    } catch { /* ignore */ }
    setAdReportLoading(false);
  }, [adReportConference, adReportRange]);

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
      <div className="min-h-screen bg-stone-950 flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="bg-stone-900 border border-stone-700 rounded-xl p-6 w-full max-w-sm"
        >
          <h1 className="text-lg font-bold text-white mb-4">Admin Access</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-stone-950 border border-stone-600 rounded-lg text-white text-sm px-3 py-2 focus:border-amber-500 focus:outline-none placeholder:text-stone-500 mb-3"
            autoFocus
          />
          <button
            type="submit"
            className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-600 text-stone-900 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-stone-950 border-b border-stone-800 px-4 py-3">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <a href="/" className="text-stone-400 hover:text-white transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </a>
              <h1 className="text-lg font-bold">Admin</h1>
              {activeTab === 'featured' && (
                <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                  {featuredCount} featured
                </span>
              )}
            </div>
            {saveMessage && (
              <span className={`text-sm ${saveMessage.startsWith('Error') || saveMessage === 'Failed to save' ? 'text-red-400' : 'text-green-400'}`}>
                {saveMessage}
              </span>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 bg-stone-900 rounded-lg p-1 mb-3">
            {TAB_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === key
                    ? 'bg-stone-800 text-white'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Conference tabs + search (only for Featured tab) */}
          {activeTab === 'featured' && (
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {EVENT_TABS.map((tab) => (
                  <button
                    key={tab.gid}
                    onClick={() => setConference(tab.name)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                      conference === tab.name
                        ? 'bg-amber-500 text-stone-900'
                        : 'bg-stone-900 text-stone-400 hover:text-white'
                    }`}
                  >
                    {tab.name}
                  </button>
                ))}
              </div>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search events..."
                  className="w-full bg-stone-900 border border-stone-700 rounded-lg text-white text-sm pl-9 pr-3 py-1.5 focus:border-amber-500 focus:outline-none placeholder:text-stone-500"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* Tab 1: Featured */}
        {activeTab === 'featured' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20 gap-2 text-stone-400">
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
                        ? 'bg-amber-500/10 border border-amber-500/20'
                        : 'hover:bg-stone-900/50'
                    }`}
                  >
                    <button
                      onClick={() => toggleFeatured(event)}
                      disabled={togglingId === event.id}
                      className="shrink-0 cursor-pointer disabled:opacity-50"
                      title={event.isFeatured ? 'Remove featured' : 'Mark as featured'}
                    >
                      {togglingId === event.id ? (
                        <Loader2 className="w-5 h-5 animate-spin text-stone-500" />
                      ) : (
                        <Star
                          className={`w-5 h-5 transition-colors ${
                            event.isFeatured
                              ? 'text-amber-400 fill-orange-400'
                              : 'text-stone-600 hover:text-stone-400'
                          }`}
                        />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {event.name}
                      </p>
                      <p className="text-xs text-stone-500 truncate">
                        {event.organizer && `${event.organizer} · `}
                        {event.date} · {event.startTime}
                      </p>
                    </div>

                    {event.isFeatured && (
                      <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full shrink-0">
                        FEATURED
                      </span>
                    )}
                  </div>
                ))}

                {filtered.length === 0 && (
                  <p className="text-center text-stone-500 py-10">No events found</p>
                )}
              </div>
            )}
          </>
        )}

        {/* Tab 2: Sponsors */}
        {activeTab === 'sponsors' && (
          <div className="space-y-6">
            {configLoading ? (
              <div className="flex items-center justify-center py-20 gap-2 text-stone-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading config...
              </div>
            ) : (
              <>
                <div className="bg-stone-900 rounded-xl p-4 border border-stone-700">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Sponsors</h3>
                      <p className="text-xs text-stone-500 mt-0.5">Each sponsor shows as: before text + <span className="text-blue-400">link text</span> + after text</p>
                    </div>
                    <button
                      onClick={() => {
                        setSponsors([...sponsors, { beforeText: '', linkText: '', afterText: '', url: '' }]);
                        setEditingSponsorIndex(sponsors.length);
                      }}
                      className={`${btnPrimary} flex items-center gap-1.5`}
                    >
                      <Plus className="w-4 h-4" />
                      Add Sponsor
                    </button>
                  </div>

                  {sponsors.length === 0 && (
                    <p className="text-stone-500 text-sm py-4 text-center">No sponsors added yet</p>
                  )}

                  <div className="space-y-3">
                    {sponsors.map((sponsor, idx) => (
                      <div
                        key={idx}
                        className={`p-3 bg-stone-800 rounded-lg border transition-colors ${
                          dragOverIndex === idx && dragIndex !== idx
                            ? 'border-amber-500 border-t-2'
                            : 'border-stone-600'
                        } ${dragIndex === idx ? 'opacity-40' : ''}`}
                        draggable={editingSponsorIndex !== idx}
                        onDragStart={(e) => {
                          setDragIndex(idx);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null && dragIndex !== idx) {
                            setDragOverIndex(idx);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverIndex === idx) setDragOverIndex(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null && dragIndex !== idx) {
                            const updated = [...sponsors];
                            const [moved] = updated.splice(dragIndex, 1);
                            updated.splice(idx, 0, moved);
                            setSponsors(updated);
                          }
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                      >
                        {editingSponsorIndex === idx ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Before Text</label>
                                <input
                                  type="text"
                                  value={sponsor.beforeText}
                                  onChange={(e) => {
                                    const updated = [...sponsors];
                                    updated[idx] = { ...updated[idx], beforeText: e.target.value };
                                    setSponsors(updated);
                                  }}
                                  placeholder="Supported by "
                                  className={inputClass}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Link Text</label>
                                <input
                                  type="text"
                                  value={sponsor.linkText}
                                  onChange={(e) => {
                                    const updated = [...sponsors];
                                    updated[idx] = { ...updated[idx], linkText: e.target.value };
                                    setSponsors(updated);
                                  }}
                                  placeholder="Stand With Crypto"
                                  className={inputClass}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">After Text</label>
                              <input
                                type="text"
                                value={sponsor.afterText}
                                onChange={(e) => {
                                  const updated = [...sponsors];
                                  updated[idx] = { ...updated[idx], afterText: e.target.value };
                                  setSponsors(updated);
                                }}
                                placeholder=". Join the Fight for Sensible Crypto Policy!"
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">URL</label>
                              <input
                                type="url"
                                value={sponsor.url}
                                onChange={(e) => {
                                  const updated = [...sponsors];
                                  updated[idx] = { ...updated[idx], url: e.target.value };
                                  setSponsors(updated);
                                }}
                                placeholder="https://..."
                                className={inputClass}
                              />
                            </div>
                            {/* Inline preview */}
                            <div className="text-xs text-stone-500 bg-stone-950/50 rounded-lg px-3 py-2">
                              Preview: <span className="text-stone-300">{sponsor.beforeText}<span className="text-blue-400 underline">{sponsor.linkText}</span>{sponsor.afterText}</span>
                            </div>
                            <button
                              onClick={() => setEditingSponsorIndex(null)}
                              className="text-green-400 hover:text-green-300 cursor-pointer p-1 flex items-center gap-1 text-sm"
                            >
                              <Save className="w-4 h-4" />
                              Done
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <GripVertical className="w-4 h-4 text-stone-500 cursor-grab shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-stone-300 truncate">
                                {sponsor.beforeText}<span className="font-medium text-white">{sponsor.linkText || '(no link text)'}</span>{sponsor.afterText}
                              </p>
                              <p className="text-xs text-stone-500 truncate mt-0.5">{sponsor.url || '(no url)'}</p>
                            </div>
                            <button
                              onClick={() => setEditingSponsorIndex(idx)}
                              className="text-stone-400 hover:text-white cursor-pointer p-1"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setSponsors(sponsors.filter((_, i) => i !== idx))}
                              className="text-red-400 hover:text-red-300 cursor-pointer p-1"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Save button */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => saveConfig('sponsors', sponsors)}
                    disabled={saving}
                    className={`${btnPrimary} flex items-center gap-2 ${saving ? 'opacity-50' : ''}`}
                  >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save Sponsors
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 3: Native Ads */}
        {activeTab === 'nativeAds' && (
          <div className="space-y-6">
            {configLoading ? (
              <div className="flex items-center justify-center py-20 gap-2 text-stone-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading config...
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Native Ads ({nativeAds.length})</h3>
                  <button
                    onClick={() => {
                      const newAd: NativeAd = {
                        id: crypto.randomUUID(),
                        title: '',
                        description: '',
                        link: '',
                        imageUrl: '',
                        conference: EVENT_TABS[0]?.name || '',
                        badge: 'Sponsored',
                        active: true,
                      };
                      setNativeAds([...nativeAds, newAd]);
                      setEditingAdId(newAd.id);
                    }}
                    className={`${btnPrimary} flex items-center gap-1.5`}
                  >
                    <Plus className="w-4 h-4" />
                    Add Ad
                  </button>
                </div>

                {nativeAds.length === 0 && (
                  <p className="text-stone-500 text-sm py-4 text-center">No native ads configured</p>
                )}

                <div className="space-y-4">
                  {nativeAds.map((ad) => (
                    <div key={ad.id} className="bg-stone-900 rounded-xl p-4 border border-stone-700">
                      {editingAdId === ad.id ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-stone-500 font-mono">{ad.id.slice(0, 8)}...</span>
                            <button
                              onClick={() => setEditingAdId(null)}
                              className="text-stone-400 hover:text-white cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div>
                            <label className="block text-xs text-stone-400 mb-1">Title</label>
                            <input
                              type="text"
                              value={ad.title}
                              onChange={(e) => setNativeAds(nativeAds.map(a => a.id === ad.id ? { ...a, title: e.target.value } : a))}
                              className={inputClass}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-stone-400 mb-1">Description</label>
                            <textarea
                              value={ad.description}
                              onChange={(e) => setNativeAds(nativeAds.map(a => a.id === ad.id ? { ...a, description: e.target.value } : a))}
                              rows={2}
                              className={`${inputClass} resize-none`}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-stone-400 mb-1">Link</label>
                            <input
                              type="url"
                              value={ad.link}
                              onChange={(e) => setNativeAds(nativeAds.map(a => a.id === ad.id ? { ...a, link: e.target.value } : a))}
                              className={inputClass}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-stone-400 mb-1">Image URL</label>
                            <input
                              type="url"
                              value={ad.imageUrl}
                              onChange={(e) => setNativeAds(nativeAds.map(a => a.id === ad.id ? { ...a, imageUrl: e.target.value } : a))}
                              className={inputClass}
                            />
                          </div>
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <label className="block text-xs text-stone-400 mb-1">Conference</label>
                              <select
                                value={ad.conference}
                                onChange={(e) => setNativeAds(nativeAds.map(a => a.id === ad.id ? { ...a, conference: e.target.value } : a))}
                                className={inputClass}
                              >
                                {EVENT_TABS.map((t) => (
                                  <option key={t.gid} value={t.name}>{t.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs text-stone-400 mb-1">Badge Text</label>
                              <input
                                type="text"
                                value={ad.badge}
                                onChange={(e) => setNativeAds(nativeAds.map(a => a.id === ad.id ? { ...a, badge: e.target.value } : a))}
                                placeholder="Sponsored"
                                className={inputClass}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={ad.active}
                                onChange={(e) => setNativeAds(nativeAds.map(a => a.id === ad.id ? { ...a, active: e.target.checked } : a))}
                                className="w-4 h-4 rounded"
                              />
                              <span className="text-sm text-stone-300">Active</span>
                            </label>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-4">
                          {ad.imageUrl && (
                            <div className="w-[80px] h-[60px] flex-shrink-0 rounded-lg overflow-hidden bg-stone-800">
                              <img src={ad.imageUrl} alt={ad.title} className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-white truncate">{ad.title || '(untitled)'}</span>
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ad.active ? 'bg-green-500' : 'bg-red-500'}`} />
                              <span className="text-[10px] text-stone-500">{ad.active ? 'Active' : 'Inactive'}</span>
                            </div>
                            <p className="text-xs text-stone-400 line-clamp-1">{ad.description || '(no description)'}</p>
                            <p className="text-xs text-stone-500 mt-0.5">{ad.conference} &middot; {ad.badge || 'Sponsored'}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => setEditingAdId(ad.id)}
                              className="text-stone-400 hover:text-white cursor-pointer p-1"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setNativeAds(nativeAds.filter(a => a.id !== ad.id))}
                              className="text-red-400 hover:text-red-300 cursor-pointer p-1"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => saveConfig('native_ads', nativeAds)}
                  disabled={saving}
                  className={`${btnPrimary} flex items-center gap-2 ${saving ? 'opacity-50' : ''}`}
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Native Ads
                </button>
              </>
            )}
          </div>
        )}

        {/* Tab 4: Upsell Copy */}
        {activeTab === 'upsell' && (
          <div className="space-y-6">
            {configLoading ? (
              <div className="flex items-center justify-center py-20 gap-2 text-stone-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading config...
              </div>
            ) : (
              <>
                <div className="bg-stone-900 rounded-xl p-4 border border-stone-700 space-y-4">
                  <h3 className="text-sm font-semibold text-white">Upsell Copy (shown after event submission)</h3>

                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Heading</label>
                    <input
                      type="text"
                      value={upsellCopy.heading}
                      onChange={(e) => setUpsellCopy({ ...upsellCopy, heading: e.target.value })}
                      placeholder="Want more visibility?"
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Body</label>
                    <textarea
                      value={upsellCopy.body}
                      onChange={(e) => setUpsellCopy({ ...upsellCopy, body: e.target.value })}
                      placeholder="Highlight your event and get featured placement..."
                      rows={3}
                      className={`${inputClass} resize-none`}
                    />
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-stone-400 mb-1">CTA Text</label>
                      <input
                        type="text"
                        value={upsellCopy.cta_text}
                        onChange={(e) => setUpsellCopy({ ...upsellCopy, cta_text: e.target.value })}
                        placeholder="Learn More — $500"
                        className={inputClass}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-stone-400 mb-1">CTA URL</label>
                      <input
                        type="url"
                        value={upsellCopy.cta_url}
                        onChange={(e) => setUpsellCopy({ ...upsellCopy, cta_url: e.target.value })}
                        placeholder="https://..."
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                {/* Live preview */}
                <div className="bg-stone-900 rounded-xl p-4 border border-stone-700">
                  <h3 className="text-sm font-semibold text-white mb-3">Preview</h3>
                  <div className="max-w-md mx-auto">
                    <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-500/10 border border-amber-500/30">
                      <h4 className="text-sm font-semibold text-amber-300 mb-1">
                        {upsellCopy.heading || 'Heading...'}
                      </h4>
                      <p className="text-xs text-stone-400 mb-3">
                        {upsellCopy.body || 'Body text...'}
                      </p>
                      <a
                        href={upsellCopy.cta_url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-stone-900 rounded-lg transition-colors"
                      >
                        {upsellCopy.cta_text || 'CTA Text'}
                      </a>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => saveConfig('upsell_copy', upsellCopy)}
                  disabled={saving}
                  className={`${btnPrimary} flex items-center gap-2 ${saving ? 'opacity-50' : ''}`}
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Upsell Copy
                </button>
              </>
            )}
          </div>
        )}

        {/* Tab 5: Ad Inventory */}
        {activeTab === 'adInventory' && (
          <div className="space-y-8">
            {configLoading ? (
              <div className="flex items-center justify-center py-20 gap-2 text-stone-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading config...
              </div>
            ) : (
              <>
                {/* Conference selector dropdown */}
                <div className="relative inline-block">
                  <button
                    onClick={() => setAdConfOpen(!adConfOpen)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-stone-900 text-sm font-semibold cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">{adConference}</span>
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  </button>
                  {adConfOpen && (
                    <>
                      <div className="fixed inset-0 z-[60]" onClick={() => setAdConfOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 bg-stone-900 border border-stone-700 rounded-lg shadow-xl overflow-hidden min-w-[180px] z-[70]">
                        {adConferenceList.map((name) => (
                          <button
                            key={name}
                            onClick={() => { setAdConference(name); setAdConfOpen(false); }}
                            className={`w-full text-left px-4 py-3 text-sm font-semibold transition-colors cursor-pointer ${
                              adConference === name
                                ? 'bg-amber-500 text-stone-900'
                                : 'text-stone-300 hover:bg-stone-800'
                            }`}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Section A: Page Settings */}
                <div className="bg-stone-900 rounded-xl p-4 border border-stone-700 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Advertise Page Settings</h3>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Configure the /ads page for {adConference}. Leave blank to use defaults.
                      </p>
                    </div>
                    {copyFromConferences.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => setShowCopyFrom(!showCopyFrom)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-stone-300 bg-stone-800 border border-stone-600 rounded-lg hover:border-stone-500 transition-colors cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy from...
                        </button>
                        {showCopyFrom && (
                          <div className="absolute right-0 top-full mt-1 bg-stone-800 border border-stone-600 rounded-lg shadow-xl z-10 py-1 min-w-[160px]">
                            {copyFromConferences.map(c => (
                              <button
                                key={c}
                                onClick={() => handleCopyFrom(c)}
                                className="w-full text-left px-3 py-2 text-sm text-stone-300 hover:bg-stone-700 cursor-pointer"
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Hero Heading</label>
                    <input
                      type="text"
                      value={adPageConfig.heroHeading}
                      onChange={(e) => setAdPageConfig({ ...adPageConfig, heroHeading: e.target.value })}
                      placeholder="Reach Crypto Conference Attendees"
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Hero Subheading</label>
                    <textarea
                      value={adPageConfig.heroSubheading}
                      onChange={(e) => setAdPageConfig({ ...adPageConfig, heroSubheading: e.target.value })}
                      placeholder="plan.wtf is the go-to guide for thousands of attendees..."
                      rows={2}
                      className={`${inputClass} resize-none`}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Stats Line</label>
                    <input
                      type="text"
                      value={adPageConfig.statsLine}
                      onChange={(e) => setAdPageConfig({ ...adPageConfig, statsLine: e.target.value })}
                      placeholder="10,000+ monthly users across ETH Denver, Consensus, ETHCC..."
                      className={inputClass}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-stone-400 mb-1">CTA Text</label>
                      <input
                        type="text"
                        value={adPageConfig.ctaText}
                        onChange={(e) => setAdPageConfig({ ...adPageConfig, ctaText: e.target.value })}
                        placeholder="Get in Touch"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-stone-400 mb-1">CTA URL</label>
                      <input
                        type="text"
                        value={adPageConfig.ctaUrl}
                        onChange={(e) => setAdPageConfig({ ...adPageConfig, ctaUrl: e.target.value })}
                        placeholder="mailto:ads@plan.wtf"
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-stone-400 mb-1">Secondary CTA Text</label>
                      <input
                        type="text"
                        value={adPageConfig.ctaSecondaryText}
                        onChange={(e) => setAdPageConfig({ ...adPageConfig, ctaSecondaryText: e.target.value })}
                        placeholder="View Media Kit"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-stone-400 mb-1">Secondary CTA URL</label>
                      <input
                        type="text"
                        value={adPageConfig.ctaSecondaryUrl}
                        onChange={(e) => setAdPageConfig({ ...adPageConfig, ctaSecondaryUrl: e.target.value })}
                        placeholder="https://..."
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Footer Text</label>
                    <input
                      type="text"
                      value={adPageConfig.footerText}
                      onChange={(e) => setAdPageConfig({ ...adPageConfig, footerText: e.target.value })}
                      placeholder="Questions? Reach out at ads@plan.wtf"
                      className={inputClass}
                    />
                  </div>

                  {/* Tiers Toggle */}
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-stone-400">Show Sponsorship Tiers</label>
                    <button
                      type="button"
                      onClick={() => setAdPageConfig({ ...adPageConfig, tiersEnabled: !adPageConfig.tiersEnabled })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${adPageConfig.tiersEnabled ? 'bg-amber-500' : 'bg-stone-600'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${adPageConfig.tiersEnabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>

                  {/* Tiers Editor */}
                  {adPageConfig.tiersEnabled && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-stone-400">Sponsorship Tiers ({adPageConfig.tiers.length})</label>
                        <button
                          type="button"
                          onClick={() => setAdPageConfig({
                            ...adPageConfig,
                            tiers: [...adPageConfig.tiers, { name: '', price: '', features: [''], highlighted: false }],
                          })}
                          className="text-xs text-amber-400 hover:text-amber-300 cursor-pointer"
                        >
                          + Add Tier
                        </button>
                      </div>
                      {adPageConfig.tiers.map((tier, ti) => (
                        <div key={ti} className="bg-stone-800 rounded-lg p-3 space-y-2 border border-stone-700">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-stone-500">Tier {ti + 1}</span>
                            <button
                              type="button"
                              onClick={() => setAdPageConfig({
                                ...adPageConfig,
                                tiers: adPageConfig.tiers.filter((_, i) => i !== ti),
                              })}
                              className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs text-stone-500 mb-0.5">Name</label>
                              <input
                                type="text"
                                value={tier.name}
                                onChange={(e) => {
                                  const tiers = [...adPageConfig.tiers];
                                  tiers[ti] = { ...tiers[ti], name: e.target.value };
                                  setAdPageConfig({ ...adPageConfig, tiers });
                                }}
                                placeholder="Gold Sponsor"
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-stone-500 mb-0.5">Price</label>
                              <input
                                type="text"
                                value={tier.price}
                                onChange={(e) => {
                                  const tiers = [...adPageConfig.tiers];
                                  tiers[ti] = { ...tiers[ti], price: e.target.value };
                                  setAdPageConfig({ ...adPageConfig, tiers });
                                }}
                                placeholder="$2,500"
                                className={inputClass}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={tier.highlighted}
                              onChange={(e) => {
                                const tiers = [...adPageConfig.tiers];
                                tiers[ti] = { ...tiers[ti], highlighted: e.target.checked };
                                setAdPageConfig({ ...adPageConfig, tiers });
                              }}
                              className="accent-amber-500"
                            />
                            <label className="text-xs text-stone-400">Highlighted (featured styling)</label>
                          </div>
                          <div>
                            <label className="block text-xs text-stone-500 mb-1">Features (one per line)</label>
                            <textarea
                              value={tier.features.join('\n')}
                              onChange={(e) => {
                                const tiers = [...adPageConfig.tiers];
                                tiers[ti] = { ...tiers[ti], features: e.target.value.split('\n') };
                                setAdPageConfig({ ...adPageConfig, tiers });
                              }}
                              rows={4}
                              placeholder={"Logo on homepage ticker\nFeatured event badge\n1 native ad slot"}
                              className={inputClass}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => saveConfig(`advertise_page:${adConference}`, adPageConfig)}
                    disabled={saving}
                    className={`${btnPrimary} flex items-center gap-2 ${saving ? 'opacity-50' : ''}`}
                  >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save Page Settings
                  </button>
                </div>

                {/* Section B: Inventory Items */}
                <div className="bg-stone-900 rounded-xl p-4 border border-stone-700">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Inventory Items ({adInventory.length})</h3>
                      <p className="text-xs text-stone-500 mt-0.5">Ad placements shown on the /ads page</p>
                    </div>
                    <button
                      onClick={() => {
                        const newItem: AdInventoryItem = {
                          id: crypto.randomUUID(),
                          title: '',
                          slug: '',
                          description: '',
                          price: '',
                          features: [],
                          available: true,
                          sortOrder: adInventory.length + 1,
                        };
                        setAdInventory([...adInventory, newItem]);
                        setEditingInventoryId(newItem.id);
                      }}
                      className={`${btnPrimary} flex items-center gap-1.5`}
                    >
                      <Plus className="w-4 h-4" />
                      Add Item
                    </button>
                  </div>

                  {adInventory.length === 0 && (
                    <p className="text-stone-500 text-sm py-4 text-center">
                      No inventory items. Default items will be shown on the page.
                    </p>
                  )}

                  <div className="space-y-3">
                    {adInventory.map((item) => (
                      <div key={item.id} className="p-3 bg-stone-800 rounded-lg border border-stone-600">
                        {editingInventoryId === item.id ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-stone-500 font-mono">{item.id.slice(0, 8)}...</span>
                              <button
                                onClick={() => setEditingInventoryId(null)}
                                className="text-stone-400 hover:text-white cursor-pointer"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Title</label>
                                <input
                                  type="text"
                                  value={item.title}
                                  onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, title: e.target.value } : i))}
                                  placeholder="Sponsor Ticker"
                                  className={inputClass}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Slug</label>
                                <input
                                  type="text"
                                  value={item.slug}
                                  onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, slug: e.target.value } : i))}
                                  placeholder="sponsor-ticker"
                                  className={inputClass}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">Description</label>
                              <textarea
                                value={item.description}
                                onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, description: e.target.value } : i))}
                                rows={2}
                                className={`${inputClass} resize-none`}
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Price</label>
                                <input
                                  type="text"
                                  value={item.price}
                                  onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, price: e.target.value } : i))}
                                  placeholder="$500"
                                  className={inputClass}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Price Note</label>
                                <input
                                  type="text"
                                  value={item.priceNote || ''}
                                  onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, priceNote: e.target.value } : i))}
                                  placeholder="per conference"
                                  className={inputClass}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Sort Order</label>
                                <input
                                  type="number"
                                  value={item.sortOrder}
                                  onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, sortOrder: parseInt(e.target.value) || 0 } : i))}
                                  className={inputClass}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Stats</label>
                                <input
                                  type="text"
                                  value={item.stats || ''}
                                  onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, stats: e.target.value } : i))}
                                  placeholder="Seen by 100% of users"
                                  className={inputClass}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-stone-400 mb-1">Badge</label>
                                <input
                                  type="text"
                                  value={item.badge || ''}
                                  onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, badge: e.target.value } : i))}
                                  placeholder="Popular"
                                  className={inputClass}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">Image URL</label>
                              <input
                                type="url"
                                value={item.imageUrl || ''}
                                onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, imageUrl: e.target.value } : i))}
                                placeholder="https://..."
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-stone-400 mb-1">
                                Features (one per line)
                              </label>
                              <textarea
                                value={item.features.join('\n')}
                                onChange={(e) => setAdInventory(adInventory.map(i =>
                                  i.id === item.id
                                    ? { ...i, features: e.target.value.split('\n').filter(f => f.trim()) }
                                    : i
                                ))}
                                rows={3}
                                placeholder="Custom message + link&#10;Runs across all pages&#10;Per-conference targeting"
                                className={`${inputClass} resize-none`}
                              />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.available}
                                onChange={(e) => setAdInventory(adInventory.map(i => i.id === item.id ? { ...i, available: e.target.checked } : i))}
                                className="w-4 h-4 rounded"
                              />
                              <span className="text-sm text-stone-300">Available</span>
                            </label>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-medium text-white truncate">{item.title || '(untitled)'}</span>
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${item.available ? 'bg-green-500' : 'bg-red-500'}`} />
                                {item.badge && (
                                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{item.badge}</span>
                                )}
                              </div>
                              <p className="text-xs text-stone-500 truncate">
                                {item.price}{item.priceNote ? ` (${item.priceNote})` : ''} &middot; {item.features.length} features &middot; sort: {item.sortOrder}
                              </p>
                            </div>
                            <button
                              onClick={() => setEditingInventoryId(item.id)}
                              className="text-stone-400 hover:text-white cursor-pointer p-1"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setAdInventory(adInventory.filter(i => i.id !== item.id))}
                              className="text-red-400 hover:text-red-300 cursor-pointer p-1"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => saveConfig(`ad_inventory:${adConference}`, adInventory)}
                  disabled={saving}
                  className={`${btnPrimary} flex items-center gap-2 ${saving ? 'opacity-50' : ''}`}
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Inventory Items
                </button>
              </>
            )}
          </div>
        )}

        {activeTab === 'theme' && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold text-white">Theme per Conference</h2>

            {/* Conference selector */}
            <div>
              <label className="block text-sm text-stone-400 mb-2">Conference</label>
              <select
                value={themeConference}
                onChange={(e) => setThemeConference(e.target.value)}
                className={inputClass + ' max-w-xs'}
              >
                {EVENT_TABS.map(tab => (
                  <option key={tab.name} value={tab.name}>{tab.name}</option>
                ))}
              </select>
            </div>

            {/* Theme radio buttons */}
            <div>
              <label className="block text-sm text-stone-400 mb-3">Active Theme for {themeConference}</label>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 max-w-4xl">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setSelectedTheme(opt.id)}
                    className={`relative rounded-lg border-2 p-4 text-center cursor-pointer transition-all ${
                      selectedTheme === opt.id
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-stone-700 hover:border-stone-500'
                    }`}
                  >
                    {/* Theme preview swatch */}
                    <div className="flex gap-1 justify-center mb-2">
                      {opt.id === 'dark' && (
                        <>
                          <span className="w-5 h-5 rounded" style={{ background: '#0c0a09' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#1c1917' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#f59e0b' }} />
                        </>
                      )}
                      {opt.id === 'paper' && (
                        <>
                          <span className="w-5 h-5 rounded border border-stone-600" style={{ background: '#f5f0e8' }} />
                          <span className="w-5 h-5 rounded border border-stone-600" style={{ background: '#faf7f2' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#c47a2a' }} />
                        </>
                      )}
                      {opt.id === 'light' && (
                        <>
                          <span className="w-5 h-5 rounded border border-stone-600" style={{ background: '#fafafa' }} />
                          <span className="w-5 h-5 rounded border border-stone-600" style={{ background: '#ffffff' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#ef4444' }} />
                        </>
                      )}
                      {opt.id === 'sxsw' && (
                        <>
                          <span className="w-5 h-5 rounded" style={{ background: '#0a1410' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#111f18' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#d8fc30' }} />
                        </>
                      )}
                      {opt.id === 'sxsw2' && (
                        <>
                          <span className="w-5 h-5 rounded" style={{ background: '#0a0a0a' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#F9CB0D' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#F2A6D1' }} />
                        </>
                      )}
                      {opt.id === 'gdc' && (
                        <>
                          <span className="w-5 h-5 rounded" style={{ background: '#0e1525' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#EF0000' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#f5a0c0' }} />
                        </>
                      )}
                      {opt.id === 'ethcc' && (
                        <>
                          <span className="w-5 h-5 rounded" style={{ background: '#152066' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#6b9de8' }} />
                          <span className="w-5 h-5 rounded" style={{ background: '#f06b6b' }} />
                        </>
                      )}
                    </div>
                    <span className={`text-sm font-semibold ${selectedTheme === opt.id ? 'text-blue-400' : 'text-stone-300'}`}>
                      {opt.label}
                    </span>
                    {selectedTheme === opt.id && (
                      <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Save + status */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => saveConfig(`theme:${themeConference}`, selectedTheme)}
                disabled={saving}
                className={`${btnPrimary} flex items-center gap-2 ${saving ? 'opacity-50' : ''}`}
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Theme
              </button>
              {saveMessage && <span className="text-sm text-green-400">{saveMessage}</span>}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/*  A/B Tests Tab                                                */}
        {/* ============================================================ */}
        {activeTab === 'abTests' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FlaskConical className="w-5 h-5" />
                A/B Tests
              </h2>
              <button
                onClick={() => setAbNewTest(createEmptyTest())}
                className={`${btnPrimary} flex items-center gap-2`}
              >
                <Plus className="w-4 h-4" />
                New Test
              </button>
            </div>

            {/* Create / Edit Test Form */}
            {abNewTest && (
              <div className="bg-stone-800/50 border border-stone-600 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  {abEditingId ? 'Edit Test' : 'Create New Test'}
                </h3>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Name</label>
                    <input
                      className={inputClass}
                      value={abNewTest.name}
                      onChange={e => setAbNewTest({ ...abNewTest, name: e.target.value })}
                      placeholder="e.g. Ad Frequency Test"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-400 mb-1">Placement</label>
                    <select
                      className={inputClass}
                      value={abNewTest.placement}
                      onChange={e => setAbNewTest({ ...abNewTest, placement: e.target.value })}
                    >
                      {AB_PLACEMENTS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-stone-400 mb-1">Description</label>
                  <input
                    className={inputClass}
                    value={abNewTest.description}
                    onChange={e => setAbNewTest({ ...abNewTest, description: e.target.value })}
                    placeholder="What are we testing?"
                  />
                </div>

                <div>
                  <label className="block text-xs text-stone-400 mb-1">Conference (leave empty for global)</label>
                  <select
                    className={inputClass + ' max-w-xs'}
                    value={abNewTest.conference}
                    onChange={e => setAbNewTest({ ...abNewTest, conference: e.target.value })}
                  >
                    <option value="">Global (all conferences)</option>
                    {EVENT_TABS.map(tab => (
                      <option key={tab.name} value={tab.name}>{tab.name}</option>
                    ))}
                  </select>
                </div>

                {/* Variants */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-stone-400 font-medium">Variants</label>
                    <button
                      onClick={() => {
                        const newId = `variant-${String.fromCharCode(97 + abNewTest.variants.length - 1)}`;
                        setAbNewTest({
                          ...abNewTest,
                          variants: [
                            ...abNewTest.variants,
                            { id: newId, name: `Variant ${String.fromCharCode(65 + abNewTest.variants.length - 1)}`, weight: 0, config: {} },
                          ],
                        });
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                    >
                      + Add Variant
                    </button>
                  </div>
                  <div className="space-y-2">
                    {abNewTest.variants.map((v, vi) => (
                      <div key={v.id} className="flex items-center gap-2 bg-stone-900/50 rounded-lg p-3">
                        <input
                          className={inputClass + ' flex-1'}
                          value={v.name}
                          onChange={e => {
                            const updated = [...abNewTest.variants];
                            updated[vi] = { ...updated[vi], name: e.target.value };
                            setAbNewTest({ ...abNewTest, variants: updated });
                          }}
                          placeholder="Variant name"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            className={inputClass + ' w-16 text-center'}
                            value={v.weight}
                            onChange={e => {
                              const updated = [...abNewTest.variants];
                              updated[vi] = { ...updated[vi], weight: Number(e.target.value) || 0 };
                              setAbNewTest({ ...abNewTest, variants: updated });
                            }}
                          />
                          <span className="text-xs text-stone-500">%</span>
                        </div>
                        <div className="shrink-0">
                          <input
                            className={inputClass + ' w-48'}
                            value={JSON.stringify(v.config)}
                            onChange={e => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                const updated = [...abNewTest.variants];
                                updated[vi] = { ...updated[vi], config: parsed };
                                setAbNewTest({ ...abNewTest, variants: updated });
                              } catch { /* ignore invalid JSON while typing */ }
                            }}
                            placeholder='{"key": "value"}'
                            title="Variant config (JSON)"
                          />
                        </div>
                        {abNewTest.variants.length > 2 && (
                          <button
                            onClick={() => setAbNewTest({
                              ...abNewTest,
                              variants: abNewTest.variants.filter((_, i) => i !== vi),
                            })}
                            className="text-red-400 hover:text-red-300 cursor-pointer p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const totalWeight = abNewTest.variants.reduce((s, v) => s + v.weight, 0);
                    return totalWeight !== 100 ? (
                      <p className="text-xs text-amber-400 mt-1">
                        Weights sum to {totalWeight}% (should be 100%)
                      </p>
                    ) : null;
                  })()}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => {
                      if (!abNewTest.name.trim()) return;
                      if (abEditingId) {
                        // Update existing
                        const updated = abTests.map(t => t.id === abEditingId ? abNewTest : t);
                        saveAbTests(updated);
                      } else {
                        // Create new
                        saveAbTests([...abTests, abNewTest]);
                      }
                      setAbNewTest(null);
                      setAbEditingId(null);
                    }}
                    disabled={!abNewTest.name.trim() || saving}
                    className={`${btnPrimary} flex items-center gap-2 ${!abNewTest.name.trim() || saving ? 'opacity-50' : ''}`}
                  >
                    <Save className="w-4 h-4" />
                    {abEditingId ? 'Update Test' : 'Create Test'}
                  </button>
                  <button
                    onClick={() => { setAbNewTest(null); setAbEditingId(null); }}
                    className="text-sm text-stone-400 hover:text-stone-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  {saveMessage && <span className="text-sm text-green-400">{saveMessage}</span>}
                </div>
              </div>
            )}

            {/* Test List */}
            {abTests.length === 0 && !abNewTest && (
              <div className="text-center py-12 text-stone-500">
                <FlaskConical className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No A/B tests yet. Create one to get started.</p>
              </div>
            )}

            <div className="space-y-3">
              {abTests.map(test => (
                <div key={test.id} className="bg-stone-800/50 border border-stone-700 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-bold text-white truncate">{test.name}</h3>
                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${
                          test.status === 'running'
                            ? 'bg-green-500/20 text-green-400 border-green-500/30'
                            : test.status === 'paused'
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                            : test.status === 'completed'
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                            : 'bg-stone-500/20 text-stone-400 border-stone-500/30'
                        }`}>
                          {test.status}
                        </span>
                        {test.winnerId && (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
                            <Trophy className="w-3 h-3" />
                            {test.variants.find(v => v.id === test.winnerId)?.name || test.winnerId}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-stone-400 mb-1">{test.description}</p>
                      <div className="flex items-center gap-3 text-[11px] text-stone-500">
                        <span>Placement: {AB_PLACEMENTS.find(p => p.value === test.placement)?.label || test.placement}</span>
                        {test.conference && <span>Conference: {test.conference}</span>}
                        <span>{test.variants.length} variants</span>
                        {test.started_at && <span>Started: {new Date(test.started_at).toLocaleDateString()}</span>}
                      </div>

                      {/* Variant summary */}
                      <div className="flex gap-2 mt-2">
                        {test.variants.map(v => (
                          <span key={v.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-stone-900/50 rounded text-[11px] text-stone-300">
                            {v.name} <span className="text-stone-500">{v.weight}%</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {test.status === 'draft' && (
                        <button
                          onClick={() => updateTestStatus(test.id, 'running')}
                          className="p-1.5 rounded hover:bg-green-500/20 text-green-400 cursor-pointer"
                          title="Start test"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      {test.status === 'running' && (
                        <button
                          onClick={() => updateTestStatus(test.id, 'paused')}
                          className="p-1.5 rounded hover:bg-amber-500/20 text-amber-400 cursor-pointer"
                          title="Pause test"
                        >
                          <Pause className="w-4 h-4" />
                        </button>
                      )}
                      {test.status === 'paused' && (
                        <button
                          onClick={() => updateTestStatus(test.id, 'running')}
                          className="p-1.5 rounded hover:bg-green-500/20 text-green-400 cursor-pointer"
                          title="Resume test"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      {(test.status === 'running' || test.status === 'paused') && (
                        <button
                          onClick={() => {
                            setAbViewResults(abViewResults === test.id ? null : test.id);
                            if (abViewResults !== test.id) fetchResults(test.id);
                          }}
                          className="p-1.5 rounded hover:bg-blue-500/20 text-blue-400 cursor-pointer"
                          title="View results"
                        >
                          <BarChart3 className="w-4 h-4" />
                        </button>
                      )}
                      {test.status !== 'completed' && (
                        <button
                          onClick={() => {
                            setAbEditingId(test.id);
                            setAbNewTest(structuredClone(test));
                          }}
                          className="p-1.5 rounded hover:bg-stone-700 text-stone-400 cursor-pointer"
                          title="Edit test"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm(`Delete test "${test.name}"?`)) {
                            saveAbTests(abTests.filter(t => t.id !== test.id));
                          }
                        }}
                        className="p-1.5 rounded hover:bg-red-500/20 text-red-400 cursor-pointer"
                        title="Delete test"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Results panel */}
                  {abViewResults === test.id && (
                    <div className="mt-4 pt-4 border-t border-stone-700">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          Results
                        </h4>
                        <button
                          onClick={() => fetchResults(test.id)}
                          className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                        >
                          Refresh
                        </button>
                      </div>

                      {abResultsLoading ? (
                        <div className="flex items-center gap-2 text-stone-400 text-sm py-4">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading results...
                        </div>
                      ) : abResults[test.id] ? (
                        <div className="space-y-3">
                          <div className="grid gap-2">
                            {abResults[test.id].map(r => {
                              const maxImpressions = Math.max(...abResults[test.id].map(v => v.impressions), 1);
                              const barWidth = (r.impressions / maxImpressions) * 100;
                              return (
                                <div key={r.variant_id} className="bg-stone-900/50 rounded-lg p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-white">{r.variant_name}</span>
                                    <span className="text-xs text-stone-500">{r.variant_id}</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-4 text-center mb-2">
                                    <div>
                                      <div className="flex items-center justify-center gap-1 text-xs text-stone-400 mb-0.5">
                                        <Eye className="w-3 h-3" />
                                        Impressions
                                      </div>
                                      <span className="text-lg font-bold text-white">{r.impressions.toLocaleString()}</span>
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-center gap-1 text-xs text-stone-400 mb-0.5">
                                        <MousePointer className="w-3 h-3" />
                                        Clicks
                                      </div>
                                      <span className="text-lg font-bold text-white">{r.clicks.toLocaleString()}</span>
                                    </div>
                                    <div>
                                      <div className="text-xs text-stone-400 mb-0.5">CTR</div>
                                      <span className="text-lg font-bold text-amber-400">{(r.ctr * 100).toFixed(2)}%</span>
                                    </div>
                                  </div>
                                  {/* Bar */}
                                  <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all"
                                      style={{ width: `${barWidth}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Complete test with winner selection */}
                          {(test.status === 'running' || test.status === 'paused') && (
                            <div className="flex items-center gap-2 pt-2">
                              <span className="text-xs text-stone-400">Complete test with winner:</span>
                              {test.variants.map(v => (
                                <button
                                  key={v.id}
                                  onClick={() => {
                                    if (confirm(`Complete test and declare "${v.name}" as winner?`)) {
                                      updateTestStatus(test.id, 'completed', v.id);
                                      setAbViewResults(null);
                                    }
                                  }}
                                  className="px-3 py-1 text-xs font-medium bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/30 border border-amber-500/30 cursor-pointer"
                                >
                                  <Trophy className="w-3 h-3 inline mr-1" />
                                  {v.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-stone-500 py-2">No results data available. The ab_events table may need to be created in Supabase.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* Tab 8: Ad Reports                                             */}
        {/* ============================================================ */}
        {activeTab === 'adReports' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Ad Performance Reports
            </h2>

            {/* Filters row */}
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs text-stone-400 mb-1">Conference</label>
                <select
                  value={adReportConference}
                  onChange={e => setAdReportConference(e.target.value)}
                  className={inputClass + ' w-48'}
                >
                  <option value="">All Conferences</option>
                  {EVENT_TABS.map(t => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Date Range</label>
                <select
                  value={adReportRange}
                  onChange={e => setAdReportRange(e.target.value as typeof adReportRange)}
                  className={inputClass + ' w-36'}
                >
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="90d">Last 90 days</option>
                  <option value="all">All time</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Sort by</label>
                <select
                  value={adReportSort}
                  onChange={e => setAdReportSort(e.target.value as typeof adReportSort)}
                  className={inputClass + ' w-36'}
                >
                  <option value="impressions">Impressions</option>
                  <option value="ctr">CTR</option>
                </select>
              </div>
              <button
                onClick={fetchAdReport}
                disabled={adReportLoading}
                className={btnPrimary + ' flex items-center gap-2'}
              >
                {adReportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                Load Report
              </button>
            </div>

            {/* Results */}
            {adReport && (
              <div className="space-y-4">
                {/* Period info */}
                <p className="text-xs text-stone-400">
                  Period: {new Date(adReport.period.start).toLocaleDateString()} &ndash; {new Date(adReport.period.end).toLocaleDateString()}
                  {adReportConference && <> &middot; Conference: {adReportConference}</>}
                </p>

                {/* Table */}
                {adReport.ads.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-stone-400 border-b border-stone-700">
                          <th className="py-2 pr-4">Name</th>
                          <th className="py-2 pr-4">Placement</th>
                          <th className="py-2 pr-4 text-right">Impressions</th>
                          <th className="py-2 pr-4 text-right">Unique</th>
                          <th className="py-2 pr-4 text-right">Clicks</th>
                          <th className="py-2 pr-4 text-right">Unique</th>
                          <th className="py-2 text-right">CTR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...adReport.ads]
                          .sort((a, b) => adReportSort === 'ctr' ? b.ctr - a.ctr : b.impressions - a.impressions)
                          .map(ad => (
                          <tr key={ad.ad_id} className="border-b border-stone-800 text-white">
                            <td className="py-2 pr-4 font-medium">{ad.ad_name}</td>
                            <td className="py-2 pr-4">
                              <span className="px-2 py-0.5 text-xs bg-stone-800 rounded-full text-stone-300">{ad.placement}</span>
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">{ad.impressions.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-stone-400">{ad.unique_impressions.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{ad.clicks.toLocaleString()}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-stone-400">{ad.unique_clicks.toLocaleString()}</td>
                            <td className="py-2 text-right tabular-nums font-medium text-amber-400">{ad.ctr.toFixed(2)}%</td>
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr className="border-t-2 border-stone-600 text-white font-bold">
                          <td className="py-2 pr-4" colSpan={2}>Total</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{adReport.totals.impressions.toLocaleString()}</td>
                          <td className="py-2 pr-4"></td>
                          <td className="py-2 pr-4 text-right tabular-nums">{adReport.totals.clicks.toLocaleString()}</td>
                          <td className="py-2 pr-4"></td>
                          <td className="py-2 text-right tabular-nums text-amber-400">{adReport.totals.ctr.toFixed(2)}%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-stone-500 text-sm py-4">No ad events found for this period.</p>
                )}

                {/* Action buttons */}
                {adReport.ads.length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-2">
                    {/* Export CSV */}
                    <button
                      onClick={() => {
                        const sorted = [...adReport.ads].sort((a, b) =>
                          adReportSort === 'ctr' ? b.ctr - a.ctr : b.impressions - a.impressions
                        );
                        const header = 'Name,Placement,Impressions,Unique Impressions,Clicks,Unique Clicks,CTR';
                        const rows = sorted.map(ad =>
                          `"${ad.ad_name}","${ad.placement}",${ad.impressions},${ad.unique_impressions},${ad.clicks},${ad.unique_clicks},${ad.ctr}`
                        );
                        rows.push(`"Total","",${adReport.totals.impressions},,${adReport.totals.clicks},,${adReport.totals.ctr}`);
                        const csv = [header, ...rows].join('\n');
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `ad-report-${adReportConference || 'all'}-${adReportRange}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>

                    {/* Generate Report */}
                    <button
                      onClick={() => {
                        const sorted = [...adReport.ads].sort((a, b) =>
                          adReportSort === 'ctr' ? b.ctr - a.ctr : b.impressions - a.impressions
                        );
                        const startDate = new Date(adReport.period.start);
                        const endDate = new Date(adReport.period.end);
                        const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

                        const conferenceLine = adReportConference || 'All Conferences';
                        let report = `\uD83D\uDCCA Ad Performance Report \u2014 ${conferenceLine}\n`;
                        report += `Period: ${fmtDate(startDate)} \u2013 ${fmtDate(endDate)}\n\n`;

                        for (const ad of sorted) {
                          const placementLabel = ad.placement === 'native-ad' ? 'Native Ad'
                            : ad.placement === 'sponsor-ticker' ? 'Sponsor Ticker'
                            : ad.placement === 'featured-event' ? 'Featured Event'
                            : ad.placement;
                          report += `${ad.ad_name} (${placementLabel})\n`;
                          report += `  Impressions: ${ad.impressions.toLocaleString()} (${ad.unique_impressions.toLocaleString()} unique)\n`;
                          report += `  Clicks: ${ad.clicks.toLocaleString()} (${ad.unique_clicks.toLocaleString()} unique)\n`;
                          report += `  CTR: ${ad.ctr.toFixed(2)}%\n\n`;
                        }

                        report += `[Total across all ads]\n`;
                        report += `  Impressions: ${adReport.totals.impressions.toLocaleString()}\n`;
                        report += `  Clicks: ${adReport.totals.clicks.toLocaleString()}\n`;
                        report += `  CTR: ${adReport.totals.ctr.toFixed(2)}%\n\n`;
                        report += `Generated by plan.wtf`;

                        navigator.clipboard.writeText(report).then(() => {
                          setAdReportCopied(true);
                          setTimeout(() => setAdReportCopied(false), 2000);
                        });
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    >
                      {adReportCopied ? (
                        <>
                          <Check className="w-4 h-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="w-4 h-4" />
                          Generate Report
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
