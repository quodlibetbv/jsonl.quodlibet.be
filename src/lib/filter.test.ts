import { describe, expect, it } from 'vitest'
import { filterTableData, parseTableQuery, removeQueryToken, stripSortTokens, toggleSortState } from './filter'
import type { TableData } from '../types'

const table: TableData = {
  columns: ['id', 'name', 'score', 'meta.team', 'createdAt', 'payload', 'notes'],
  rows: [
    { __raw: { id: 1 }, id: 1, name: 'Ada Lovelace', score: 98, 'meta.team': 'core', createdAt: '2026-03-18T10:00:00Z', payload: { ok: true }, notes: '' },
    { __raw: { id: 2 }, id: 2, name: 'Linus Torvalds', score: 88, 'meta.team': 'ops', createdAt: '2026-03-20T07:00:00Z', payload: 'timeout', notes: null },
    { __raw: { id: 3 }, id: 3, name: 'Grace Hopper', score: 91, 'meta.team': 'core', createdAt: '2026-03-19T09:30:00Z', payload: ['warn'] },
  ],
}

describe('parseTableQuery', () => {
  it('keeps quoted phrases together and parses structured tokens', () => {
    expect(parseTableQuery('"ada lovelace" meta.team:core score>=90 sort:-id')).toEqual([
      expect.objectContaining({ kind: 'search', value: 'ada lovelace' }),
      expect.objectContaining({ kind: 'filter', column: 'meta.team', operator: 'contains', value: 'core' }),
      expect.objectContaining({ kind: 'filter', column: 'score', operator: 'gte', value: 90 }),
      expect.objectContaining({ kind: 'sort', sort: { column: 'id', direction: 'desc' } }),
    ])
  })
})

describe('filterTableData', () => {
  it('filters by free text', () => {
    const result = filterTableData(table, 'linus')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Linus Torvalds')
  })

  it('filters by field contains syntax', () => {
    const result = filterTableData(table, 'meta.team:core')
    expect(result.rows).toHaveLength(2)
  })

  it('supports exact and numeric comparisons', () => {
    const result = filterTableData(table, 'meta.team=core score>95')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Ada Lovelace')
  })

  it('supports date comparisons', () => {
    const result = filterTableData(table, 'createdAt>=2026-03-19')
    expect(result.rows).toHaveLength(2)
    expect(result.rows.map((row) => row.name)).toEqual(['Linus Torvalds', 'Grace Hopper'])
  })

  it('supports semantic filters for missing, null, empty, and structured values', () => {
    expect(filterTableData(table, 'notes=missing').rows.map((row) => row.name)).toEqual(['Grace Hopper'])
    expect(filterTableData(table, 'notes=null').rows.map((row) => row.name)).toEqual(['Linus Torvalds'])
    expect(filterTableData(table, 'notes=empty').rows.map((row) => row.name)).toEqual(['Ada Lovelace'])
    expect(filterTableData(table, 'payload=object').rows.map((row) => row.name)).toEqual(['Ada Lovelace'])
    expect(filterTableData(table, 'payload=array').rows.map((row) => row.name)).toEqual(['Grace Hopper'])
  })

  it('supports row-level has filters for messy records', () => {
    expect(filterTableData(table, 'has:missing').rows.map((row) => row.name)).toEqual(['Grace Hopper'])
    expect(filterTableData(table, 'has:null').rows.map((row) => row.name)).toEqual(['Linus Torvalds'])
    expect(filterTableData(table, 'has:complex').rows.map((row) => row.name)).toEqual(['Ada Lovelace', 'Grace Hopper'])
    expect(filterTableData(table, 'has:empty').rows.map((row) => row.name)).toEqual(['Ada Lovelace'])
  })

  it('treats quoted semantic words as literal strings', () => {
    const literalTable: TableData = {
      columns: ['id', 'notes'],
      rows: [
        { __raw: {}, id: 1, notes: 'missing' },
        { __raw: {}, id: 2 },
      ],
    }

    expect(filterTableData(literalTable, 'notes="missing"').rows.map((row) => row.id)).toEqual([1])
  })

  it('sorts from the query', () => {
    const result = filterTableData(table, 'meta.team:core sort:-score')
    expect(result.rows.map((row) => row.name)).toEqual(['Ada Lovelace', 'Grace Hopper'])
    expect(result.sort).toEqual({ column: 'score', direction: 'desc' })
    expect(result.sortSource).toBe('query')
  })

  it('falls back to explicit sort state when the query does not specify one', () => {
    const result = filterTableData(table, 'meta.team:core', { column: 'name', direction: 'desc' })
    expect(result.rows.map((row) => row.name)).toEqual(['Grace Hopper', 'Ada Lovelace'])
    expect(result.sortSource).toBe('state')
    expect(result.chips).toContainEqual(
      expect.objectContaining({ kind: 'sort', label: 'sort:-name', source: 'state' }),
    )
  })
})

describe('query helpers', () => {
  it('removes a token by index', () => {
    expect(removeQueryToken('name:ada score>90 sort:-id', 1)).toBe('name:ada sort:-id')
  })

  it('strips sort tokens', () => {
    expect(stripSortTokens('name:ada sort:-id score>90')).toBe('name:ada score>90')
  })

  it('cycles sort state for a column', () => {
    expect(toggleSortState(null, 'name')).toEqual({ column: 'name', direction: 'asc' })
    expect(toggleSortState({ column: 'name', direction: 'asc' }, 'name')).toEqual({ column: 'name', direction: 'desc' })
    expect(toggleSortState({ column: 'name', direction: 'desc' }, 'name')).toBeNull()
    expect(toggleSortState({ column: 'id', direction: 'desc' }, 'name')).toEqual({ column: 'name', direction: 'asc' })
  })
})
