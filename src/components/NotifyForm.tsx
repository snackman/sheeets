'use client';

import { useState } from 'react';

interface NotifyFormProps {
  conferenceSlug: string;
  conferenceName: string;
}

export function NotifyForm({ conferenceSlug, conferenceName }: NotifyFormProps) {
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
    <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-sm outline-none"
        style={{
          backgroundColor: 'var(--theme-bg-primary)',
          color: 'var(--theme-text-primary)',
          border: '1px solid var(--theme-border-primary)',
        }}
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        className="px-3 py-1.5 rounded-lg text-sm font-medium shrink-0 transition-opacity disabled:opacity-50"
        style={{
          backgroundColor: 'var(--theme-accent)',
          color: 'var(--theme-bg-primary)',
        }}
      >
        {status === 'loading' ? '...' : 'Notify Me'}
      </button>
    </form>
  );
}
