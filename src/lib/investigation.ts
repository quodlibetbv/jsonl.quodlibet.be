import { getValueSemantic } from './format'
import type { ColumnSignal, InvestigationSummary, TableData, ValueSemantic } from '../types'

const ROW_SIGNAL_COLUMNS = (column: string) => column !== '_line'

function dominantKind(counts: Map<ValueSemantic, number>): ValueSemantic | null {
  const entries = [...counts.entries()].sort((left, right) => right[1] - left[1])
  return entries[0]?.[0] ?? null
}

function minorityKinds(counts: Map<ValueSemantic, number>): ValueSemantic[] {
  const entries = [...counts.entries()].sort((left, right) => right[1] - left[1])
  if (entries.length <= 1) return []
  return entries.slice(1).map(([kind]) => kind)
}

function buildColumnSignal(table: TableData, column: string): ColumnSignal {
  const semanticCounts = new Map<ValueSemantic, number>()

  table.rows.forEach((row) => {
    const semantic = getValueSemantic(row[column])
    semanticCounts.set(semantic, (semanticCounts.get(semantic) ?? 0) + 1)
  })

  const distinctKinds = [...semanticCounts.keys()]
  const meaningfulKinds = distinctKinds.filter((kind) => kind !== 'missing')

  return {
    column,
    missingCount: semanticCounts.get('missing') ?? 0,
    nullCount: semanticCounts.get('null') ?? 0,
    emptyCount: semanticCounts.get('empty') ?? 0,
    objectCount: semanticCounts.get('object') ?? 0,
    arrayCount: semanticCounts.get('array') ?? 0,
    presentCount: table.rows.length - (semanticCounts.get('missing') ?? 0),
    dominantKind: dominantKind(new Map(meaningfulKinds.map((kind) => [kind, semanticCounts.get(kind) ?? 0]))),
    distinctKinds: meaningfulKinds,
    mixedKinds: meaningfulKinds.length > 1 ? meaningfulKinds : [],
    minorityKinds: minorityKinds(new Map(meaningfulKinds.map((kind) => [kind, semanticCounts.get(kind) ?? 0]))),
  }
}

export function analyzeTable(table: TableData): InvestigationSummary {
  const dataColumns = table.columns.filter(ROW_SIGNAL_COLUMNS)
  const columnSignals = dataColumns.map((column) => buildColumnSignal(table, column))
  const columnSignalMap = new Map(columnSignals.map((signal) => [signal.column, signal]))

  const rowSignals = table.rows.map((row) => {
    const missingColumns = dataColumns.filter((column) => getValueSemantic(row[column]) === 'missing')
    const nullColumns = dataColumns.filter((column) => getValueSemantic(row[column]) === 'null')
    const emptyColumns = dataColumns.filter((column) => getValueSemantic(row[column]) === 'empty')
    const objectColumns = dataColumns.filter((column) => getValueSemantic(row[column]) === 'object')
    const arrayColumns = dataColumns.filter((column) => getValueSemantic(row[column]) === 'array')
    const suspectScore = missingColumns.length + nullColumns.length + emptyColumns.length + objectColumns.length + arrayColumns.length

    return {
      row,
      missingColumns,
      nullColumns,
      emptyColumns,
      objectColumns,
      arrayColumns,
      suspectScore,
    }
  })

  return {
    rowSignals,
    rowSignalMap: new Map(rowSignals.map((signal) => [signal.row, signal])),
    columnSignals,
    columnSignalMap,
    rowsWithMissing: rowSignals.filter((signal) => signal.missingColumns.length > 0).length,
    rowsWithNull: rowSignals.filter((signal) => signal.nullColumns.length > 0).length,
    rowsWithEmpty: rowSignals.filter((signal) => signal.emptyColumns.length > 0).length,
    rowsWithComplex: rowSignals.filter((signal) => signal.objectColumns.length > 0 || signal.arrayColumns.length > 0).length,
    suspiciousRows: rowSignals.filter((signal) => signal.suspectScore > 0).length,
    sparseColumns: columnSignals.filter((signal) => signal.missingCount > 0).sort((left, right) => right.missingCount - left.missingCount),
    mixedColumns: columnSignals
      .filter((signal) => signal.mixedKinds.length > 0)
      .sort((left, right) => right.mixedKinds.length - left.mixedKinds.length || right.missingCount - left.missingCount),
  }
}

export function rowSignalLabel(rowSignal: InvestigationSummary['rowSignals'][number]): string[] {
  const labels: string[] = []
  if (rowSignal.missingColumns.length > 0) labels.push(`${rowSignal.missingColumns.length} missing`)
  if (rowSignal.nullColumns.length > 0) labels.push(`${rowSignal.nullColumns.length} null`)
  if (rowSignal.emptyColumns.length > 0) labels.push(`${rowSignal.emptyColumns.length} empty`)
  if (rowSignal.objectColumns.length > 0 || rowSignal.arrayColumns.length > 0) labels.push('nested values')
  return labels
}
