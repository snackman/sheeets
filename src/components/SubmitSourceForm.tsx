'use client';

// Phase 3 host-submission form (plans/event-ingestion.md §3.5). Submits a
// single event link for a conference to `POST /api/host/submissions`,
// which runs it through the full discovery pipeline (discovery trust —
// reviewed before anything is published, never straight to the sheet).
//
// Separate from `SubmitEventModal` (the existing anonymous "add an event
// with full details" flow, which still writes straight to the sheet's
// review section) — this is link-only, lighter weight, and meant for hosts
// who already have an event page on one of the supported platforms.
import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Check, Link as LinkIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  conferenceTabs: { name: string; slug: string }[];
}

type Status = 'idle' | 'submitting' | 'done' | 'error';

/** Review finding, MEDIUM item 5: render the real Cloudflare Turnstile
 *  widget (not just send a token the page never produces) — only when a
 *  site key is actually configured, so the form degrades gracefully to
 *  "no captcha" rather than a broken widget when it isn't. */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

export function SubmitSourceForm({ conferenceTabs }: Props) {
  const { session } = useAuth();
  const [conference, setConference] = useState(conferenceTabs[0]?.name || '');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | undefined>(undefined);

  const renderTurnstileWidget = useCallback(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileContainerRef.current || !window.turnstile) return;
    turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
      'error-callback': () => setTurnstileToken(null),
    });
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (window.turnstile) {
      renderTurnstileWidget();
      return;
    }
    const existing = document.getElementById('cf-turnstile-script');
    if (existing) {
      existing.addEventListener('load', renderTurnstileWidget, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'cf-turnstile-script';
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = renderTurnstileWidget;
    document.head.appendChild(script);
  }, [renderTurnstileWidget]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !conference || status === 'submitting') return;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus('error');
      setMessage('Please complete the verification challenge.');
      return;
    }
    setStatus('submitting');
    setMessage(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch('/api/host/submissions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ conference, url: url.trim(), turnstileToken: turnstileToken ?? undefined }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setStatus('done');
        setMessage(json.message || 'Thanks! We\'ll review this shortly.');
      } else {
        setStatus('error');
        setMessage(json.error || 'Something went wrong. Please try again.');
        if (window.turnstile && turnstileWidgetIdRef.current) {
          window.turnstile.reset(turnstileWidgetIdRef.current);
          setTurnstileToken(null);
        }
      }
    } catch {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  function submitAnother() {
    setStatus('idle');
    setUrl('');
    setMessage(null);
    setTurnstileToken(null);
    if (window.turnstile && turnstileWidgetIdRef.current) window.turnstile.reset(turnstileWidgetIdRef.current);
  }

  if (status === 'done') {
    return (
      <div className="rounded-xl border border-[var(--theme-border-primary)] bg-[color:rgba(255,255,255,0.03)] p-6 flex items-start gap-3">
        <Check className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-[var(--theme-text-primary)] font-medium">Submitted</p>
          <p className="text-sm text-[var(--theme-text-secondary)] mt-1">{message}</p>
          <button
            onClick={submitAnother}
            className="mt-4 text-sm text-[var(--theme-accent-link)] hover:underline cursor-pointer"
          >
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-[var(--theme-text-secondary)] mb-1.5" htmlFor="submit-source-conference">
          Conference
        </label>
        <select
          id="submit-source-conference"
          value={conference}
          onChange={(e) => setConference(e.target.value)}
          className="w-full bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
        >
          {conferenceTabs.map((t) => (
            <option key={t.slug} value={t.name}>{t.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm text-[var(--theme-text-secondary)] mb-1.5" htmlFor="submit-source-url">
          Event link
        </label>
        <div className="relative">
          <LinkIcon className="w-4 h-4 text-[var(--theme-text-secondary)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="submit-source-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://lu.ma/your-event"
            className="w-full bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
        </div>
        <p className="text-xs text-[var(--theme-text-secondary)] mt-1.5">
          Luma, Partiful, Eventbrite, Meetup, or Posh links only.
        </p>
      </div>

      {TURNSTILE_SITE_KEY && <div ref={turnstileContainerRef} />}

      {message && status === 'error' && (
        <p className="text-sm text-red-400">{message}</p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting' || !url.trim() || !conference || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
        className="w-full bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)] rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {status === 'submitting' ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
          </>
        ) : (
          'Submit for review'
        )}
      </button>
    </form>
  );
}
