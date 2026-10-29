// Optional ops alerting. If ALERT_WEBHOOK_URL is set, POST a short message
// to it (Slack-style `text` and Discord-style `content` are both sent, so
// either kind of incoming webhook works). Unset -> every call is a no-op.
//
// Deduped in memory: at most one alert per `kind` per hour per server
// instance. (Serverless instances don't share memory, so this bounds spam
// rather than guaranteeing exactly-once -- good enough for ops pings.)
// Callers must pass non-secret text only; never include tokens/passwords.

export type AlertKind = 'cron_errors' | 'budget_cap' | 'kill_switch' | 'reap_failure';

export const ALERT_DEDUPE_MS = 60 * 60 * 1000;

const lastSentAt = new Map<AlertKind, number>();

/** Test helper. */
export function resetAlertState(): void {
  lastSentAt.clear();
}

/** Returns true when a webhook POST was attempted. Never throws. */
export async function sendAlert(kind: AlertKind, message: string): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;

  const now = Date.now();
  const last = lastSentAt.get(kind);
  if (last !== undefined && now - last < ALERT_DEDUPE_MS) return false;
  lastSentAt.set(kind, now);

  const text = `[plan.wtf ingest] ${message}`.slice(0, 1500);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn(`[alert] webhook POST failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`);
  }
  return true;
}
