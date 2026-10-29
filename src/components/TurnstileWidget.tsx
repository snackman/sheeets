'use client';

import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove?: (id: string) => void;
}
// SubmitSourceForm.tsx declares the global `getTurnstile()` with its own
// (narrower) type, so read it through a local cast instead of redeclaring it.
const getTurnstile = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

/** True when the Turnstile widget is configured for this deployment. */
export const TURNSTILE_ENABLED = !!SITE_KEY;

/**
 * Renders a Cloudflare Turnstile widget (only when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * is set) and reports the token. Change `resetKey` to force a fresh challenge
 * (tokens are single-use).
 */
export function TurnstileWidget({ onToken, resetKey = 0 }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    let widgetId: string | undefined;
    let cancelled = false;
    const el = ref.current;
    const render = () => {
      const ts = getTurnstile();
      if (cancelled || !ts) return;
      widgetId = ts.render(el, {
        sitekey: SITE_KEY,
        callback: (t: string) => onTokenRef.current(t),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
      });
    };
    onTokenRef.current(null);
    if (getTurnstile()) {
      render();
    } else {
      const existing = document.getElementById('cf-turnstile-script');
      if (existing) {
        existing.addEventListener('load', render, { once: true });
      } else {
        const script = document.createElement('script');
        script.id = 'cf-turnstile-script';
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = render;
        document.head.appendChild(script);
      }
    }
    return () => {
      cancelled = true;
      const ts = getTurnstile();
      if (widgetId && ts?.remove) ts.remove(widgetId);
    };
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return <div ref={ref} />;
}
