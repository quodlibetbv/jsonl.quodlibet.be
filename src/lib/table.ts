import type { JsonlRow, TableData, TableRow } from '../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function flattenObject(value: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  Object.entries(value).forEach(([key, inner]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key
    if (isRecord(inner)) {
      Object.assign(out, flattenObject(inner, nextKey))
    } else {
      out[nextKey] = inner
    }
  })

  return out
}

function toRow(value: unknown, line?: number): TableRow {
  if (isRecord(value)) {
    return { ...(line ? { _line: line } : {}), __raw: value, ...flattenObject(value) }
  }

  if (Array.isArray(value)) {
    return { ...(line ? { _line: line } : {}), __raw: value, value: JSON.stringify(value) }
  }

  return { ...(line ? { _line: line } : {}), __raw: value, value }
}

function collectColumns(rows: TableRow[]): string[] {
  const cols = new Set<string>()
  if (rows.some((row) => row._line !== undefined)) cols.add('_line')
  rows.forEach((row) => {
    Object.keys(row)
      .filter((key) => key !== '__raw')
      .forEach((key) => cols.add(key))
  })
  return [...cols]
}

export function tableDataFromJson(value: unknown): TableData {
  if (Array.isArray(value)) {
    const rows = value.map((item) => toRow(item))
    return { rows, columns: collectColumns(rows) }
  }

  const rows = [toRow(value)]
  return { rows, columns: collectColumns(rows) }
}

export function tableDataFromJsonl(rowsInput: JsonlRow[]): TableData {
  const rows = rowsInput.map((row) => toRow(row.value, row.line))
  return { rows, columns: collectColumns(rows) }
}
