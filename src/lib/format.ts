import type { ValueSemantic } from '../types'

export function prettyPrintJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function minifyJson(value: unknown): string {
  return JSON.stringify(value)
}

export function stringifyJsonl(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join('\n')
}

export function getValueSemantic(value: unknown): ValueSemantic {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (value === '') return 'empty'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'unknown'
}

export function formatCellValue(value: unknown): string {
  const semantic = getValueSemantic(value)

  if (semantic === 'missing') return 'missing'
  if (semantic === 'null') return 'null'
  if (semantic === 'empty') return '""'
  if (semantic === 'string' || semantic === 'number' || semantic === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function previewStructuredValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty array'
    return value
      .slice(0, 3)
      .map((item) => formatCellValue(item))
      .join(', ')
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return 'empty object'
    return entries
      .slice(0, 3)
      .map(([key, inner]) => `${key}: ${formatCellValue(inner)}`)
      .join(', ')
  }

  return formatCellValue(value)
}

export function semanticKeyword(value: unknown): string {
  const semantic = getValueSemantic(value)
  if (semantic === 'unknown') return typeof value
  return semantic
}
