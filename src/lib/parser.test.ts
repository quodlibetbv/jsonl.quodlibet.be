import { describe, expect, it } from 'vitest'
import { detectFormat, parseInput } from './parser'

describe('detectFormat', () => {
  it('detects JSON documents', () => {
    expect(detectFormat('{"name":"Ada"}')).toBe('json')
  })

  it('detects JSONL streams', () => {
    expect(detectFormat('{"a":1}\n{"a":2}')).toBe('jsonl')
  })

  it('prefers jsonl for ndjson extension', () => {
    expect(detectFormat('{"a":1}\n{"a":2}', 'data.ndjson')).toBe('jsonl')
  })
})

describe('parseInput', () => {
  it('parses json with no issues', () => {
    const result = parseInput('{"name":"Ada"}')
    expect(result.format).toBe('json')
    expect(result.issues).toHaveLength(0)
    expect(result.jsonValue).toEqual({ name: 'Ada' })
  })

  it('parses jsonl and keeps line numbers', () => {
    const result = parseInput('{"name":"Ada"}\n{"name":"Linus"}', { manualFormat: 'jsonl' })
    expect(result.format).toBe('jsonl')
    expect(result.jsonlRows).toEqual([
      { line: 1, value: { name: 'Ada' } },
      { line: 2, value: { name: 'Linus' } },
    ])
  })

  it('reports invalid jsonl lines', () => {
    const result = parseInput('{"name":"Ada"}\nnot json\n{"name":"Linus"}', { manualFormat: 'jsonl' })
    expect(result.jsonlRows).toHaveLength(2)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ line: 2 })
  })
})
