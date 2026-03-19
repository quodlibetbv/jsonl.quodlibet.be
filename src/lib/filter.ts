import { formatCellValue } from './format'
import type { TableData, TableRow } from '../types'

export function rowMatchesSearch(row: TableRow, columns: string[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return columns.some((column) => formatCellValue(row[column]).toLowerCase().includes(q))
}

export function rowMatchesColumnFilters(row: TableRow, filters: Record<string, string>): boolean {
  return Object.entries(filters).every(([column, raw]) => {
    const q = raw.trim().toLowerCase()
    if (!q) return true
    return formatCellValue(row[column]).toLowerCase().includes(q)
  })
}

export function filterTableData(
  table: TableData,
  search: string,
  columnFilters: Record<string, string>,
): TableData {
  const rows = table.rows.filter((row) => rowMatchesSearch(row, table.columns, search) && rowMatchesColumnFilters(row, columnFilters))
  return { columns: table.columns, rows }
}
