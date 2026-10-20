import { SHEET_ID } from './conferences';
import type { TabConfig } from './conferences';

/** Google Sheet URL for the soonest active conference tab; the bare sheet if none. */
export function dataSheetUrl(tabs: Pick<TabConfig, 'gid'>[]): string {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
  const gid = tabs[0]?.gid;
  return gid == null ? base : `${base}?gid=${gid}#gid=${gid}`;
}
