function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  const needsQuotes = /[",\r\n]/.test(str);
  const safe = str.replace(/"/g, '""');
  return needsQuotes ? `"${safe}"` : safe;
}

export function downloadCsvWithBom(filename: string, headers: string[], rows: unknown[][]): void {
  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  const content = '\uFEFF' + csvLines.join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
