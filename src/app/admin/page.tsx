'use client';

import { useState, useEffect, useMemo } from 'react';
import { Star, Search, Loader2, ArrowLeft, Plus, Trash2, Pencil, Save, X, GripVertical, Copy } from 'lucide-react';
import { fetchEvents } from '@/lib/fetch-events';
import { EVENT_TABS } from '@/lib/constants';
import type { ETHDenverEvent } from '@/lib/types';
import type { AdminConfig, SponsorEntry, NativeAd, UpsellCopy, AdInventoryItem, AdvertisePageConfig } from '@/lib/types';

const SESSION_KEY = 'sheeets-admin-auth';

type AdminTab = 'featured' | 'sponsors' | 'nativeAds' | 'upsell' | 'adInventory';

const TAB_LABELS: { key: AdminTab; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'sponsors', label: 'Sponsors' },
  { key: 'nativeAds', label: 'Native Ads' },
  { key: 'upsell', label: 'Upsell Copy' },
  { key: 'adInventory', label: 'Ad Inventory' },
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
                {/* Conference selector */}
                <div className="flex flex-wrap gap-2">
                  {adConferenceList.map((name) => (
                    <button
                      key={name}
                      onClick={() => setAdConference(name)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                        adConference === name
                          ? 'bg-amber-500 text-stone-900'
                          : 'bg-stone-900 text-stone-400 hover:text-white'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
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
      </div>
    </div>
  );
}
