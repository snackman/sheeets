// Shared "is this conference's ingestion worth running right now" check —
// used by both `/api/cron/ingest` (every 4 hours) and
// `/api/cron/ingest-discover-sources` (daily) so a conference outside its
// active window costs ~nothing on either cron, not just the main one.
export const ACTIVE_WINDOW_PRE_DAYS = 60;

export function isInActiveWindow(startDate: string, endDate: string, todayISO: string): boolean {
  const start = new Date(startDate + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - ACTIVE_WINDOW_PRE_DAYS);
  const windowStart = start.toISOString().slice(0, 10);
  return todayISO >= windowStart && todayISO <= endDate;
}
