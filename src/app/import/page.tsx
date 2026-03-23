'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { LumaImportReview } from '@/components/LumaImportReview';
import { LumaEventHistory } from '@/components/LumaEventHistory';
import {
  Mail,
  Shield,
  Eye,
  CheckCircle,
  Loader2,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react';
import type { DeduplicatedEvent } from '@/lib/gmail/types';

type ImportStep = 'connect' | 'syncing' | 'review' | 'importing' | 'done' | 'history';

export default function ImportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-950 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-stone-400 animate-spin" />
        </div>
      }
    >
      <ImportPageContent />
    </Suspense>
  );
}

function ImportPageContent() {
  const { user, session, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<ImportStep>('connect');
  const [isConnected, setIsConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState('');
  const [candidates, setCandidates] = useState<DeduplicatedEvent[]>([]);
  const [syncStats, setSyncStats] = useState({ totalMessages: 0, totalCandidates: 0 });
  const [importedCount, setImportedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [checkingConnection, setCheckingConnection] = useState(true);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, [session]);

  // Check for OAuth callback params
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected === 'true') {
      setIsConnected(true);
      setStep('syncing');
    }
    if (error) {
      setErrorMessage(
        error === 'access_denied'
          ? 'Gmail access was denied. You can try again when ready.'
          : 'Something went wrong connecting to Gmail. Please try again.'
      );
    }
  }, [searchParams]);

  // Check if already connected
  useEffect(() => {
    if (!user || !session) {
      setCheckingConnection(false);
      return;
    }

    async function checkConnection() {
      try {
        const res = await fetch('/api/gmail/connect', {
          headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (data.connected) {
          setIsConnected(true);
          setConnectedEmail(data.email);
          setStep('history');
        }
      } catch {
        // Not connected, stay on connect step
      } finally {
        setCheckingConnection(false);
      }
    }

    checkConnection();
  }, [user, session, getAuthHeaders]);

  // Auto-sync when entering syncing step
  useEffect(() => {
    if (step !== 'syncing' || !session) return;

    async function runSync() {
      try {
        setErrorMessage('');
        const res = await fetch('/api/gmail/sync', {
          method: 'POST',
          headers: getAuthHeaders(),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Sync failed');
        }

        const data = await res.json();
        setCandidates(data.events);
        setSyncStats({
          totalMessages: data.totalMessages,
          totalCandidates: data.totalCandidates,
        });
        setStep('review');
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to sync Gmail'
        );
        setStep('connect');
      }
    }

    runSync();
  }, [step, session, getAuthHeaders]);

  const handleConnect = async () => {
    if (!session) return;

    try {
      setErrorMessage('');
      const res = await fetch('/api/gmail/connect', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();

      if (data.connected) {
        setIsConnected(true);
        setStep('syncing');
        return;
      }

      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch {
      setErrorMessage('Failed to start Gmail connection');
    }
  };

  const handleImport = async (selectedEvents: DeduplicatedEvent[]) => {
    if (!session) return;

    setStep('importing');
    try {
      const res = await fetch('/api/gmail/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          events: selectedEvents.map((e) => ({
            externalEventKey: e.externalEventKey,
            eventName: e.eventName,
            eventStartAt: e.eventStartAt,
            eventEndAt: e.eventEndAt,
            locationRaw: e.locationRaw,
            eventUrl: e.eventUrl,
            status: e.status,
            parseConfidence: e.parseConfidence,
            firstSeenAt: e.firstSeenAt,
            lastSeenAt: e.lastSeenAt,
            sources: e.sources,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }

      const data = await res.json();
      setImportedCount(data.imported);
      setStep('done');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to import events'
      );
      setStep('review');
    }
  };

  const handleResync = () => {
    setStep('syncing');
    setCandidates([]);
  };

  // Auth loading or checking connection
  if (authLoading || checkingConnection) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-stone-400 animate-spin" />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-stone-900 border border-stone-700 rounded-2xl p-8 text-center">
          <Mail className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">
            Sign in to import events
          </h1>
          <p className="text-stone-400 text-sm">
            You need to be signed in to connect your Gmail and import Luma events.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950">
      {/* Header */}
      <header className="border-b border-stone-800 bg-stone-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <a href="/" className="text-stone-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </a>
          <h1 className="text-lg font-semibold text-white">Import Luma Events</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Error banner */}
        {errorMessage && (
          <div className="mb-6 bg-red-900/30 border border-red-800 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm">{errorMessage}</p>
              <button
                onClick={() => setErrorMessage('')}
                className="text-red-400 text-xs mt-1 hover:underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Step: Connect */}
        {step === 'connect' && <ConnectStep onConnect={handleConnect} />}

        {/* Step: Syncing */}
        {step === 'syncing' && <SyncingStep />}

        {/* Step: Review */}
        {step === 'review' && (
          <LumaImportReview
            events={candidates}
            syncStats={syncStats}
            onImport={handleImport}
            onCancel={() => setStep(isConnected ? 'history' : 'connect')}
          />
        )}

        {/* Step: Importing */}
        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 text-amber-400 animate-spin mb-4" />
            <p className="text-stone-300 text-lg">Importing your events...</p>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <DoneStep
            count={importedCount}
            onViewHistory={() => setStep('history')}
          />
        )}

        {/* Step: History */}
        {step === 'history' && (
          <LumaEventHistory
            connectedEmail={connectedEmail}
            onResync={handleResync}
            getAuthHeaders={getAuthHeaders}
          />
        )}
      </main>
    </div>
  );
}

