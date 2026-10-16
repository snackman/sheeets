/**
 * Realistic GViz API response string for testing parseGVizResponse.
 *
 * The Google Visualization API wraps the JSON in a comment and function call:
 *   /*O_o*​/ google.visualization.Query.setResponse({...});
 *
 * The table has columns matching the sheeets spreadsheet layout:
 *   A: Date, B: Start Time, C: End Time, D: Organizer, E: Name,
 *   F: Address, G: Cost, H: Tags, I: Link, J: Food, K: Bar, L: Note, M: Featured
 */

const gvizTable = {
  version: '0.6',
  reqId: '0',
  status: 'ok',
  sig: '12345',
  table: {
    cols: [
      { id: 'A', label: 'Date', type: 'string' },
      { id: 'B', label: 'Start Time', type: 'string' },
      { id: 'C', label: 'End Time', type: 'string' },
      { id: 'D', label: 'Organizer', type: 'string' },
      { id: 'E', label: 'Name', type: 'string' },
      { id: 'F', label: 'Address', type: 'string' },
      { id: 'G', label: 'Cost', type: 'string' },
      { id: 'H', label: 'Tags', type: 'string' },
      { id: 'I', label: 'Link', type: 'string' },
      { id: 'J', label: 'Food', type: 'boolean' },
      { id: 'K', label: 'Bar', type: 'boolean' },
      { id: 'L', label: 'Note', type: 'string' },
      { id: 'M', label: 'Featured', type: 'boolean' },
    ],
    rows: [
      {
        c: [
          { v: 'Sat, Apr 11' },
          { v: '9:00a' },
          { v: '5:00p' },
          { v: 'ETH Foundation' },
          { v: 'PBW Opening Keynote' },
          { v: '123 Rue de Rivoli, Paris' },
          { v: 'Free' },
          { v: 'Conference, ETH, Devs/Builders' },
          { v: 'https://example.com/pbw-keynote' },
          { v: true },
          { v: false },
          { v: 'Main stage event' },
          { v: false },
        ],
      },
      {
        c: [
          { v: null },
          { v: '2:00p' },
          { v: '4:00p' },
          { v: 'DeFi Alliance' },
          { v: 'DeFi Deep Dive Panel' },
          { v: '45 Avenue des Champs-Elysees, Paris' },
          { v: '$50', f: '$50.00' },
          { v: 'Panel/Talk, DeFi' },
          { v: 'https://example.com/defi-panel' },
          { v: false },
          { v: 'yes' },
          { v: null },
          { v: false },
        ],
      },
      {
        c: [
          { v: 'Sun, Apr 12' },
          { v: 'All Day' },
          { v: null },
          { v: 'Paris Crypto Collective' },
          { v: 'PBW Hackathon Day 1' },
          { v: 'Station F, Paris' },
          { v: 'Free' },
          { v: 'Hackathon, Devs/Builders' },
          { v: 'https://example.com/hackathon' },
          { v: true },
          { v: false },
          { v: 'Bring your laptop' },
          { v: false },
        ],
      },
    ],
  },
};

/** Full GViz response string with comment prefix and function wrapper */
export const gvizResponseString = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(gvizTable)});`;

/** GViz response without the wrapper (plain JSON) for testing edge cases */
export const gvizResponsePlainJson = JSON.stringify(gvizTable);

/** GViz response with error status */
export const gvizErrorResponse = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({
  version: '0.6',
  reqId: '0',
  status: 'error',
  errors: [{ reason: 'invalid_query', message: 'Bad query', detailed_message: 'The query is invalid.' }],
})});`;

/** The expected parsed table (for assertions) */
export const expectedTable = gvizTable.table;

