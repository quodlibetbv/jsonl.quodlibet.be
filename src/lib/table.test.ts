import { describe, expect, it } from 'vitest'
import { tableDataFromJson, tableDataFromJsonl } from './table'

describe('tableDataFromJson', () => {
  it('infers columns from array of objects', () => {
    const table = tableDataFromJson([{ id: 1, user: { name: 'Ada' } }, { id: 2 }])
    expect(table.columns).toContain('id')
    expect(table.columns).toContain('user.name')
    expect(table.rows[0]['user.name']).toBe('Ada')
  })
})

describe('tableDataFromJsonl', () => {
  it('adds _line column', () => {
    const table = tableDataFromJsonl([
      { line: 4, value: { id: 1 } },
      { line: 5, value: { id: 2 } },
    ])
    expect(table.columns[0]).toBe('_line')
    expect(table.rows[0]._line).toBe(4)
  })
})
