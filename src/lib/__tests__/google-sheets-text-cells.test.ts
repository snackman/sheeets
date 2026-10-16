import { describe, it, expect } from 'vitest';
import { escapeSheetValue, forceSheetText, eventRowValues, type EventRow } from '../google-sheets';

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

describe('eventRowValues (the publisher\'s A:L cell builder)', () => {
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
