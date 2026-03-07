/**
 * Barrel re-export -- all consumers that import from '@/lib/constants'
 * continue to work without changes.
 *
 * Prefer importing from the focused module directly in new code:
 *   import { EVENT_TABS } from '@/lib/conferences';
 *   import { VIBE_COLORS } from '@/lib/tags';
 */

export {
  SHEET_ID,
  EVENT_TABS,
  DEFAULT_TAB,
  getTabConfig,
  getTabBySlug,
  CONFERENCE_TIMEZONE,
  EVENT_DATES,
  DENVER_CENTER,
  TIME_RANGES,
} from './conferences';

export { VIBE_COLORS, TYPE_TAGS } from './tags';

export { STORAGE_KEYS } from './storage-keys';

export { POI_CATEGORIES, MAX_POIS } from './pois';

export { REACTION_EMOJIS } from './reactions';
