// CSV export for tables: RFC 4180 quoting, downloaded as a file.

const cell = (value) => {
  if (value === null || value === undefined) return ''
  const text = value instanceof Date ? value.toISOString() : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Build CSV text from a header row and data rows (arrays of cell values). */
export function toCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
}

/** Offer CSV text to the browser as a download. */
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
