import { describe, expect, it } from 'vitest'
import { formatCellValue, getValueSemantic, minifyJson, prettyPrintJson, previewStructuredValue, stringifyJsonl } from './format'

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
    expect(formatCellValue(undefined)).toBe('missing')
    expect(formatCellValue(null)).toBe('null')
  })

  it('classifies value semantics', () => {
    expect(getValueSemantic(undefined)).toBe('missing')
    expect(getValueSemantic('')).toBe('empty')
    expect(getValueSemantic([])).toBe('array')
    expect(getValueSemantic({ ok: true })).toBe('object')
  })

  it('previews structured values without dumping the whole payload', () => {
    expect(previewStructuredValue(['Ada', 'Linus', 'Grace', 'Margaret'])).toBe('Ada, Linus, Grace')
    expect(previewStructuredValue({ id: 42, ok: true, detail: 'boom', extra: 'ignored' })).toBe('id: 42, ok: true, detail: boom')
  })
})
