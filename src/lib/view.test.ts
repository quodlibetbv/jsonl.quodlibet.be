import { describe, expect, it } from 'vitest'
import { getRecommendedView, getRecommendedViewReason, describeValueShape } from './view'
import type { ParsedResult } from '../types'

function parsed(overrides: Partial<ParsedResult>): ParsedResult {
  return {
    format: 'unknown',
    sourceText: '',
    jsonlRows: [],
    issues: [],
    ...overrides,
  }
}

describe('describeValueShape', () => {
  it('describes arrays, objects, null, and scalars', () => {
    expect(describeValueShape([1, 2])).toBe('array')
    expect(describeValueShape({ ok: true })).toBe('object')
    expect(describeValueShape(null)).toBe('null')
    expect(describeValueShape('hi')).toBe('string')
  })
})

describe('getRecommendedView', () => {
  it('prefers table for parsed json objects when rows are available', () => {
    expect(getRecommendedView(parsed({ format: 'json', sourceText: '{"a":1}', jsonValue: { a: 1 } }), 1)).toBe('table')
  })

  it('prefers table for top-level json arrays', () => {
    expect(getRecommendedView(parsed({ format: 'json', sourceText: '[{"a":1}]', jsonValue: [{ a: 1 }] }), 1)).toBe('table')
  })

  it('prefers table for jsonl with valid rows', () => {
    expect(
      getRecommendedView(
        parsed({ format: 'jsonl', sourceText: '{"a":1}\n{"a":2}', jsonlRows: [{ line: 1, value: { a: 1 } }, { line: 2, value: { a: 2 } }] }),
        2,
      ),
    ).toBe('table')
  })

  it('prefers errors for invalid payloads', () => {
    expect(
      getRecommendedView(parsed({ format: 'unknown', sourceText: '{', issues: [{ message: 'Unexpected end of JSON input' }] }), 0),
    ).toBe('errors')
  })

  it('prefers raw for scalar json values', () => {
    expect(getRecommendedView(parsed({ format: 'json', sourceText: '42', jsonValue: 42 }), 1)).toBe('raw')
  })
})

describe('getRecommendedViewReason', () => {
  it('explains why table is recommended for flattened json objects', () => {
    expect(
      getRecommendedViewReason(parsed({ format: 'json', sourceText: '{"a":1}', jsonValue: { a: 1 } }), 1),
    ).toMatch(/table first/i)
  })

  it('explains why table is recommended for jsonl', () => {
    expect(
      getRecommendedViewReason(parsed({ format: 'jsonl', sourceText: '{"a":1}', jsonlRows: [{ line: 1, value: { a: 1 } }] }), 1),
    ).toMatch(/table first/i)
  })
})
