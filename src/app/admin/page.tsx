'use client';

import { useState, useEffect, useMemo } from 'react';
import { Star, Search, Loader2, ArrowLeft, Plus, Trash2, Pencil, Save, X, GripVertical } from 'lucide-react';
import { fetchEvents } from '@/lib/fetch-events';
import { EVENT_TABS } from '@/lib/constants';
import type { ETHDenverEvent } from '@/lib/types';
import type { AdminConfig, SponsorEntry, NativeAd, UpsellCopy } from '@/lib/types';

const SESSION_KEY = 'sheeets-admin-auth';

type AdminTab = 'featured' | 'sponsors' | 'nativeAds' | 'upsell';

const TAB_LABELS: { key: AdminTab; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'sponsors', label: 'Sponsors' },
  { key: 'nativeAds', label: 'Native Ads' },
  { key: 'upsell', label: 'Upsell Copy' },
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
            className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
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
                        ? 'bg-amber-500 text-white'
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
                        className="inline-block px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
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
      </div>
    </div>
  );
}
