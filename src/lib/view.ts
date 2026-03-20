import type { ParsedResult, ViewMode } from '../types'

export function describeValueShape(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return typeof value
}

export function getRecommendedView(parsed: ParsedResult, tableRowCount: number): ViewMode {
  const hasInput = parsed.sourceText.trim().length > 0
  if (!hasInput) return 'raw'

  if (parsed.format === 'unknown') {
    return parsed.issues.length > 0 ? 'errors' : 'raw'
  }

  if (parsed.format === 'json') {
    if (parsed.issues.length > 0) return 'errors'
    if (Array.isArray(parsed.jsonValue)) return tableRowCount > 0 ? 'table' : 'raw'
    if (typeof parsed.jsonValue === 'object' && parsed.jsonValue !== null) return tableRowCount > 0 ? 'table' : 'tree'
    return 'raw'
  }

  if (parsed.format === 'jsonl') {
    if (tableRowCount > 0) return 'table'
    if (parsed.issues.length > 0) return 'errors'
    return 'raw'
  }

  return 'raw'
}

export function getRecommendedViewReason(parsed: ParsedResult, tableRowCount: number): string {
  if (!parsed.sourceText.trim()) return 'Waiting for input.'

  if (parsed.format === 'unknown') {
    return parsed.issues.length > 0 ? 'The payload does not parse cleanly yet, so the error list is the best first stop.' : 'Showing the raw payload first.'
  }

  if (parsed.format === 'json') {
    if (parsed.issues.length > 0) return 'Forced JSON mode found a parse error, so the error list is the clearest first view.'
    if (Array.isArray(parsed.jsonValue)) return tableRowCount > 0 ? 'Top-level arrays are easiest to scan as rows first.' : 'Showing the raw payload first.'
    if (typeof parsed.jsonValue === 'object' && parsed.jsonValue !== null) {
      return tableRowCount > 0 ? 'Flattened object fields are easiest to scan in the table first.' : 'Structured JSON objects are easiest to inspect as a tree first.'
    }
    return 'Scalar JSON values are clearest in raw form first.'
  }

  if (parsed.format === 'jsonl') {
    if (tableRowCount > 0) return 'JSONL streams are easiest to inspect in a table first.'
    if (parsed.issues.length > 0) return 'No valid JSONL rows were recovered, so the error list is the best place to start.'
  }

  return 'Showing the raw payload first.'
}
