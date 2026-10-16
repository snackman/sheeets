import { describe, it, expect } from 'vitest';
import {
  escapeSheetValue,
  forceSheetText,
  eventRowValues,
  mainSectionRowValues,
  dateColumnFormatRequest,
  CURATED_DATE_PATTERN,
  type EventRow,
} from '../google-sheets';

// Bug: ingest-published events were written with valueInputOption=USER_ENTERED
// using plain text like "Oct 31" / "12:00 PM" for Date/Start Time/End Time.
// Sheets parses that as a REAL date/time value, which makes gviz infer the
// whole column as `date`/`datetime` — and then the literal "Start Time"/
// "End Time" header cells (which can't be coerced to that type) come back
// null, breaking `fetchEvents`'s header detection for the whole tab. These
// tests lock in the fix: Date/Start Time/End Time/Cost must always be
// written as forced literal text (leading apostrophe), regardless of
// content, so Sheets/gviz can never re-type them.

describe('forceSheetText', () => {
  it('prefixes a value with an apostrophe to force literal text', () => {
    expect(forceSheetText('Mon, October 5')).toBe("'Mon, October 5");
    expect(forceSheetText('9:00a')).toBe("'9:00a");
  });

  it('forces text even for values Sheets would otherwise parse as a real date', () => {
    // The exact broken-format strings from the production bug.
    expect(forceSheetText('Oct 31')).toBe("'Oct 31");
    expect(forceSheetText('12:00 PM')).toBe("'12:00 PM");
    expect(forceSheetText('6:00 PM')).toBe("'6:00 PM");
  });

  it('forces text even for a cost that looks like currency', () => {
    expect(forceSheetText('$20')).toBe("'$20");
  });

  it('does not double-prefix a value that already starts with an apostrophe', () => {
    expect(forceSheetText("'already escaped")).toBe("'already escaped");
  });

  it('leaves an empty string empty (no bare apostrophe cell)', () => {
    expect(forceSheetText('')).toBe('');
  });
});

describe('escapeSheetValue (unchanged formula-injection guard, for non-date/time columns)', () => {
  it('prefixes values starting with formula-trigger characters', () => {
    expect(escapeSheetValue('=1+1')).toBe("'=1+1");
    expect(escapeSheetValue('+1')).toBe("'+1");
    expect(escapeSheetValue('-1')).toBe("'-1");
    expect(escapeSheetValue('@SUM')).toBe("'@SUM");
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeSheetValue('DeFi Alliance')).toBe('DeFi Alliance');
  });
});

function makeEventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    date: 'Mon, October 5',
    startTime: '9:00a',
    endTime: '6:00p',
    organizer: 'DeFi Alliance',
    name: 'Builders Night',
    address: '123 Main St',
    cost: 'Free',
    tags: 'Devs, Networking',
    link: 'https://luma.com/event/evt-abc123',
    food: true,
    bar: false,
    note: '',
    ...overrides,
  };
}

describe('eventRowValues (the review-section A:L cell builder — fetchEvents never reads this section)', () => {
  it('force-texts Date/Start Time/End Time/Cost (columns A, B, C, G) but not other text columns', () => {
    const values = eventRowValues(makeEventRow());
    expect(values[0]).toBe("'Mon, October 5"); // A: Date
    expect(values[1]).toBe("'9:00a"); // B: Start Time
    expect(values[2]).toBe("'6:00p"); // C: End Time
    expect(values[3]).toBe('DeFi Alliance'); // D: Organizer (not force-texted)
    expect(values[4]).toBe('Builders Night'); // E: Event Name
    expect(values[6]).toBe("'Free"); // G: Cost
  });

  it('force-texts a "$20"-style cost so it cannot become a currency number', () => {
    const values = eventRowValues(makeEventRow({ cost: '$20' }));
    expect(values[6]).toBe("'$20");
  });

  it('reproduces the exact production-bug values and still force-texts them', () => {
    // These are literally the Date/Start/End values the bug report observed
    // on the sheet before the fix — confirms the guard holds even for the
    // old (soon to be repaired) format, not just the new curated one.
    const values = eventRowValues(makeEventRow({ date: 'Oct 31', startTime: '12:00 PM', endTime: '6:00 PM' }));
    expect(values[0]).toBe("'Oct 31");
    expect(values[1]).toBe("'12:00 PM");
    expect(values[2]).toBe("'6:00 PM");
  });

  it('still guards formula injection in text columns via escapeSheetValue', () => {
    const values = eventRowValues(makeEventRow({ organizer: '=cmd|/c calc' }));
    expect(values[3]).toBe("'=cmd|/c calc");
  });

  it('writes Food/Bar as TRUE/FALSE booleans (unaffected by the text-forcing change)', () => {
    const values = eventRowValues(makeEventRow({ food: true, bar: false }));
    expect(values[9]).toBe('TRUE');
    expect(values[10]).toBe('FALSE');
  });

  it('leaves a blank End Time as a blank cell, not a bare apostrophe', () => {
    const values = eventRowValues(makeEventRow({ endTime: '' }));
    expect(values[2]).toBe('');
  });
});

