'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Check, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { EVENT_TABS, VIBE_COLORS, TYPE_TAGS, SHEET_ID } from '@/lib/constants';
import { trackSubmitEventOpen, trackSubmitEventSuccess } from '@/lib/analytics';

interface SubmitEventModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'input' | 'form' | 'success';

// Tags for the selector: TYPE_TAGS excluding '$$', 'Food', 'Bar' + topic tags from VIBE_COLORS
const EXCLUDED_TAGS = ['$$', '🍕 Food', '🍺 Bar'];
const FORMAT_TAGS = TYPE_TAGS.filter((t) => !EXCLUDED_TAGS.includes(t));
const TOPIC_TAGS = Object.keys(VIBE_COLORS).filter(
  (t) => !TYPE_TAGS.includes(t) && t !== 'default'
);
const ALL_TAGS = [...FORMAT_TAGS, ...TOPIC_TAGS];

export function SubmitEventModal({ isOpen, onClose }: SubmitEventModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [lumaUrl, setLumaUrl] = useState('');
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Form fields
  const [conference, setConference] = useState(EVENT_TABS[0]?.name || '');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [address, setAddress] = useState('');
  const [cost, setCost] = useState('Free');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [hasFood, setHasFood] = useState(false);
  const [hasBar, setHasBar] = useState(false);

  // Track open
  useEffect(() => {
    if (isOpen) {
      trackSubmitEventOpen();
    }
  }, [isOpen]);

  function resetForm() {
    setStep('input');
    setLumaUrl('');
    setFetchLoading(false);
    setFetchError('');
    setSubmitLoading(false);
    setSubmitError('');
    setConference(EVENT_TABS[0]?.name || '');
    setName('');
    setDate('');
    setStartTime('');
    setEndTime('');
    setOrganizer('');
    setAddress('');
    setCost('Free');
    setLink('');
    setNote('');
    setSelectedTags(new Set());
    setHasFood(false);
    setHasBar(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleFetchLuma() {
    if (!lumaUrl.trim()) return;
    setFetchLoading(true);
    setFetchError('');

    try {
      const res = await fetch('/api/luma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: lumaUrl.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFetchError(data.error || 'Failed to fetch event details.');
        setFetchLoading(false);
        return;
      }

      // Pre-fill form
      setName(data.name || '');
      setDate(data.date || '');
      setStartTime(data.startTime || '');
      setEndTime(data.endTime || '');
      setOrganizer(data.organizer || '');
      setAddress(data.address || '');
      setCost(data.cost || 'Free');
      setLink(data.link || lumaUrl.trim());
      setStep('form');
    } catch {
      setFetchError('Failed to fetch event details. Please try again.');
    }

    setFetchLoading(false);
  }

  function handleEnterManually() {
    setLink(lumaUrl.trim());
    setStep('form');
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (!name.trim() || !date.trim()) {
      setSubmitError('Event name and date are required.');
      return;
    }

    setSubmitLoading(true);
    setSubmitError('');

    try {
      const tagsStr = Array.from(selectedTags).join(', ');

      const res = await fetch('/api/submit-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conference,
          event: {
            name: name.trim(),
            date: date.trim(),
            startTime: startTime.trim(),
            endTime: endTime.trim(),
            organizer: organizer.trim(),
            address: address.trim(),
            cost: cost.trim() || 'Free',
            tags: tagsStr,
            link: link.trim(),
            food: hasFood,
            bar: hasBar,
            note: note.trim(),
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error || 'Failed to submit event.');
        setSubmitLoading(false);
        return;
      }

      trackSubmitEventSuccess(conference);
      setStep('success');
      setTimeout(() => handleClose(), 2000);
    } catch {
      setSubmitError('Failed to submit event. Please try again.');
    }

    setSubmitLoading(false);
  }

  if (!isOpen) return null;

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[100] bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <div
          className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
            <h2 className="text-base font-bold text-white">
              {step === 'input' && 'Submit Event'}
              {step === 'form' && 'Event Details'}
              {step === 'success' && 'Submitted!'}
            </h2>
            <button
              onClick={handleClose}
              className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="px-4 py-5 overflow-y-auto flex-1">
            {/* Step 1: Luma URL Input */}
            {step === 'input' && (
              <div className="space-y-4">
                <p className="text-slate-400 text-sm">
                  Paste a Luma event URL to auto-fill the details, or enter manually.
                </p>

                <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 focus-within:border-orange-500 transition-colors">
                  <LinkIcon className="w-4 h-4 text-slate-500 shrink-0" />
                  <input
                    type="url"
                    value={lumaUrl}
                    onChange={(e) => setLumaUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleFetchLuma();
                      }
                    }}
                    placeholder="https://lu.ma/your-event"
                    className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500"
                    autoFocus
                  />
                </div>

                {fetchError && <p className="text-red-400 text-xs">{fetchError}</p>}

                <button
                  onClick={handleFetchLuma}
                  disabled={fetchLoading || !lumaUrl.trim()}
                  className="w-full px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  {fetchLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    'Fetch Event'
                  )}
                </button>

                <button
                  onClick={handleEnterManually}
                  className="w-full text-slate-400 hover:text-slate-300 text-xs text-center cursor-pointer"
                >
                  or enter details manually
                </button>
              </div>
            )}

            {/* Step 2: Editable Form */}
            {step === 'form' && (
              <div className="space-y-4">
                {/* Conference selector */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Conference</label>
                  <select
                    value={conference}
                    onChange={(e) => setConference(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none"
                  >
                    {EVENT_TABS.map((tab) => (
                      <option key={tab.gid} value={tab.name}>
                        {tab.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Event name */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Event Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Builders Night"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                  />
                </div>

                {/* Date + Times row */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Date <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      placeholder="Feb 16"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Start Time</label>
                    <input
                      type="text"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      placeholder="7:00 PM"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">End Time</label>
                    <input
                      type="text"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      placeholder="10:00 PM"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                    />
                  </div>
                </div>

                {/* Organizer */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Organizer</label>
                  <input
                    type="text"
                    value={organizer}
                    onChange={(e) => setOrganizer(e.target.value)}
                    placeholder="DeFi Alliance"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                  />
                </div>

                {/* Address */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="1234 Market St, Denver"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                  />
                </div>

                {/* Cost */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Cost</label>
                  <input
                    type="text"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="Free"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                  />
                </div>

                {/* Link */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Link</label>
                  <input
                    type="url"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://lu.ma/your-event"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_TAGS.map((tag) => {
                      const isSelected = selectedTags.has(tag);
                      const color = VIBE_COLORS[tag] || VIBE_COLORS.default;
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className="px-2 py-1 rounded-full text-xs font-medium transition-all cursor-pointer border"
                          style={
                            isSelected
                              ? {
                                  backgroundColor: `${color}20`,
                                  borderColor: color,
                                  color: color,
                                }
                              : {
                                  backgroundColor: 'transparent',
                                  borderColor: '#475569', // slate-600
                                  color: '#94A3B8', // slate-400
                                }
                          }
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Food / Bar checkboxes */}
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasFood}
                      onChange={(e) => setHasFood(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-orange-500 focus:ring-orange-500 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-sm text-slate-300">Food</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasBar}
                      onChange={(e) => setHasBar(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-orange-500 focus:ring-orange-500 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-sm text-slate-300">Bar</span>
                  </label>
                </div>

                {/* Note */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Note</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Any additional details..."
                    rows={2}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500 resize-none"
                  />
                </div>

                {submitError && <p className="text-red-400 text-xs">{submitError}</p>}

                <button
                  onClick={handleSubmit}
                  disabled={submitLoading || !name.trim() || !date.trim()}
                  className="w-full px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  {submitLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Event'
                  )}
                </button>

                <button
                  onClick={() => setStep('input')}
                  className="w-full text-slate-400 hover:text-slate-300 text-xs text-center cursor-pointer"
                >
                  Back
                </button>
              </div>
            )}

            {/* Step 3: Success */}
            {step === 'success' && (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-white font-medium">Event submitted!</p>
                <p className="text-slate-400 text-sm mt-1">
                  It will appear on the schedule shortly.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          {step !== 'success' && (
            <div className="px-4 py-3 border-t border-slate-700 shrink-0">
              <a
                href={sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                or edit spreadsheet directly
              </a>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