/** Trust / consent screen before OAuth */
function ConnectStep({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="max-w-lg mx-auto py-12">
      <div className="bg-stone-900 border border-stone-700 rounded-2xl p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-amber-400/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">
            Import your Luma events
          </h2>
          <p className="text-stone-400">
            Automatically find events you RSVP&apos;d to, including hidden addresses
            revealed after approval.
          </p>
        </div>

        {/* What we access */}
        <div className="space-y-4 mb-8">
          <div className="flex items-start gap-3">
            <Eye className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-white text-sm font-medium">We only read Luma emails</p>
              <p className="text-stone-400 text-sm">
                Emails from Luma about RSVPs, approvals, reminders, and calendar invites.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-white text-sm font-medium">We extract</p>
              <p className="text-stone-400 text-sm">
                Event name, date &amp; time, venue/location. That&apos;s it.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-white text-sm font-medium">We do not</p>
              <p className="text-stone-400 text-sm">
                Read unrelated emails, send emails, or modify your inbox.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={onConnect}
            className="w-full bg-amber-500 hover:bg-amber-600 text-stone-900 font-semibold
              rounded-xl px-6 py-3 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Mail className="w-5 h-5" />
            Continue with Gmail
          </button>
          <a
            href="/"
            className="block text-center text-stone-500 hover:text-stone-300 text-sm transition-colors"
          >
            Maybe later
          </a>
        </div>

        {/* Technical details */}
        <details className="mt-6 text-stone-500 text-xs">
          <summary className="cursor-pointer hover:text-stone-300 transition-colors">
            Technical details
          </summary>
          <ul className="mt-2 space-y-1 pl-4 list-disc">
            <li>Gmail read-only permission (gmail.readonly scope)</li>
            <li>Search query restricted to known Luma sender addresses</li>
            <li>Only structured event data is stored (no raw email bodies)</li>
            <li>You can disconnect and delete all data at any time</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

/** Loading state while syncing Gmail */
function SyncingStep() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="relative mb-6">
        <div className="w-16 h-16 bg-amber-400/10 rounded-2xl flex items-center justify-center">
          <Mail className="w-8 h-8 text-amber-400" />
        </div>
        <Loader2 className="w-6 h-6 text-amber-400 animate-spin absolute -bottom-1 -right-1" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">
        Scanning your Luma emails...
      </h2>
      <p className="text-stone-400 text-sm max-w-md text-center">
        Looking for RSVP confirmations, approvals, reminders, and calendar invites
        from Luma. This may take a moment.
      </p>
    </div>
  );
}

/** Success screen after import */
function DoneStep({
  count,
  onViewHistory,
}: {
  count: number;
  onViewHistory: () => void;
}) {
  return (
    <div className="max-w-md mx-auto py-16 text-center">
      <div className="w-16 h-16 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <CheckCircle className="w-8 h-8 text-green-400" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">
        {count} event{count !== 1 ? 's' : ''} imported!
      </h2>
      <p className="text-stone-400 mb-8">
        Your Luma events have been saved. You can view them in your event history.
      </p>
      <button
        onClick={onViewHistory}
        className="bg-amber-500 hover:bg-amber-600 text-stone-900 font-semibold
          rounded-xl px-6 py-3 transition-colors cursor-pointer"
      >
        View Event History
      </button>
    </div>
  );
}