/**
 * Realistic GViz response for a tab where the ingest publisher's old bug
 * ("Oct 31" / "12:00 PM" written as real Sheets date/time values) has
 * already poisoned the Start Time / End Time columns — modeled directly on
 * the live response fetched from the broken "Devcon 8 2026" tab (gid
 * 698718887) while debugging this issue.
 *
 * Once gviz sees a real date/time value anywhere in a column, it infers
 * the WHOLE column's type as `date`/`datetime` — so the literal "Start
 * Time"/"End Time" header-row text in that same column can't be coerced
 * to that type and comes back as `v: null` with no `f` either (same for
 * the promo rows above the header, and for the one all-day row with no
 * time at all). Column E ("Event Name") stays `string` throughout, which
 * is what `findHeaderIndex`'s fallback in `fetch-events.ts` relies on.
 */
const typedColumnsTable = {
  version: '0.6',
  reqId: '0',
  status: 'ok',
  sig: '67890',
  table: {
    cols: [
      { id: 'A', label: 'Promo banner text', type: 'date', pattern: 'mmm d' },
      { id: 'B', label: '', type: 'datetime', pattern: 'h:mm am/pm' },
      { id: 'C', label: '', type: 'datetime', pattern: 'h:mm am/pm' },
      { id: 'D', label: '', type: 'string' },
      { id: 'E', label: '', type: 'string' },
      { id: 'F', label: '', type: 'string' },
      { id: 'G', label: '', type: 'string' },
      { id: 'H', label: '', type: 'string' },
      { id: 'I', label: '', type: 'string' },
      { id: 'J', label: '', type: 'boolean' },
      { id: 'K', label: '', type: 'boolean' },
      { id: 'L', label: '', type: 'string' },
      { id: 'M', label: '', type: 'boolean' },
    ],
    rows: [
      // Promo rows above the header — col B/C null because they can't be
      // coerced to `datetime` (col E null too, just plain unused here).
      { c: [null, null, null, { v: 'Jen' }, null, { v: 'Header Highlight - $500' }, null, null, null, null, null, null, null] },
      { c: [null, null, null, null, { v: "Crypto's biggest stories" }, null, null, null, null, null, null, null, null] },
      // Header row: col B/C text can't coerce to `datetime` -> null/no `f`.
      // Col E ("Event Name") is the only reliable signal here.
      { c: [null, null, null, { v: 'Organizer' }, { v: 'Event Name' }, { v: 'Address' }, { v: 'Cost' }, { v: 'Tags' }, { v: 'Link' }, { v: 'Food' }, { v: 'Bar' }, { v: 'Note' }, { v: 'Featured' }] },
      // Data row 1: real date/time values, `f` carries the display text.
      {
        c: [
          { v: 'Date(2026,10,31)', f: 'Sat, November 31' },
          { v: 'Date(1899,11,30,12,0,0)', f: '12:00 PM' },
          { v: 'Date(1899,11,30,18,0,0)', f: '6:00 PM' },
          { v: 'Luma: Devcon 8 Side Events (official)' },
          { v: 'India Blockchain Tour 2026 - Mumbai Node' },
          { v: 'Mumbai, India' },
          { v: 'Free' },
          { v: 'Conference' },
          { v: 'https://example.com/mumbai-node' },
          { v: false },
          { v: false },
          { v: null },
          { v: false },
        ],
      },
      // Data row 2: an all-day event — no time value at all in col B/C.
      {
        c: [
          { v: 'Date(2026,10,1)', f: 'Nov 1' },
          null,
          null,
          { v: 'Orviq Labs' },
          { v: 'All-Day Hackathon' },
          { v: 'Bandra West, Mumbai' },
          { v: 'Free' },
          { v: 'Hackathon' },
          { v: 'https://example.com/hackathon' },
          { v: true },
          { v: false },
          { v: null },
          { v: false },
        ],
      },
    ],
  },
};

/** Full GViz response string (comment prefix + function wrapper) for the
 *  typed-columns / poisoned-header scenario above. */
export const gvizTypedColumnsResponseString = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(typedColumnsTable)});`;

export const expectedTypedColumnsTable = typedColumnsTable.table;
