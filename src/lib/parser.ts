import type { DetectedFormat, ParsedResult, ParseIssue } from '../types'

function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}

export function detectFormat(text: string, filename?: string): DetectedFormat {
  const trimmed = text.trim()
  if (!trimmed) return 'unknown'

  const lower = filename?.toLowerCase()
  const isJsonlExtension = Boolean(lower && (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')))

  const whole = safeJsonParse(trimmed)
  if (whole.ok && !isJsonlExtension) return 'json'

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length > 1) {
    const allLinesJson = lines.every((line) => safeJsonParse(line).ok)
    if (allLinesJson) return 'jsonl'
  }

  if (whole.ok) return 'json'
  if (isJsonlExtension) return 'jsonl'
  return 'unknown'
}

export function parseInput(
  text: string,
  options?: { manualFormat?: DetectedFormat | 'auto'; filename?: string; skipInvalidJsonl?: boolean },
): ParsedResult {
  const sourceText = text
  const trimmed = text.trim()
  const manualFormat = options?.manualFormat ?? 'auto'
  const chosenFormat = manualFormat === 'auto' ? detectFormat(text, options?.filename) : manualFormat
  const issues: ParseIssue[] = []

  if (!trimmed) {
    return { format: 'unknown', sourceText, jsonlRows: [], issues: [] }
  }

  if (chosenFormat === 'json') {
    const parsed = safeJsonParse(trimmed)
    if (parsed.ok) {
      return { format: 'json', sourceText, jsonValue: parsed.value, jsonlRows: [], issues: [] }
    }

    return {
      format: 'json',
      sourceText,
      jsonlRows: [],
      issues: [{ message: parsed.error }],
    }
  }

  if (chosenFormat === 'jsonl' || chosenFormat === 'unknown') {
    const rows = [] as ParsedResult['jsonlRows']
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)

    lines.forEach((line, index) => {
      if (!line.trim()) return
      const parsed = safeJsonParse(line)
      if (parsed.ok) {
        rows.push({ line: index + 1, value: parsed.value })
      } else {
        issues.push({ line: index + 1, message: parsed.error, content: line })
      }
    })

    if (rows.length > 0) {
      return {
        format: chosenFormat === 'unknown' ? 'jsonl' : chosenFormat,
        sourceText,
        jsonlRows: options?.skipInvalidJsonl ? rows : rows,
        issues,
      }
    }

    const whole = safeJsonParse(trimmed)
    if (whole.ok) {
      return { format: 'json', sourceText, jsonValue: whole.value, jsonlRows: [], issues: [] }
    }

    return {
      format: chosenFormat,
      sourceText,
      jsonlRows: [],
      issues: issues.length ? issues : [{ message: whole.ok ? 'Unknown parse error' : whole.error }],
    }
  }

  return { format: 'unknown', sourceText, jsonlRows: [], issues: [{ message: 'Could not detect input format' }] }
}
