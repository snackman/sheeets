// src/lib/gviz.ts

export interface GVizCell {
  v: string | number | boolean | null;
  f?: string;
}

export interface GVizRow {
  c: (GVizCell | null)[];
}

export interface GVizTable {
  cols: { id: string; label: string; type: string }[];
  rows: GVizRow[];
}

export function parseGVizResponse(response: string): GVizTable {
  let jsonStr = response;
  // Remove leading comment (/*O_o*/)
  if (jsonStr.startsWith('/*')) {
    const commentEnd = jsonStr.indexOf('*/');
    if (commentEnd !== -1) jsonStr = jsonStr.substring(commentEnd + 2).trim();
  }
  // Remove function wrapper
  const fn = 'google.visualization.Query.setResponse(';
  if (jsonStr.startsWith(fn)) {
    jsonStr = jsonStr.substring(fn.length);
  }
  if (jsonStr.endsWith(');')) jsonStr = jsonStr.slice(0, -2);
  else if (jsonStr.endsWith(')')) jsonStr = jsonStr.slice(0, -1);

  const parsed = JSON.parse(jsonStr);
  if (parsed.status !== 'ok') {
    throw new Error(`GViz query failed: ${parsed.status}`);
  }
  return parsed.table;
}

export function getCellValue(cell: GVizCell | null): string {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null) return String(cell.f);
  if (cell.v !== undefined && cell.v !== null) return String(cell.v);
  return '';
}

export function getCellBool(cell: GVizCell | null): boolean {
  if (!cell || !cell.v) return false;
  const val = String(cell.v).toLowerCase().trim();
  return ['true', 'yes', '1', 'y', 'x', '\u2713', '\u2714'].includes(val);
}