// Bug (follow-up): forcing column A to text broke the OTHER thing gviz
// relies on — the curated tabs' Date column is a REAL Sheets date (verified
// live: "Token2049 2026"/gid 357353145 has `Date(...)` values with number
// format `ddd", "mmmm" "d`). A text value in that date-typed column comes
// back `v: null`/`f: null` from gviz, and `fetchEvents`' carry-forward
// `currentDate` logic silently gives the row the PREVIOUS row's date — same
// class of bug, opposite column. `mainSectionRowValues` (used only by
// `insertEventRowSorted`, the MAIN section fetchEvents reads) must write a
// real date for column A while still force-texting B/C/G.
describe('mainSectionRowValues (the MAIN-section row builder — column A must stay a real date)', () => {
  it('writes column A as a real ISO date (no apostrophe) when dateISO is provided', () => {
    const { values, dateIsRealDate } = mainSectionRowValues(makeEventRow({ dateISO: '2026-10-05' }));
    expect(values[0]).toBe('2026-10-05');
    expect(dateIsRealDate).toBe(true);
  });

  it('still force-texts Start Time/End Time/Cost (unchanged from eventRowValues)', () => {
    const { values } = mainSectionRowValues(makeEventRow({ dateISO: '2026-10-05' }));
    expect(values[1]).toBe("'9:00a");
    expect(values[2]).toBe("'6:00p");
    expect(values[6]).toBe("'Free");
  });

  it('falls back to re-parsing the display date when dateISO is not provided', () => {
    const { values, dateIsRealDate } = mainSectionRowValues(makeEventRow({ date: 'Mon, October 5', dateISO: undefined }));
    expect(values[0]).toBe('2026-10-05');
    expect(dateIsRealDate).toBe(true);
  });

  it('falls back to forced text and reports dateIsRealDate=false when the date cannot be resolved at all', () => {
    const { values, dateIsRealDate } = mainSectionRowValues(makeEventRow({ date: 'not a date', dateISO: undefined }));
    expect(values[0]).toBe("'not a date");
    expect(dateIsRealDate).toBe(false);
  });

  it('prefers dateISO over re-parsing the display text (exact date, no hardcoded-year guessing)', () => {
    // If both are present, dateISO (the real date) wins over re-deriving
    // one from the display string, which would silently assume a single
    // hardcoded year (see `parseDateToISO`).
    const { values } = mainSectionRowValues(makeEventRow({ date: 'Mon, October 5', dateISO: '2027-10-05' }));
    expect(values[0]).toBe('2027-10-05');
  });
});

describe('dateColumnFormatRequest (the curated Date-column number format)', () => {
  it('builds a repeatCell request targeting only column A of the given row', () => {
    const req = dateColumnFormatRequest(698718887, 14);
    expect(req.repeatCell.range).toEqual({
      sheetId: 698718887,
      startRowIndex: 14,
      endRowIndex: 15,
      startColumnIndex: 0,
      endColumnIndex: 1,
    });
  });

  it('sets a DATE number format with the exact curated pattern', () => {
    const req = dateColumnFormatRequest(1, 0);
    expect(req.repeatCell.cell.userEnteredFormat.numberFormat).toEqual({
      type: 'DATE',
      pattern: CURATED_DATE_PATTERN,
    });
    expect(CURATED_DATE_PATTERN).toBe('ddd", "mmmm" "d');
  });

  it('scopes the update to only the numberFormat field (does not touch the cell value)', () => {
    const req = dateColumnFormatRequest(1, 0);
    expect(req.repeatCell.fields).toBe('userEnteredFormat.numberFormat');
  });
});
