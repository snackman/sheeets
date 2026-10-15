/**
 * Pure selection logic for ListView's floating sticky date header.
 *
 * Extracted so it can be unit tested without mounting the virtualized list.
 * See capers-31744: the header used to flash/jump when scrolling near the
 * top because it had a first-item special case and a "default to first
 * header" fallback that disagreed with each other during the measurement
 * window. The rule here is intentionally simple: hide at the very top,
 * otherwise show the last date header that has scrolled past the top edge.
 */

export interface DateHeaderOffset {
  label: string;
  eventCount: number;
  /** Offset (in px) of this header's start within the scrollable list. */
  start: number;
}

export interface StickyDateHeaderValue {
  label: string;
  eventCount: number;
}

/** px of scrollTop within which the sticky overlay stays hidden. */
export const STICKY_HEADER_HIDE_THRESHOLD = 4;

/**
 * Pick which date header (if any) the sticky overlay should show.
 *
 * `headers` must be ordered ascending by `start` (i.e. in document order).
 */
export function selectStickyDateHeader(
  headers: DateHeaderOffset[],
  scrollTop: number,
  hideThreshold: number = STICKY_HEADER_HIDE_THRESHOLD,
): StickyDateHeaderValue | null {
  if (scrollTop <= hideThreshold) return null;

  let selected: DateHeaderOffset | null = null;
  for (const header of headers) {
    if (header.start <= scrollTop) {
      selected = header;
    } else {
      break;
    }
  }

  return selected ? { label: selected.label, eventCount: selected.eventCount } : null;
}

/** True when two sticky header values are equivalent (avoids redundant setState). */
export function stickyDateHeaderEquals(
  a: StickyDateHeaderValue | null,
  b: StickyDateHeaderValue | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.label === b.label && a.eventCount === b.eventCount;
}
