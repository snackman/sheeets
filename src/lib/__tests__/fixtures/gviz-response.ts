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
