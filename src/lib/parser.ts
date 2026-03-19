import type { DetectedFormat, ParsedResult, ParseIssue } from '../types'

function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' }
  }
}

function isStructuredJsonValue(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

function shouldAutoTreatAsJsonl(rows: ParsedResult['jsonlRows'], issues: ParseIssue[], nonEmptyLineCount: number): boolean {
  if (nonEmptyLineCount <= 1 || rows.length === 0) return false
  if (issues.length === 0 && rows.length === nonEmptyLineCount) return true
  return rows.length >= 2 && rows.every((row) => isStructuredJsonValue(row.value))
}

function parseJsonlLines(text: string): {
  rows: ParsedResult['jsonlRows']
  issues: ParseIssue[]
  nonEmptyLineCount: number
} {
  const rows: ParsedResult['jsonlRows'] = []
  const issues: ParseIssue[] = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  let nonEmptyLineCount = 0

  lines.forEach((line, index) => {
    if (!line.trim()) return
    nonEmptyLineCount += 1
    const parsed = safeJsonParse(line)
    if (parsed.ok) {
      rows.push({ line: index + 1, value: parsed.value })
    } else {
      issues.push({ line: index + 1, message: parsed.error, content: line })
    }
  })

  return { rows, issues, nonEmptyLineCount }
}

export function detectFormat(text: string, filename?: string): DetectedFormat {
  const trimmed = text.trim()
  if (!trimmed) return 'unknown'

  const lower = filename?.toLowerCase()
  const isJsonlExtension = Boolean(lower && (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')))

  const whole = safeJsonParse(trimmed)
  if (whole.ok && !isJsonlExtension) return 'json'

  const jsonl = parseJsonlLines(text)
  if (shouldAutoTreatAsJsonl(jsonl.rows, jsonl.issues, jsonl.nonEmptyLineCount)) return 'jsonl'

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

  if (chosenFormat === 'jsonl') {
    const jsonl = parseJsonlLines(text)
    return {
      format: 'jsonl',
      sourceText,
      jsonlRows: jsonl.rows,
      issues: jsonl.issues,
    }
  }

  const whole = safeJsonParse(trimmed)
  if (whole.ok) {
    return { format: 'json', sourceText, jsonValue: whole.value, jsonlRows: [], issues: [] }
  }

  const jsonl = parseJsonlLines(text)
  if (shouldAutoTreatAsJsonl(jsonl.rows, jsonl.issues, jsonl.nonEmptyLineCount)) {
    return {
      format: 'jsonl',
      sourceText,
      jsonlRows: jsonl.rows,
      issues: [],
    }
  }

  return {
    format: 'unknown',
    sourceText,
    jsonlRows: [],
    issues: [{ message: whole.error }],
  }
}
