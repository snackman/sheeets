import { describe, it, expect } from 'vitest';
import { dataSheetUrl } from '../data-sheet-url';
import { SHEET_ID } from '../conferences';

describe('dataSheetUrl', () => {
  it('points at the first (soonest) tab gid', () => {
    expect(dataSheetUrl([{ gid: 698718887 }, { gid: 1 }])).toBe(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=698718887#gid=698718887`
    );
  });
  it('supports gid 0', () => {
    expect(dataSheetUrl([{ gid: 0 }])).toContain('?gid=0#gid=0');
  });
  it('falls back to the bare sheet', () => {
    expect(dataSheetUrl([])).toBe(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  });
});
