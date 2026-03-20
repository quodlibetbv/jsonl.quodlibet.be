import { describe, expect, it } from 'vitest'
import { analyzeTable, rowSignalLabel } from './investigation'
import type { TableData } from '../types'

const table: TableData = {
  columns: ['_line', 'id', 'status', 'payload', 'notes'],
  rows: [
    { _line: 1, __raw: {}, id: 1, status: 'ok', payload: { nested: true }, notes: '' },
    { _line: 2, __raw: {}, id: 2, status: null, payload: 'flat' },
    { _line: 3, __raw: {}, id: 3, status: 'error', payload: ['x', 'y'], notes: 'boom' },
  ],
}

describe('analyzeTable', () => {
  it('surfaces sparse, mixed, and suspicious row signals', () => {
    const summary = analyzeTable(table)

    expect(summary.rowsWithMissing).toBe(1)
    expect(summary.rowsWithNull).toBe(1)
    expect(summary.rowsWithComplex).toBe(2)
    expect(summary.sparseColumns[0].column).toBe('notes')
    expect(summary.mixedColumns.map((signal) => signal.column)).toContain('payload')

    const secondRowSignal = summary.rowSignals[1]
    expect(secondRowSignal.missingColumns).toEqual(['notes'])
    expect(secondRowSignal.nullColumns).toEqual(['status'])
    expect(rowSignalLabel(secondRowSignal)).toEqual(['1 missing', '1 null'])
  })
})
