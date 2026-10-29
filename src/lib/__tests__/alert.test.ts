import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendAlert, resetAlertState, ALERT_DEDUPE_MS } from '@/lib/alert';

const fetchMock = vi.fn(async (..._a: unknown[]) => new Response('ok'));

beforeEach(() => {
  resetAlertState();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.ALERT_WEBHOOK_URL;
});

describe('sendAlert', () => {
  it('is a no-op when ALERT_WEBHOOK_URL is unset', async () => {
    expect(await sendAlert('cron_errors', 'x')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts Slack- and Discord-compatible JSON', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/abc';
    expect(await sendAlert('kill_switch', 'fired')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.example.test/abc');
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain('fired');
    expect(body.content).toBe(body.text);
  });

  it('dedupes per kind for an hour, but not across kinds', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/abc';
    await sendAlert('cron_errors', 'a');
    expect(await sendAlert('cron_errors', 'b')).toBe(false);
    expect(await sendAlert('budget_cap', 'c')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(ALERT_DEDUPE_MS + 1);
    expect(await sendAlert('cron_errors', 'd')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never throws when the webhook fails', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/abc';
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(sendAlert('reap_failure', 'x')).resolves.toBe(true);
  });
});
