/**
 * CSV generation for spreadsheet export.
 */

/**
 * A cell beginning with = + - @ (or a tab/CR) is treated as a formula by Excel,
 * Sheets and LibreOffice. A supplier called "=cmd|'/c calc'!A1" would therefore
 * execute on open — the export is data, so it must never be able to run.
 * Prefixing with an apostrophe makes the spreadsheet treat it as text.
 */
function neutraliseFormula(value) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  // Prisma Decimal and similar objects stringify sensibly; numbers stay bare so
  // the spreadsheet treats them as numbers rather than text.
  const raw = typeof value === 'object' && typeof value.toString === 'function'
    ? value.toString()
    : String(value);

  const text = neutraliseFormula(raw);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Builds a CSV document.
 * @param {Array<{key:string,label:string,get?:Function}>} columns
 * @param {Array<object>} rows
 */
export function toCsv(columns, rows) {
  const header = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => cell(c.get ? c.get(row) : row[c.key])).join(',')
  );
  // CRLF is what Excel expects; the BOM stops it mangling accented characters.
  return '﻿' + [header, ...body].join('\r\n') + '\r\n';
}

/** Sends a CSV as a download with a dated filename. */
export function sendCsv(res, filename, columns, rows) {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}-${stamp}.csv"`);
  // Exported business data must never sit in a shared cache.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(toCsv(columns, rows));
}

export const money = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2));
export const isoDate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
export const isoDateTime = (v) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 16) : '');
