/** A small helper for the no-login demo: rows to CSV text, and a client-side download of it. Nothing is sent anywhere. Simulated demo data: no real users or sales. */
export type CsvCell = string | number | null | undefined;

const cell = (v: CsvCell): string => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // a text cell that starts like a spreadsheet formula stays text
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows (the first one is usually the header) as CSV text, lines ended with CRLF. */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Starts a browser download of the rows as `filename` (a Blob and a temporary link, then both are released). Does nothing outside a browser. */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
