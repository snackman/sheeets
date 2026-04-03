import { describe, it, expect } from 'vitest';
import { parseGVizResponse, getCellValue, getCellBool } from '../gviz';
import type { GVizCell } from '../gviz';
import {
  gvizResponseString,
  gvizErrorResponse,
  expectedTable,
} from './fixtures/gviz-response';

describe('parseGVizResponse', () => {
  it('parses a full GViz response with comment and function wrapper', () => {
    const table = parseGVizResponse(gvizResponseString);
    expect(table.cols.length).toBe(expectedTable.cols.length);
    expect(table.rows.length).toBe(expectedTable.rows.length);
  });

  it('returns correct column metadata', () => {
    const table = parseGVizResponse(gvizResponseString);
    expect(table.cols[0].label).toBe('Date');
    expect(table.cols[1].label).toBe('Start Time');
    expect(table.cols[4].label).toBe('Name');
  });

  it('returns correct row data', () => {
    const table = parseGVizResponse(gvizResponseString);
    // First row
    const firstRow = table.rows[0];
    expect(getCellValue(firstRow.c[0])).toBe('Sat, Apr 11');
    expect(getCellValue(firstRow.c[4])).toBe('PBW Opening Keynote');
  });

  it('handles rows where Date cell is null (continuation rows)', () => {
    const table = parseGVizResponse(gvizResponseString);
    const secondRow = table.rows[1];
    // Date is null for second row (same day as first row)
    expect(getCellValue(secondRow.c[0])).toBe('');
    expect(getCellValue(secondRow.c[4])).toBe('DeFi Deep Dive Panel');
  });

  it('throws on error status response', () => {
    expect(() => parseGVizResponse(gvizErrorResponse)).toThrow('GViz query failed');
  });

  it('handles response without comment prefix', () => {
    const noComment = `google.visualization.Query.setResponse(${JSON.stringify({
      version: '0.6',
      reqId: '0',
      status: 'ok',
      table: { cols: [], rows: [] },
    })});`;
    const table = parseGVizResponse(noComment);
    expect(table.cols).toEqual([]);
    expect(table.rows).toEqual([]);
  });

  it('handles response ending with ) instead of );', () => {
    const noSemicolon = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({
      version: '0.6',
      reqId: '0',
      status: 'ok',
      table: { cols: [], rows: [] },
    })})`;
    const table = parseGVizResponse(noSemicolon);
    expect(table.cols).toEqual([]);
  });
});

describe('getCellValue', () => {
  it('returns formatted value (f) over raw value (v)', () => {
    const cell: GVizCell = { v: '$50', f: '$50.00' };
    expect(getCellValue(cell)).toBe('$50.00');
  });

  it('returns raw value when no formatted value', () => {
    const cell: GVizCell = { v: 'hello' };
    expect(getCellValue(cell)).toBe('hello');
  });

  it('returns empty string for null cell', () => {
    expect(getCellValue(null)).toBe('');
  });

  it('returns empty string when v is null and f is not set', () => {
    const cell: GVizCell = { v: null };
    expect(getCellValue(cell)).toBe('');
  });

  it('converts numeric values to string', () => {
    const cell: GVizCell = { v: 42 };
    expect(getCellValue(cell)).toBe('42');
  });

  it('converts boolean values to string', () => {
    const cell: GVizCell = { v: true };
    expect(getCellValue(cell)).toBe('true');
  });

  it('returns formatted value even when it is an empty-looking string', () => {
    const cell: GVizCell = { v: 'raw', f: '' };
    expect(getCellValue(cell)).toBe('');
  });
});

describe('getCellBool', () => {
  it('returns true for boolean true', () => {
    expect(getCellBool({ v: true })).toBe(true);
  });

  it('returns true for "yes"', () => {
    expect(getCellBool({ v: 'yes' })).toBe(true);
  });

  it('returns true for "1"', () => {
    expect(getCellBool({ v: '1' })).toBe(true);
  });

  it('returns true for "y"', () => {
    expect(getCellBool({ v: 'y' })).toBe(true);
  });

  it('returns true for "x"', () => {
    expect(getCellBool({ v: 'x' })).toBe(true);
  });

  it('returns true for checkmark unicode \\u2713', () => {
    expect(getCellBool({ v: '\u2713' })).toBe(true);
  });

  it('returns true for heavy checkmark unicode \\u2714', () => {
    expect(getCellBool({ v: '\u2714' })).toBe(true);
  });

  it('returns true for "TRUE" (case-insensitive)', () => {
    expect(getCellBool({ v: 'TRUE' })).toBe(true);
  });

  it('returns true for "Yes" (case-insensitive)', () => {
    expect(getCellBool({ v: 'Yes' })).toBe(true);
  });

  it('returns false for null cell', () => {
    expect(getCellBool(null)).toBe(false);
  });

  it('returns false for cell with null value', () => {
    expect(getCellBool({ v: null })).toBe(false);
  });

  it('returns false for "no"', () => {
    expect(getCellBool({ v: 'no' })).toBe(false);
  });

  it('returns false for "false"', () => {
    expect(getCellBool({ v: 'false' })).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(getCellBool({ v: '' })).toBe(false);
  });

  it('returns false for "0"', () => {
    expect(getCellBool({ v: '0' })).toBe(false);
  });

  it('returns false for boolean false', () => {
    expect(getCellBool({ v: false })).toBe(false);
  });
});
