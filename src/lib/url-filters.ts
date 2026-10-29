import type { FilterState, ViewMode } from './types';

const VIEW_MODES: ViewMode[] = ['map', 'list', 'table', 'gallery'];
const TIME_MODES = ['now', 'today', 'tomorrow'] as const;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;
const MAX_QUERY_LEN = 100;

export interface UrlFilterState {
  start?: string;
  end?: string;
  timeMode?: FilterState['timeMode'];
  tags?: string[];
  query?: string;
  view?: ViewMode;
}

function validDateTime(v: string | null, endOfDay: boolean): string | undefined {
  if (!v) return undefined;
  const full = DATE_RE.test(v) ? `${v}T${endOfDay ? '23:30' : '00:00'}` : v;
  if (!DATETIME_RE.test(full)) return undefined;
  const d = new Date(`${full}:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 16) !== full ? undefined : full;
}

/** Parse filter query params, ignoring anything unknown or malformed. */
export function parseFilterParams(search: string | URLSearchParams): UrlFilterState {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out: UrlFilterState = {};

  const start = validDateTime(sp.get('start'), false);
  const end = validDateTime(sp.get('end'), true);
  if (start && end && start <= end) {
    out.start = start;
    out.end = end;
  }

  const time = sp.get('time');
  if (time && (TIME_MODES as readonly string[]).includes(time)) out.timeMode = time as FilterState['timeMode'];

  const tags = (sp.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && t.length <= MAX_TAG_LEN);
  if (tags.length > 0) out.tags = [...new Set(tags)].slice(0, MAX_TAGS);

  const q = (sp.get('q') ?? '').trim().slice(0, MAX_QUERY_LEN);
  if (q) out.query = q;

  const view = sp.get('view');
  if (view && (VIEW_MODES as string[]).includes(view)) out.view = view as ViewMode;

  return out;
}

/**
 * Build the query string (with leading "?", or "") for the current filters.
 * Values equal to the defaults are omitted; unrelated existing params are kept.
 */
export function buildFilterSearch(
  current: string,
  state: {
    filters: Pick<FilterState, 'startDateTime' | 'endDateTime' | 'timeMode' | 'vibes' | 'searchQuery'>;
    defaultRange: { startDateTime: string; endDateTime: string };
    view: ViewMode;
  },
): string {
  const sp = new URLSearchParams(current);
  for (const k of ['start', 'end', 'time', 'tags', 'q', 'view']) sp.delete(k);
  const { filters, defaultRange } = state;

  if (filters.startDateTime !== defaultRange.startDateTime || filters.endDateTime !== defaultRange.endDateTime) {
    sp.set('start', filters.startDateTime);
    sp.set('end', filters.endDateTime);
  }
  if (filters.timeMode !== 'off') sp.set('time', filters.timeMode);
  if (filters.vibes.length > 0) sp.set('tags', filters.vibes.join(','));
  if (filters.searchQuery.trim()) sp.set('q', filters.searchQuery.trim());
  sp.set('view', state.view);

  const s = sp.toString();
  return s ? `?${s}` : '';
}
