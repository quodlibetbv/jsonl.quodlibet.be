export function prettyPrintJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function minifyJson(value: unknown): string {
  return JSON.stringify(value)
}

export function stringifyJsonl(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join('\n')
}

export function formatCellValue(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (value === '') return '""'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
