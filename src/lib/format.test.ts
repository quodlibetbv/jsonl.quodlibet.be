import { describe, expect, it } from 'vitest'
import { formatCellValue, minifyJson, prettyPrintJson, stringifyJsonl } from './format'

describe('format helpers', () => {
  it('pretty prints json', () => {
    expect(prettyPrintJson({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('minifies json', () => {
    expect(minifyJson({ a: 1 })).toBe('{"a":1}')
  })

  it('stringifies jsonl', () => {
    expect(stringifyJsonl([{ a: 1 }, { a: 2 }])).toBe('{"a":1}\n{"a":2}')
  })

  it('formats missing and null values clearly', () => {
    expect(formatCellValue(undefined)).toBe('—')
    expect(formatCellValue(null)).toBe('null')
  })
})
