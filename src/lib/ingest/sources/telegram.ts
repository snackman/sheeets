// Telegram public-channel source (Phase 3, plans/event-ingestion.md §3.4,
// §10). Reads `https://t.me/s/<channel>` — the server-rendered HTML
// "widget preview" of a public channel's latest ~20 posts. No API key, no
// bot/admin cooperation needed, works for any public channel. This is NOT
// an official API: poll politely (one GET per channel per run — the cron's
// normal due-source scheduling already serializes that) and extract LINKS
// only. Post text is untrusted, user-supplied data from the internet: it is
// only ever (a) escaped when rendered in the admin queue UI (React does
// this by default) and (b) passed to the classifier inside the same
// JSON-encoded `<event_data>` block every other source's description text
// goes through (`prompt.ts`) — never executed, never treated as
// instructions. See `isAllowlistedEventLink` (`../allowlist`) for the
// separate rule about which DISCOVERED LINKS are actually fetched.
import { safeFetch } from '../../safe-fetch';
import { decodeHtmlEntities } from '../../event-extractors';

/** `t.me/s/<handle>` channel usernames: letters/digits/underscore, Telegram's
 *  own minimum is 5 chars. Anchored so it can't smuggle a path (`../`) or
 *  query string into the fetch URL — only ever interpolated after this test
 *  passes (§10: "Telegram previews come only from https://t.me/s/<handle>
 *  with handle /^[A-Za-z0-9_]{5,32}$/"). */
export const TELEGRAM_HANDLE_RE = /^[A-Za-z0-9_]{5,32}$/;

export function isValidTelegramHandle(handle: string): boolean {
  return TELEGRAM_HANDLE_RE.test(handle);
}

/** Accept a bare handle, an `@handle`, or a `t.me/handle` / `https://t.me/s/handle`
 *  URL and normalize to the bare handle — or null if it doesn't look like a
 *  valid public channel username. Used by the admin "add a Telegram
 *  channel" config flow so pasting any of the common forms works. */
export function normalizeTelegramHandle(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  // Strip a t.me URL down to its path.
  const urlMatch = raw.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/(?:s\/)?([^/?#]+)/i);
  if (urlMatch) raw = urlMatch[1];
  raw = raw.replace(/^@/, '').trim();
  return isValidTelegramHandle(raw) ? raw : null;
}

const TELEGRAM_TIMEOUT_MS = 10_000;
const TELEGRAM_MAX_BYTES = 3 * 1024 * 1024;

/** Fetch the public HTML preview for a channel. Throws `SafeFetchError` (via
 *  `safeFetch`) on any network/SSRF problem — callers should catch and
 *  record it as a run error, same as a Luma feed fetch failing. */
export async function fetchTelegramChannelHtml(handle: string): Promise<string> {
  if (!isValidTelegramHandle(handle)) throw new Error(`Invalid Telegram handle: ${handle}`);
  const res = await safeFetch(`https://t.me/s/${handle}`, {
    timeoutMs: TELEGRAM_TIMEOUT_MS,
    maxBytes: TELEGRAM_MAX_BYTES,
    maxRedirects: 2,
    headers: {
      'User-Agent': 'plan.wtf event-ingest (+https://plan.wtf)',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`Telegram returned ${res.status} for @${handle}.`);
  return res.text;
}

export interface TelegramMessage {
  /** `<channel>/<id>`, from the post's `data-post` attribute. */
  postRef: string;
  /** Canonical message permalink, e.g. `https://t.me/mychannel/1234`. */
  url: string;
  /** Plain text (tags stripped, HTML entities decoded). Untrusted. */
  text: string;
  /** http(s) links found in the message's text (anchor hrefs). Untrusted —
   *  callers must run these through `isAllowlistedEventLink` before ever
   *  fetching one. */
  links: string[];
}

function htmlToPlainText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(stripped).replace(/[ \t]+\n/g, '\n').trim();
}

function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /<a\b[^>]*\bhref="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = decodeHtmlEntities(m[1]);
    if (/^https?:\/\//i.test(href)) hrefs.push(href);
  }
  return hrefs;
}

/**
 * Parse the `t.me/s/<channel>` widget HTML into individual messages.
 *
 * The real markup (verified live, 2026-10-10 per the plan) is a flat list of
 * `<div class="tgme_widget_message_wrap ...">` blocks, each containing one
 * `<div class="tgme_widget_message" data-post="channel/123" ...>` and (for a
 * text post) one `<div class="tgme_widget_message_text ...">...</div>` whose
 * only block-level content is inline tags (`<a>`, `<b>`, `<i>`, `<br>`,
 * emoji `<i>`/`<tg-emoji>`), so a single `</div>` safely closes it — no
 * generic HTML/DOM parser is needed, matching this repo's existing
 * regex-based approach for the other platforms' OG/JSON-LD tags
 * (`event-extractors.ts`). A media-only post (photo/poll, no
 * `tgme_widget_message_text`) is still returned with an empty `text`/`links`
 * so callers can count it without erroring.
 */
export function parseTelegramChannelHtml(html: string): TelegramMessage[] {
  const messages: TelegramMessage[] = [];
  const chunks = html.split('<div class="tgme_widget_message_wrap');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const postMatch = chunk.match(/data-post="([^"]+)"/);
    if (!postMatch) continue;
    const postRef = postMatch[1];

    const textMatch = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const rawTextHtml = textMatch ? textMatch[1] : '';

    messages.push({
      postRef,
      url: `https://t.me/${postRef}`,
      text: htmlToPlainText(rawTextHtml),
      links: extractHrefs(rawTextHtml),
    });
  }
  return messages;
}
