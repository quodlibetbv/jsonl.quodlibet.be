export type DetectedFormat = 'json' | 'jsonl' | 'unknown'

export type ViewMode = 'raw' | 'tree' | 'table' | 'errors'
export type ThemeMode = 'system' | 'light' | 'dark'
export type SortDirection = 'asc' | 'desc'
export type ValueSemantic = 'missing' | 'null' | 'empty' | 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unknown'

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

export interface TableSortState {
  column: string
  direction: SortDirection
}

export interface TableQueryChip {
  key: string
  kind: 'search' | 'filter' | 'sort'
  label: string
  source: 'query' | 'state'
  tokenIndex?: number
}

export interface TableQueryResult extends TableData {
  totalRows: number
  visibleRows: number
  chips: TableQueryChip[]
  sort: TableSortState | null
  sortSource: 'query' | 'state' | null
}

export interface PersistedState {
  sourceText: string
  manualFormat: DetectedFormat | 'auto'
  activeView: ViewMode
  theme: ThemeMode
  skipInvalidJsonl: boolean
  tableExpanded: boolean
  tableQuery?: string
  tableSort?: TableSortState | null
  tableSearch?: string
  columnFilters?: Record<string, string>
}

export interface ColumnSignal {
  column: string
  missingCount: number
  nullCount: number
  emptyCount: number
  objectCount: number
  arrayCount: number
  presentCount: number
  dominantKind: ValueSemantic | null
  distinctKinds: ValueSemantic[]
  mixedKinds: ValueSemantic[]
  minorityKinds: ValueSemantic[]
}

export interface RowSignal {
  row: TableRow
  missingColumns: string[]
  nullColumns: string[]
  emptyColumns: string[]
  objectColumns: string[]
  arrayColumns: string[]
  suspectScore: number
}

export interface InvestigationSummary {
  rowSignals: RowSignal[]
  rowSignalMap: Map<TableRow, RowSignal>
  columnSignals: ColumnSignal[]
  columnSignalMap: Map<string, ColumnSignal>
  rowsWithMissing: number
  rowsWithNull: number
  rowsWithEmpty: number
  rowsWithComplex: number
  suspiciousRows: number
  sparseColumns: ColumnSignal[]
  mixedColumns: ColumnSignal[]
}
