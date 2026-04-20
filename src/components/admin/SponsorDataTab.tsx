'use client';

import { useState, useCallback } from 'react';
import { Loader2, Pencil, Save, X, Trash2, BarChart3, List, BookOpen, FileText, Search, Database } from 'lucide-react';
import type { EventSponsor, SponsorDataSummary, SponsorCrawlLogEntry } from '@/lib/types';

interface TabConfig {
  gid: number;
  name: string;
  slug: string;
  timezone: string;
  dates: string[];
  center: { lat: number; lng: number };
}

interface SponsorDirectoryEntry {
  sponsor_name: string;
  sponsor_url: string | null;
  types: string[];
  conferences: string[];
  event_count: number;
  conference_count: number;
}

interface CrawlLogStats {
  total: number;
  success: number;
  no_sponsors: number;
  error: number;
  skipped: number;
}

const inputClass = 'bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-white text-sm w-full focus:border-blue-500 focus:outline-none';
const btnPrimary = 'bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer';
const btnDanger = 'bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer';

type SubView = 'list' | 'directory' | 'crawlLog';

interface Props {
  allConferenceTabs: TabConfig[];
  password: string;
}

export default function SponsorDataTab({ allConferenceTabs, password }: Props) {
  const [subView, setSubView] = useState<SubView>('list');

  // Summary
  const [summary, setSummary] = useState<SponsorDataSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Sponsor List state
  const [sponsors, setSponsors] = useState<EventSponsor[]>([]);
  const [sponsorTotal, setSponsorTotal] = useState(0);
  const [sponsorLoading, setSponsorLoading] = useState(false);
  const [sponsorPage, setSponsorPage] = useState(0);
  const [listConference, setListConference] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [listConfidence, setListConfidence] = useState('');
  const [listMethod, setListMethod] = useState('');
  const [listType, setListType] = useState('');

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<EventSponsor>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Batch delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Sponsor Directory state
  const [directory, setDirectory] = useState<SponsorDirectoryEntry[]>([]);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [dirConference, setDirConference] = useState('');
  const [dirSearch, setDirSearch] = useState('');

  // Crawl Log state
  const [crawlLog, setCrawlLog] = useState<SponsorCrawlLogEntry[]>([]);
  const [crawlStats, setCrawlStats] = useState<CrawlLogStats | null>(null);
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [crawlConference, setCrawlConference] = useState('');
  const [crawlStatus, setCrawlStatus] = useState('');

  const PAGE_SIZE = 50;

  // --- Fetch sponsor list ---
  const fetchSponsors = useCallback(async (page = 0) => {
    setSponsorLoading(true);
    const params = new URLSearchParams({ password, view: 'list', limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (listConference) params.set('conference', listConference);
    if (listSearch) params.set('search', listSearch);
    if (listConfidence) params.set('confidence', listConfidence);
    if (listMethod) params.set('method', listMethod);
    if (listType) params.set('type', listType);

    try {
      const res = await fetch(`/api/admin/sponsor-data?${params}`);
      const data = await res.json();
      if (data.error) { console.error(data.error); return; }
      setSponsors(data.sponsors || []);
      setSponsorTotal(data.total || 0);
      if (data.summary) setSummary(data.summary);
      setSponsorPage(page);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Failed to fetch sponsors', err);
    } finally {
      setSponsorLoading(false);
    }
  }, [password, listConference, listSearch, listConfidence, listMethod, listType]);

  // --- Fetch summary only ---
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/admin/sponsor-data?password=${password}&view=list&limit=1`);
      const data = await res.json();
      if (data.summary) setSummary(data.summary);
    } catch (err) {
      console.error('Failed to fetch summary', err);
    } finally {
      setSummaryLoading(false);
    }
  }, [password]);

  // --- Fetch directory ---
  const fetchDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    const params = new URLSearchParams({ password, view: 'aggregate' });
    if (dirConference) params.set('conference', dirConference);
    if (dirSearch) params.set('search', dirSearch);

    try {
      const res = await fetch(`/api/admin/sponsor-data?${params}`);
      const data = await res.json();
      if (data.error) { console.error(data.error); return; }
      setDirectory(data.directory || []);
      setDirectoryTotal(data.total || 0);
      if (data.summary) setSummary(data.summary);
    } catch (err) {
      console.error('Failed to fetch directory', err);
    } finally {
      setDirectoryLoading(false);
    }
  }, [password, dirConference, dirSearch]);

  // --- Fetch crawl log ---
  const fetchCrawlLog = useCallback(async () => {
    setCrawlLoading(true);
    const params = new URLSearchParams({ password });
    if (crawlConference) params.set('conference', crawlConference);
    if (crawlStatus) params.set('status', crawlStatus);

    try {
      const res = await fetch(`/api/admin/sponsor-data/crawl-log?${params}`);
      const data = await res.json();
      if (data.error) { console.error(data.error); return; }
      setCrawlLog(data.entries || []);
      setCrawlStats(data.stats || null);
    } catch (err) {
      console.error('Failed to fetch crawl log', err);
    } finally {
      setCrawlLoading(false);
    }
  }, [password, crawlConference, crawlStatus]);

  // --- Inline edit ---
  const startEdit = (sponsor: EventSponsor) => {
    setEditingId(sponsor.id);
    setEditFields({
      sponsor_name: sponsor.sponsor_name,
      sponsor_url: sponsor.sponsor_url,
      sponsor_type: sponsor.sponsor_type,
      confidence: sponsor.confidence,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditFields({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSavingEdit(true);
    try {
      const res = await fetch('/api/admin/sponsor-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, action: 'update', id: editingId, fields: editFields }),
      });
      const data = await res.json();
      if (data.success) {
        setSponsors(prev => prev.map(s => s.id === editingId ? { ...s, ...editFields } as EventSponsor : s));
        setEditingId(null);
        setEditFields({});
      }
    } catch (err) {
      console.error('Failed to save', err);
    } finally {
      setSavingEdit(false);
    }
  };

  // --- Batch delete ---
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sponsors.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sponsors.map(s => s.id)));
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} sponsor record(s)? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/admin/sponsor-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, action: 'delete', ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (data.success) {
        fetchSponsors(sponsorPage);
      }
    } catch (err) {
      console.error('Failed to delete', err);
    } finally {
      setDeleting(false);
    }
  };

  // --- Helpers ---
  const confidenceBadge = (c: string) => {
    const colors: Record<string, string> = {
      high: 'bg-green-600/20 text-green-400 border-green-600/30',
      medium: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
      low: 'bg-red-600/20 text-red-400 border-red-600/30',
    };
    return colors[c] || 'bg-stone-700 text-stone-300';
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      success: 'bg-green-600/20 text-green-400',
      no_sponsors: 'bg-stone-700 text-stone-300',
      error: 'bg-red-600/20 text-red-400',
      skipped: 'bg-yellow-600/20 text-yellow-400',
    };
    return colors[s] || 'bg-stone-700 text-stone-300';
  };

  const totalPages = Math.ceil(sponsorTotal / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white flex items-center gap-2">
        <Database className="w-5 h-5" />
        Sponsor Data
      </h2>

      {/* Summary Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {summary ? (
          <>
            <StatCard label="Total Sponsors" value={summary.total_sponsors} />
            <StatCard label="Events Crawled" value={summary.total_events_crawled} />
            <StatCard label="With Sponsors" value={summary.events_with_sponsors} color="text-green-400" />
            <StatCard label="Errors" value={summary.events_with_errors} color="text-red-400" />
            <StatCard label="No Sponsors" value={summary.events_no_sponsors} color="text-stone-400" />
            <StatCard label="Unique Names" value={summary.unique_sponsor_names} color="text-blue-400" />
          </>
        ) : (
          <div className="col-span-full">
            <button
              onClick={fetchSummary}
              disabled={summaryLoading}
              className={btnPrimary + ' flex items-center gap-2'}
            >
              {summaryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              Load Summary
            </button>
          </div>
        )}
      </div>

      {/* Confidence breakdown */}
      {summary && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="px-2 py-1 rounded bg-green-600/20 text-green-400 border border-green-600/30">
            High: {summary.by_confidence.high}
          </span>
          <span className="px-2 py-1 rounded bg-yellow-600/20 text-yellow-400 border border-yellow-600/30">
            Medium: {summary.by_confidence.medium}
          </span>
          <span className="px-2 py-1 rounded bg-red-600/20 text-red-400 border border-red-600/30">
            Low: {summary.by_confidence.low}
          </span>
          {Object.entries(summary.by_method).map(([m, count]) => (
            <span key={m} className="px-2 py-1 rounded bg-stone-700 text-stone-300">
              {m}: {count}
            </span>
          ))}
        </div>
      )}

      {/* Sub-view toggle */}
      <div className="flex gap-1 bg-stone-900 rounded-lg p-1 w-fit">
        {([
          { key: 'list' as SubView, label: 'Sponsor List', icon: <List className="w-4 h-4" /> },
          { key: 'directory' as SubView, label: 'Sponsor Directory', icon: <BookOpen className="w-4 h-4" /> },
          { key: 'crawlLog' as SubView, label: 'Crawl Log', icon: <FileText className="w-4 h-4" /> },
        ]).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setSubView(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              subView === key ? 'bg-stone-800 text-white' : 'text-stone-400 hover:text-white'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* ===== Sponsor List Sub-view ===== */}
      {subView === 'list' && (
        <div className="space-y-4">
          {/* Filter row */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">Conference</label>
              <select
                value={listConference}
                onChange={e => setListConference(e.target.value)}
                className={inputClass + ' w-48'}
              >
                <option value="">All Conferences</option>
                {allConferenceTabs.map(t => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-stone-500" />
                <input
                  type="text"
                  value={listSearch}
                  onChange={e => setListSearch(e.target.value)}
                  placeholder="Sponsor name..."
                  className={inputClass + ' pl-8 w-48'}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Confidence</label>
              <select
                value={listConfidence}
                onChange={e => setListConfidence(e.target.value)}
                className={inputClass + ' w-32'}
              >
                <option value="">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Method</label>
              <input
                type="text"
                value={listMethod}
                onChange={e => setListMethod(e.target.value)}
                placeholder="e.g. luma-api"
                className={inputClass + ' w-32'}
              />
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Type</label>
              <input
                type="text"
                value={listType}
                onChange={e => setListType(e.target.value)}
                placeholder="e.g. sponsor"
                className={inputClass + ' w-32'}
              />
            </div>
            <button
              onClick={() => fetchSponsors(0)}
              disabled={sponsorLoading}
              className={btnPrimary + ' flex items-center gap-2'}
            >
              {sponsorLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Load
            </button>
          </div>

          {/* Batch delete */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-stone-400">{selectedIds.size} selected</span>
              <button
                onClick={deleteSelected}
                disabled={deleting}
                className={btnDanger + ' flex items-center gap-2'}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete Selected
              </button>
            </div>
          )}

          {/* Results table */}
          {sponsors.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-stone-400 border-b border-stone-700">
                      <th className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === sponsors.length && sponsors.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <th className="py-2 pr-4">Sponsor Name</th>
                      <th className="py-2 pr-4">Event Name</th>
                      <th className="py-2 pr-4">Conference</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Confidence</th>
                      <th className="py-2 pr-4">Method</th>
                      <th className="py-2 pr-4">Crawled At</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sponsors.map(s => (
                      <tr key={s.id} className="border-b border-stone-800 text-white">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelect(s.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="py-2 pr-4 font-medium max-w-[180px]">
                          {editingId === s.id ? (
                            <input
                              type="text"
                              value={editFields.sponsor_name || ''}
                              onChange={e => setEditFields(f => ({ ...f, sponsor_name: e.target.value }))}
                              className={inputClass + ' w-full'}
                            />
                          ) : (
                            <span className="truncate block" title={s.sponsor_name}>{s.sponsor_name}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-stone-400 text-xs max-w-[150px] truncate" title={s.event_name}>
                          {s.event_name}
                        </td>
                        <td className="py-2 pr-4 text-stone-400 text-xs">{s.conference}</td>
                        <td className="py-2 pr-4">
                          {editingId === s.id ? (
                            <input
                              type="text"
                              value={editFields.sponsor_type || ''}
                              onChange={e => setEditFields(f => ({ ...f, sponsor_type: e.target.value }))}
                              className={inputClass + ' w-24'}
                            />
                          ) : (
                            s.sponsor_type && (
                              <span className="px-2 py-0.5 rounded text-xs bg-purple-600/20 text-purple-400 border border-purple-600/30">
                                {s.sponsor_type}
                              </span>
                            )
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {editingId === s.id ? (
                            <select
                              value={editFields.confidence || 'medium'}
                              onChange={e => setEditFields(f => ({ ...f, confidence: e.target.value as EventSponsor['confidence'] }))}
                              className={inputClass + ' w-24'}
                            >
                              <option value="high">High</option>
                              <option value="medium">Medium</option>
                              <option value="low">Low</option>
                            </select>
                          ) : (
                            <span className={`px-2 py-0.5 rounded text-xs border ${confidenceBadge(s.confidence)}`}>
                              {s.confidence}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-stone-400 text-xs">{s.extraction_method}</td>
                        <td className="py-2 pr-4 text-stone-400 text-xs">
                          {new Date(s.crawled_at).toLocaleDateString()}
                        </td>
                        <td className="py-2">
                          {editingId === s.id ? (
                            <div className="flex gap-1">
                              <button
                                onClick={saveEdit}
                                disabled={savingEdit}
                                className="p-1.5 rounded bg-green-600 hover:bg-green-700 text-white cursor-pointer"
                                title="Save"
                              >
                                {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="p-1.5 rounded bg-stone-700 hover:bg-stone-600 text-white cursor-pointer"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(s)}
                              className="p-1.5 rounded bg-stone-700 hover:bg-stone-600 text-white cursor-pointer"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-sm text-stone-400">
                <span>
                  Showing {sponsorPage * PAGE_SIZE + 1}–{Math.min((sponsorPage + 1) * PAGE_SIZE, sponsorTotal)} of {sponsorTotal}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => fetchSponsors(sponsorPage - 1)}
                    disabled={sponsorPage === 0 || sponsorLoading}
                    className="px-3 py-1.5 rounded bg-stone-800 text-stone-300 hover:bg-stone-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1.5 text-stone-500">
                    Page {sponsorPage + 1} of {totalPages || 1}
                  </span>
                  <button
                    onClick={() => fetchSponsors(sponsorPage + 1)}
                    disabled={sponsorPage >= totalPages - 1 || sponsorLoading}
                    className="px-3 py-1.5 rounded bg-stone-800 text-stone-300 hover:bg-stone-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : sponsorTotal === 0 && !sponsorLoading && sponsors.length === 0 && summary ? (
            <EmptyState />
          ) : null}
        </div>
      )}

      {/* ===== Sponsor Directory Sub-view ===== */}
      {subView === 'directory' && (
        <div className="space-y-4">
          {/* Filter row */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">Conference</label>
              <select
                value={dirConference}
                onChange={e => setDirConference(e.target.value)}
                className={inputClass + ' w-48'}
              >
                <option value="">All Conferences</option>
                {allConferenceTabs.map(t => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-stone-500" />
                <input
                  type="text"
                  value={dirSearch}
                  onChange={e => setDirSearch(e.target.value)}
                  placeholder="Sponsor name..."
                  className={inputClass + ' pl-8 w-48'}
                />
              </div>
            </div>
            <button
              onClick={fetchDirectory}
              disabled={directoryLoading}
              className={btnPrimary + ' flex items-center gap-2'}
            >
              {directoryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
              Load Directory
            </button>
          </div>

          {/* Results table */}
          {directory.length > 0 ? (
            <div className="overflow-x-auto">
              <p className="text-xs text-stone-400 mb-2">{directoryTotal} unique sponsors (sorted by event count)</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-400 border-b border-stone-700">
                    <th className="py-2 pr-4">Sponsor Name</th>
                    <th className="py-2 pr-4 text-right">Events</th>
                    <th className="py-2 pr-4 text-right">Conferences</th>
                    <th className="py-2 pr-4">Conference List</th>
                    <th className="py-2 pr-4">Types</th>
                    <th className="py-2">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {directory.map((d, i) => (
                    <tr key={i} className="border-b border-stone-800 text-white">
                      <td className="py-2 pr-4 font-medium">{d.sponsor_name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{d.event_count}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{d.conference_count}</td>
                      <td className="py-2 pr-4 text-xs text-stone-400 max-w-[200px]">
                        <div className="flex flex-wrap gap-1">
                          {d.conferences.map(c => (
                            <span key={c} className="px-1.5 py-0.5 rounded bg-stone-700 text-stone-300">{c}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {d.types.map(t => (
                            <span key={t} className="px-1.5 py-0.5 rounded text-xs bg-purple-600/20 text-purple-400 border border-purple-600/30">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-xs max-w-[150px] truncate">
                        {d.sponsor_url ? (
                          <a href={d.sponsor_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                            {d.sponsor_url}
                          </a>
                        ) : (
                          <span className="text-stone-600">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : directoryTotal === 0 && !directoryLoading && summary ? (
            <EmptyState />
          ) : null}
        </div>
      )}

      {/* ===== Crawl Log Sub-view ===== */}
      {subView === 'crawlLog' && (
        <div className="space-y-4">
          {/* Filter row */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-stone-400 mb-1">Conference</label>
              <select
                value={crawlConference}
                onChange={e => setCrawlConference(e.target.value)}
                className={inputClass + ' w-48'}
              >
                <option value="">All Conferences</option>
                {allConferenceTabs.map(t => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Status</label>
              <select
                value={crawlStatus}
                onChange={e => setCrawlStatus(e.target.value)}
                className={inputClass + ' w-36'}
              >
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="no_sponsors">No Sponsors</option>
                <option value="error">Error</option>
                <option value="skipped">Skipped</option>
              </select>
            </div>
            <button
              onClick={fetchCrawlLog}
              disabled={crawlLoading}
              className={btnPrimary + ' flex items-center gap-2'}
            >
              {crawlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Load Log
            </button>
          </div>

          {/* Stats summary bar */}
          {crawlStats && (
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="px-2 py-1 rounded bg-stone-700 text-stone-300">
                {crawlStats.total} crawled
              </span>
              <span className="px-2 py-1 rounded bg-green-600/20 text-green-400">
                {crawlStats.success} with sponsors
              </span>
              <span className="px-2 py-1 rounded bg-red-600/20 text-red-400">
                {crawlStats.error} errors
              </span>
              <span className="px-2 py-1 rounded bg-stone-700 text-stone-400">
                {crawlStats.no_sponsors} no sponsors
              </span>
              <span className="px-2 py-1 rounded bg-yellow-600/20 text-yellow-400">
                {crawlStats.skipped} skipped
              </span>
            </div>
          )}

          {/* Results table */}
          {crawlLog.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-400 border-b border-stone-700">
                    <th className="py-2 pr-4">Event URL</th>
                    <th className="py-2 pr-4">Conference</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">Sponsors Found</th>
                    <th className="py-2 pr-4">Error</th>
                    <th className="py-2">Crawled At</th>
                  </tr>
                </thead>
                <tbody>
                  {crawlLog.map((entry, i) => (
                    <tr key={i} className="border-b border-stone-800 text-white">
                      <td className="py-2 pr-4 text-xs max-w-[250px] truncate">
                        <a
                          href={entry.event_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                          title={entry.event_url}
                        >
                          {entry.event_url}
                        </a>
                      </td>
                      <td className="py-2 pr-4 text-stone-400 text-xs">{entry.conference}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(entry.status)}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{entry.sponsors_found}</td>
                      <td className="py-2 pr-4 text-xs text-red-400 max-w-[200px] truncate" title={entry.error_message || ''}>
                        {entry.error_message || '--'}
                      </td>
                      <td className="py-2 text-stone-400 text-xs">
                        {new Date(entry.crawled_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !crawlLoading && crawlStats ? (
            <EmptyState />
          ) : null}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-stone-900 rounded-lg p-3 border border-stone-800">
      <div className={`text-2xl font-bold tabular-nums ${color || 'text-white'}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-stone-400 mt-1">{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-12 text-stone-500">
      <Database className="w-8 h-8 mx-auto mb-3 opacity-50" />
      <p className="text-sm">No sponsor data found.</p>
      <p className="text-xs mt-1">Run the crawl script: <code className="bg-stone-800 px-2 py-0.5 rounded text-stone-400">npx tsx scripts/crawl-sponsors.ts</code></p>
    </div>
  );
}
