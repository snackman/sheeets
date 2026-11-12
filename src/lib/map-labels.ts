/**
 * Zoom thresholds for map marker labels. Below LABEL_MIN_ZOOM venue labels
 * collide badly (especially on phone-width maps), so only pins are drawn.
 * Featured events keep their label slightly further out because there are few
 * of them and they are the ones we most want people to see.
 */
export const LABEL_MIN_ZOOM = 13;
export const FEATURED_LABEL_MIN_ZOOM = 12;
export const ORGANIZER_MIN_ZOOM = 14.4;
export const TAG_ICON_MIN_ZOOM = 15;

export interface LabelVisibility {
  showLabel: boolean;
  showOrganizer: boolean;
  showTagIcons: boolean;
}

export function getLabelVisibility(
  zoom: number,
  opts: { hasLabel: boolean; isFeatured?: boolean },
): LabelVisibility {
  const min = opts.isFeatured ? FEATURED_LABEL_MIN_ZOOM : LABEL_MIN_ZOOM;
  const showLabel = opts.hasLabel && zoom >= min;
  return {
    showLabel,
    showOrganizer: showLabel && zoom >= ORGANIZER_MIN_ZOOM,
    showTagIcons: showLabel && zoom >= TAG_ICON_MIN_ZOOM,
  };
}

/** True when the primary input is touch (phones/tablets). SSR-safe. */
export function isTouchPrimary(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
