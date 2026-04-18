'use client';

import { useState } from 'react';

interface NotifyFormProps {
  conferenceSlug: string;
  conferenceName: string;
}

export function NotifyForm({ conferenceSlug, conferenceName }: NotifyFormProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('loading');
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          conference_slug: conferenceSlug,
          conference_name: conferenceName,
        }),
      });

      if (res.ok) {
        setStatus('success');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <p className="text-sm mt-3" style={{ color: 'var(--theme-accent)' }}>
        We&apos;ll notify you when events are posted!
      </p>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-3 px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 cursor-pointer"
        style={{
          backgroundColor: 'var(--theme-accent)',
          color: 'var(--theme-bg-primary)',
        }}
      >
        Notify Me
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="w-full max-w-sm rounded-xl p-6 shadow-2xl"
            style={{
              backgroundColor: 'var(--theme-bg-secondary)',
              border: '1px solid var(--theme-border-primary)',
            }}
          >
            <h3
              className="text-lg font-semibold mb-1"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              Get Notified
            </h3>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              We&apos;ll email you when {conferenceName} events are posted.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: 'var(--theme-bg-primary)',
                  color: 'var(--theme-text-primary)',
                  border: '1px solid var(--theme-border-primary)',
                }}
              />

              {status === 'error' && (
                <p className="text-xs text-red-400">Something went wrong. Please try again.</p>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm cursor-pointer transition-colors"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50 cursor-pointer"
                  style={{
                    backgroundColor: 'var(--theme-accent)',
                    color: 'var(--theme-bg-primary)',
                  }}
                >
                  {status === 'loading' ? 'Submitting...' : 'Notify Me'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
