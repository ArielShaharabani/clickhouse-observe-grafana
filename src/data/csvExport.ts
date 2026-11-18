/**
 * DISC-SESSION-01 "Export tab results (CSV)": turns grid rows into an RFC 4180 CSV string.
 *
 * Cells are untrusted log data, so besides quoting they get a formula-injection guard: a value a
 * spreadsheet would evaluate (leading `=`, `+`, `-`, `@`, tab or carriage return) is prefixed with
 * `'` so Excel / Sheets / LibreOffice show it as text instead of running it (OWASP CSV injection).
 */
import { SelectedColumn } from '../types';

/** Rows fetched for one export (the grid itself pages 200 at a time). */
export const CSV_EXPORT_LIMIT = 10000;

const FORMULA_START = /^[=+\-@\t\r]/;

/** Plain text for one cell, before CSV quoting. */
export function csvCellText(col: Pick<SelectedColumn, 'type'>, raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }
  if (col.type === 'time') {
    const d = typeof raw === 'number' ? new Date(raw) : raw instanceof Date ? raw : null;
    if (d && !Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
    return String(raw);
  }
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

/** Neutralises spreadsheet formulas, then quotes per RFC 4180 when needed. */
export function csvEscape(text: string): string {
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) || guarded !== guarded.trim() ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Header row = column display names, one line per row, CRLF line endings (RFC 4180). */
export function rowsToCsv(
  columns: Array<Pick<SelectedColumn, 'key' | 'displayName' | 'type'>>,
  rows: Array<Record<string, unknown>>
): string {
  const lines = [columns.map((c) => csvEscape(c.displayName)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(csvCellText(c, row[c.key]))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** `discover-<view>-<yyyy-mm-ddThh-mm-ss>.csv`, filesystem-safe. */
export function csvFileName(viewName: string | undefined, now: Date = new Date()): string {
  const view = (viewName || 'logs').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'logs';
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  return `discover-${view}-${stamp}.csv`;
}

/** Triggers a browser download (UTF-8 with BOM so Excel detects the encoding). */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
