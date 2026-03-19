export type DetectedFormat = 'json' | 'jsonl' | 'unknown'

export type ViewMode = 'raw' | 'tree' | 'table' | 'errors'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface ParseIssue {
  line?: number
  message: string
  content?: string
}

export interface JsonlRow {
  line: number
  value: unknown
}

export interface ParsedResult {
  format: DetectedFormat
  sourceText: string
  jsonValue?: unknown
  jsonlRows: JsonlRow[]
  issues: ParseIssue[]
}

export interface TableRow {
  _line?: number
  __raw: unknown
  [key: string]: unknown
}

export interface TableData {
  columns: string[]
  rows: TableRow[]
}

export interface PersistedState {
  sourceText: string
  manualFormat: DetectedFormat | 'auto'
  activeView: ViewMode
  theme: ThemeMode
  skipInvalidJsonl: boolean
  tableExpanded: boolean
  tableSearch: string
  columnFilters: Record<string, string>
}
