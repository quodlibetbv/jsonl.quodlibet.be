import { describe, expect, it } from 'vitest'
import { filterTableData } from './filter'
import type { TableData } from '../types'

const table: TableData = {
  columns: ['id', 'name', 'meta.team'],
  rows: [
    { __raw: { id: 1 }, id: 1, name: 'Ada', 'meta.team': 'core' },
    { __raw: { id: 2 }, id: 2, name: 'Linus', 'meta.team': 'ops' },
    { __raw: { id: 3 }, id: 3, name: 'Grace', 'meta.team': 'core' },
  ],
}

describe('filterTableData', () => {
  it('filters by global search', () => {
    const result = filterTableData(table, 'lin', {})
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Linus')
  })

  it('filters by column filters', () => {
    const result = filterTableData(table, '', { 'meta.team': 'core' })
    expect(result.rows).toHaveLength(2)
  })

  it('combines global and column filters', () => {
    const result = filterTableData(table, 'gr', { 'meta.team': 'core' })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Grace')
  })
})
