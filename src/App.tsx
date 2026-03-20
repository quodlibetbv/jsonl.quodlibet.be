import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import logoUrl from './assets/quodlibet-logo.svg'
import './App.css'
import type {
  ColumnSignal,
  DetectedFormat,
  ParseIssue,
  PersistedState,
  RowSignal,
  TableQueryChip,
  TableRow,
  TableSortState,
  ThemeMode,
  ValueSemantic,
  ViewMode,
} from './types'
import { formatCellValue, getValueSemantic, minifyJson, previewStructuredValue, prettyPrintJson, stringifyJsonl } from './lib/format'
import { filterTableData, removeQueryToken, stripSortTokens, toggleSortState } from './lib/filter'
import { analyzeTable, rowSignalLabel } from './lib/investigation'
import { parseInput } from './lib/parser'
import { tableDataFromJson, tableDataFromJsonl } from './lib/table'
import { clearState, loadState, saveState } from './lib/storage'
import { describeValueShape, getRecommendedView, getRecommendedViewReason } from './lib/view'

type ManualFormat = DetectedFormat | 'auto'
type StatusTone = 'idle' | 'ready' | 'warning' | 'error'

const JSON_SAMPLE = `{
  "user": {
    "id": 42,
    "name": "Ada Lovelace",
    "team": "research"
  },
  "active": true,
  "tags": ["math", "poetry"]
}`

const JSONL_SAMPLE = `{"id":1,"name":"Ada","team":"research","score":98,"latencyMs":120,"status":"ok","error":null,"trace":["ingest","score"]}
{"id":2,"name":"Linus","team":"platform","score":88,"latencyMs":180,"status":"timeout","error":{"code":"E_TIMEOUT","retryable":true}}
{"id":3,"name":"Grace","team":"research","score":91,"latencyMs":95,"status":"ok","trace":[]}
{"id":4,"name":"Margaret","team":"ops","score":84,"latencyMs":210,"status":"error","error":"stale cache","notes":""}`

const BROKEN_JSONL_SAMPLE = `{"id":1,"name":"Ada"}
not json at all
{"id":2,"name":"Linus"}`

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value
}

function legacyQueryFromState(saved: PersistedState): string {
  if (saved.tableQuery?.trim()) return saved.tableQuery.trim()

  const parts: string[] = []
  if (saved.tableSearch?.trim()) {
    parts.push(quoteIfNeeded(saved.tableSearch.trim()))
  }

  Object.entries(saved.columnFilters ?? {}).forEach(([column, raw]) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    parts.push(`${column}:${quoteIfNeeded(trimmed)}`)
  })

  return parts.join(' ')
}

function sortAria(sort: TableSortState | null, column: string): 'ascending' | 'descending' | 'none' {
  if (!sort || sort.column !== column) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function semanticPillLabel(kind: ValueSemantic | 'complex'): string {
  if (kind === 'empty') return 'empty string'
  if (kind === 'complex') return 'nested values'
  return kind
}

function semanticQueryValue(kind: ValueSemantic | 'complex'): string {
  return kind
}

function summarizeColumnSignal(signal: ColumnSignal): string[] {
  const parts: string[] = []
  if (signal.missingCount > 0) parts.push(`${signal.missingCount} missing`)
  if (signal.nullCount > 0) parts.push(`${signal.nullCount} null`)
  if (signal.emptyCount > 0) parts.push(`${signal.emptyCount} empty`)
  if (signal.mixedKinds.length > 0) parts.push(`mixed ${signal.mixedKinds.join('/')}`)
  else if (signal.objectCount > 0 || signal.arrayCount > 0) parts.push('nested')
  return parts.slice(0, 2)
}

function rawValueTitle(value: unknown): string {
  if (value === undefined) return 'missing'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function appendToken(query: string, token: string): string {
  const trimmed = query.trim()
  if (!trimmed) return token
  if (trimmed.split(/\s+/).includes(token)) return trimmed
  return `${trimmed} ${token}`
}

function JsonTree({ value, name = 'root', depth = 0 }: { value: unknown; name?: string; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1)
  const isObject = typeof value === 'object' && value !== null
  const isArray = Array.isArray(value)

  if (!isObject) {
    return (
      <div className="tree-node" style={{ marginLeft: depth * 16 }}>
        <span className="tree-key">{name}:</span>{' '}
        <span className={`token token-${typeof value}`}>{formatCellValue(value)}</span>
      </div>
    )
  }

  const entries = isArray ? value.map((item, index) => [String(index), item] as const) : Object.entries(value as Record<string, unknown>)

  return (
    <div className="tree-group" style={{ marginLeft: depth * 16 }}>
      <button className="ghost inline" onClick={() => setCollapsed((current) => !current)}>
        {collapsed ? '▸' : '▾'} {name}{' '}
        <span className="muted">{isArray ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {!collapsed && (
        <div>
          {entries.map(([key, inner]) => (
            <JsonTree key={key} name={key} value={inner} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ onLoadSample }: { onLoadSample: (sample: 'json' | 'jsonl' | 'broken-jsonl') => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state-copy">
        <p className="empty-kicker">Import to first signal</p>
        <h3>Paste a payload or drop a file to start.</h3>
        <p>
          Quodlibet opens in investigator mode: recover rows fast, surface suspicious fields, and keep raw payload,
          table, tree, and parse failures in sync.
        </p>
      </div>
      <div className="sample-actions">
        <button onClick={() => onLoadSample('json')}>Load JSON sample</button>
        <button onClick={() => onLoadSample('jsonl')}>Load JSONL sample</button>
        <button onClick={() => onLoadSample('broken-jsonl')}>Load broken JSONL sample</button>
      </div>
    </div>
  )
}

function ViewUnavailable({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="view-placeholder">
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="view-placeholder-action">{action}</div>}
    </div>
  )
}

function ActiveChip({ chip, onRemove }: { chip: TableQueryChip; onRemove: (chip: TableQueryChip) => void }) {
  const action = chip.kind === 'sort' ? 'Clear sort' : 'Remove filter'

  return (
    <button
      type="button"
      className={`active-chip chip-${chip.kind}`}
      aria-label={`${action}: ${chip.label}`}
      onClick={() => onRemove(chip)}
    >
      <span>{chip.label}</span>
      <span aria-hidden="true">×</span>
    </button>
  )
}

function ShortcutButton({ label, onClick, tone = 'default' }: { label: string; onClick: () => void; tone?: 'default' | 'warning' }) {
  return (
    <button type="button" className={`shortcut-button tone-${tone}`} onClick={onClick}>
      {label}
    </button>
  )
}

function CellValue({ column, value }: { column: string; value: unknown }) {
  const semantic = getValueSemantic(value)

  if (column === '_line') {
    return <span className="cell-inline value-line">#{String(value)}</span>
  }

  if (semantic === 'missing' || semantic === 'null' || semantic === 'empty') {
    return <span className={`cell-inline semantic-pill kind-${semantic}`}>{formatCellValue(value)}</span>
  }

  if (semantic === 'object') {
    const objectValue = value as Record<string, unknown>
    return (
      <div className="cell-structured" title={rawValueTitle(value)}>
        <span className="semantic-pill kind-object">{`{${Object.keys(objectValue).length}}`}</span>
        <span className="cell-preview">{previewStructuredValue(value)}</span>
      </div>
    )
  }

  if (semantic === 'array') {
    const arrayValue = value as unknown[]
    return (
      <div className="cell-structured" title={rawValueTitle(value)}>
        <span className="semantic-pill kind-array">[{arrayValue.length}]</span>
        <span className="cell-preview">{previewStructuredValue(value)}</span>
      </div>
    )
  }

  return (
    <span className={`cell-inline kind-${semantic}`} title={rawValueTitle(value)}>
      {formatCellValue(value)}
    </span>
  )
}

function ColumnMeta({ signal }: { signal?: ColumnSignal }) {
  if (!signal) return null

  const badges = summarizeColumnSignal(signal)
  if (badges.length === 0) return null

  return (
    <span className="column-meta-badges">
      {badges.map((badge) => (
        <span key={badge} className="column-meta-pill">
          {badge}
        </span>
      ))}
    </span>
  )
}

function SignalList({
  title,
  columns,
  kind,
  onFilter,
}: {
  title: string
  columns: string[]
  kind: ValueSemantic | 'complex'
  onFilter: (query: string) => void
}) {
  if (columns.length === 0) return null

  return (
    <section className="inspector-section">
      <h4>{title}</h4>
      <div className="inspector-chip-list">
        {columns.map((column) => (
          <button key={`${title}-${column}`} type="button" className="inspector-chip" onClick={() => onFilter(`${column}=${semanticQueryValue(kind)}`)}>
            {column}
          </button>
        ))}
      </div>
    </section>
  )
}

function RowInspector({
  row,
  rowSignal,
  onCopy,
  onFilter,
}: {
  row: TableRow | null
  rowSignal: RowSignal | null
  onCopy: (text: string) => void
  onFilter: (query: string) => void
}) {
  if (!row || !rowSignal) {
    return (
      <aside className="row-inspector empty">
        <h3>Row inspection</h3>
        <p className="muted">Click a row to pin its raw payload and suspicious fields here.</p>
      </aside>
    )
  }

  const labels = rowSignalLabel(rowSignal)
  const headline = row._line ? `Line ${row._line}` : 'Selected row'

  return (
    <aside className="row-inspector">
      <div className="row-inspector-header">
        <div>
          <p className="inspector-kicker">Forensic row view</p>
          <h3>{headline}</h3>
        </div>
        <button type="button" onClick={() => onCopy(JSON.stringify(row.__raw, null, 2))}>
          Copy row JSON
        </button>
      </div>

      {labels.length > 0 ? (
        <div className="inspector-summary-tags">
          {labels.map((label) => (
            <span key={label} className="summary-tag">
              {label}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted">No obvious row-level anomalies in the visible columns.</p>
      )}

      <SignalList title="Missing fields" columns={rowSignal.missingColumns} kind="missing" onFilter={onFilter} />
      <SignalList title="Null fields" columns={rowSignal.nullColumns} kind="null" onFilter={onFilter} />
      <SignalList title="Empty strings" columns={rowSignal.emptyColumns} kind="empty" onFilter={onFilter} />
      <SignalList title="Object fields" columns={rowSignal.objectColumns} kind="object" onFilter={onFilter} />
      <SignalList title="Array fields" columns={rowSignal.arrayColumns} kind="array" onFilter={onFilter} />

      <section className="inspector-section">
        <h4>Raw payload</h4>
        <pre>{JSON.stringify(row.__raw, null, 2)}</pre>
      </section>
    </aside>
  )
}

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [sourceText, setSourceText] = useState('')
  const [filename, setFilename] = useState<string | undefined>()
  const [manualFormat, setManualFormat] = useState<ManualFormat>('auto')
  const [activeView, setActiveView] = useState<ViewMode>('raw')
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [skipInvalidJsonl, setSkipInvalidJsonl] = useState(true)
  const [tableExpanded, setTableExpanded] = useState(false)
  const [tableQuery, setTableQuery] = useState('')
  const [tableSort, setTableSort] = useState<TableSortState | null>(null)
  const [restored, setRestored] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [autoView, setAutoView] = useState(true)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null)

  const parsed = useMemo(
    () => parseInput(sourceText, { manualFormat, filename, skipInvalidJsonl }),
    [sourceText, manualFormat, filename, skipInvalidJsonl],
  )

  const tableData = useMemo(() => {
    if (parsed.format === 'json' && parsed.jsonValue !== undefined) return tableDataFromJson(parsed.jsonValue)
    if (parsed.format === 'jsonl') {
      if (!skipInvalidJsonl && parsed.issues.length > 0) return { columns: [], rows: [] }
      return tableDataFromJsonl(parsed.jsonlRows)
    }
    return { columns: [], rows: [] }
  }, [parsed, skipInvalidJsonl])

  const filteredTableData = useMemo(
    () => filterTableData(tableData, tableQuery, tableSort),
    [tableData, tableQuery, tableSort],
  )

  const investigation = useMemo(() => analyzeTable(tableData), [tableData])

  useEffect(() => {
    void loadState().then((saved) => {
      if (saved) {
        setSourceText(saved.sourceText)
        setManualFormat(saved.manualFormat)
        setActiveView(saved.activeView)
        setTheme(saved.theme)
        setSkipInvalidJsonl(saved.skipInvalidJsonl)
        setTableExpanded(saved.tableExpanded ?? false)
        setTableQuery(legacyQueryFromState(saved))
        setTableSort(saved.tableSort ?? null)
        setRestored(Boolean(saved.sourceText))
        setAutoView(false)
        setSourcePanelOpen(!saved.sourceText)
      }
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (!hydrated) return
    void saveState({
      sourceText,
      manualFormat,
      activeView,
      theme,
      skipInvalidJsonl,
      tableExpanded,
      tableQuery,
      tableSort,
    })
  }, [sourceText, manualFormat, activeView, theme, skipInvalidJsonl, tableExpanded, tableQuery, tableSort, hydrated])

  useEffect(() => {
    const effectiveTheme =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme

    document.documentElement.dataset.theme = effectiveTheme
  }, [theme])

  const hasSource = sourceText.trim().length > 0
  const sourceLines = sourceText ? sourceText.split(/\r?\n/).length : 0
  const formatBadge = parsed.format === 'unknown' ? 'Unknown' : parsed.format.toUpperCase()
  const canShowTree = parsed.format === 'json' && parsed.jsonValue !== undefined && typeof parsed.jsonValue === 'object' && parsed.jsonValue !== null
  const canShowTable = tableData.rows.length > 0
  const visibleIssues: ParseIssue[] = parsed.issues
  const recommendedView = getRecommendedView(parsed, tableData.rows.length)
  const recommendedViewReason = getRecommendedViewReason(parsed, tableData.rows.length)
  const detectedShape =
    parsed.format === 'json'
      ? describeValueShape(parsed.jsonValue)
      : parsed.format === 'jsonl'
        ? 'stream'
        : 'unparsed'
  const parseTone: StatusTone = !hasSource
    ? 'idle'
    : parsed.format === 'unknown' || (parsed.format === 'json' && visibleIssues.length > 0) || (parsed.format === 'jsonl' && tableData.rows.length === 0 && visibleIssues.length > 0)
      ? 'error'
      : visibleIssues.length > 0
        ? 'warning'
        : 'ready'
  const statusTitle = !hasSource
    ? 'Waiting for input'
    : parseTone === 'ready'
      ? 'Ready to inspect'
      : parseTone === 'warning'
        ? 'Recovered with warnings'
        : 'Needs attention'
  const statusMessage = !hasSource
    ? 'Paste JSON or JSONL, or drop a file to let the viewer pick the fastest path to something useful.'
    : parseTone === 'ready'
      ? `${formatBadge} detected. ${recommendedViewReason}`
      : parseTone === 'warning'
        ? `${formatBadge} detected with ${formatCount(visibleIssues.length, 'issue')}. ${recommendedViewReason}`
        : visibleIssues[0]?.message ?? 'The payload does not parse cleanly yet.'

  useEffect(() => {
    if (!hasSource) {
      setActiveView('raw')
      return
    }

    const activeViewUnavailable =
      (activeView === 'tree' && !canShowTree) ||
      (activeView === 'table' && !canShowTable) ||
      (activeView === 'errors' && visibleIssues.length === 0 && recommendedView !== 'errors')

    if (autoView || activeViewUnavailable || activeView === 'raw') {
      setActiveView(recommendedView)
    }
  }, [activeView, autoView, canShowTable, canShowTree, hasSource, recommendedView, visibleIssues.length])

  useEffect(() => {
    if (activeView !== 'table' || !canShowTable || filteredTableData.rows.length === 0) {
      setSelectedRow(null)
      return
    }

    if (!selectedRow || !filteredTableData.rows.includes(selectedRow)) {
      setSelectedRow(filteredTableData.rows[0])
    }
  }, [activeView, canShowTable, filteredTableData.rows, selectedRow])

  function updateSource(next: string, nextFilename?: string, options?: { collapseSource?: boolean }) {
    setSourceText(next)
    setFilename(nextFilename)
    setRestored(false)
    setAutoView(true)
    setSelectedRow(null)
    if (options?.collapseSource) {
      setSourcePanelOpen(next.trim().length === 0)
    }
  }

  async function handleFile(file: File) {
    const text = await file.text()
    updateSource(text, file.name, { collapseSource: true })
  }

  function applyTransform(kind: 'pretty' | 'minify') {
    let nextText: string | null = null

    if (parsed.format === 'json' && parsed.jsonValue !== undefined) {
      nextText = kind === 'pretty' ? prettyPrintJson(parsed.jsonValue) : minifyJson(parsed.jsonValue)
    } else if (parsed.format === 'jsonl' && parsed.jsonlRows.length > 0) {
      nextText = stringifyJsonl(parsed.jsonlRows.map((row) => row.value))
    }

    if (nextText === null || nextText.length === 0) {
      return
    }

    updateSource(nextText, filename)
  }

  function handlePrettyPrint() {
    applyTransform('pretty')
  }

  function handleMinify() {
    applyTransform('minify')
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text)
  }

  function handleDownload() {
    const blob = new Blob([sourceText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename ?? (parsed.format === 'jsonl' ? 'data.jsonl' : 'data.json')
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleClear() {
    setSourceText('')
    setFilename(undefined)
    setManualFormat('auto')
    setActiveView('raw')
    setTableExpanded(false)
    setTableQuery('')
    setTableSort(null)
    setRestored(false)
    setAutoView(true)
    setSourcePanelOpen(true)
    setSelectedRow(null)
    await clearState()
  }

  function resetTableControls() {
    setTableQuery('')
    setTableSort(null)
  }

  function handleViewClick(view: ViewMode) {
    setActiveView(view)
    setAutoView(false)
  }

  function loadSample(sample: 'json' | 'jsonl' | 'broken-jsonl') {
    if (sample === 'json') {
      updateSource(JSON_SAMPLE, 'sample.json', { collapseSource: true })
      return
    }

    if (sample === 'jsonl') {
      updateSource(JSONL_SAMPLE, 'sample.jsonl', { collapseSource: true })
      return
    }

    updateSource(BROKEN_JSONL_SAMPLE, 'broken.jsonl', { collapseSource: true })
  }

  function handleRemoveChip(chip: TableQueryChip) {
    if (chip.source === 'state') {
      setTableSort(null)
      return
    }

    if (chip.tokenIndex === undefined) return
    const tokenIndex = chip.tokenIndex
    setTableQuery((current) => removeQueryToken(current, tokenIndex))
  }

  function handleSortClick(column: string) {
    setTableQuery((current) => (filteredTableData.sortSource === 'query' ? stripSortTokens(current) : current))
    setTableSort(toggleSortState(filteredTableData.sort, column))
  }

  function applyInvestigationQuery(nextQuery: string, mode: 'replace' | 'append' = 'replace') {
    setActiveView('table')
    setAutoView(false)
    setTableQuery((current) => (mode === 'append' ? appendToken(current, nextQuery) : nextQuery))
  }

  const activeFilterCount = filteredTableData.chips.filter((chip) => chip.kind !== 'sort').length
  const columnShortcutSignals = investigation.sparseColumns.slice(0, 3)
  const mixedShortcutSignals = investigation.mixedColumns
    .flatMap((signal) => signal.minorityKinds.map((kind) => ({ signal, kind })))
    .slice(0, 3)
  const selectedRowSignal = selectedRow ? investigation.rowSignalMap.get(selectedRow) ?? null : null
  const tableFirst = canShowTable
  const tabs: ViewMode[] = tableFirst ? ['table', 'raw', 'tree', 'errors'] : ['raw', 'tree', 'table', 'errors']

  return (
    <div className={`app-shell${tableExpanded ? ' table-expanded' : ''}${hasSource ? ' has-source' : ' is-empty'}`}>
      <header className="topbar compact-topbar">
        <div className="brand-row compact-brand">
          <img src={logoUrl} alt="Quodlibet logo" className="brand-logo" />
          <div>
            <h1>Quodlibet JSON(L) Viewer</h1>
            <p className="eyebrow">Built for messy payloads</p>
          </div>
        </div>
        <div className="toolbar">
          <span className={`badge badge-${parsed.format}`}>{formatBadge}</span>
          <select aria-label="Theme" value={theme} onChange={(event) => setTheme(event.target.value as ThemeMode)}>
            <option value="system">Theme: System</option>
            <option value="light">Theme: Light</option>
            <option value="dark">Theme: Dark</option>
          </select>
          <button onClick={() => fileInputRef.current?.click()}>Upload</button>
          <button onClick={handlePrettyPrint} disabled={!hasSource}>Pretty</button>
          <button onClick={handleMinify} disabled={!hasSource}>Minify</button>
          <button onClick={handleDownload} disabled={!hasSource}>Download</button>
          <button className="danger" onClick={() => void handleClear()} disabled={!hasSource}>Clear</button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".json,.jsonl,.ndjson,.txt,application/json,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
        </div>
      </header>

      <section className={`status-strip compact-strip tone-${parseTone}${hasSource ? ' loaded' : ''}`}>
        <div className="status-inline-copy">
          <span className="status-inline-title">{statusTitle}</span>
          {!hasSource && <span className="status-inline-message">{statusMessage}</span>}
          {hasSource && <span className="status-inline-message">{statusMessage}</span>}
        </div>
        <div className="status-pills dense-pills">
          <span className="status-pill">Mode: {manualFormat === 'auto' ? 'Auto' : manualFormat.toUpperCase()}</span>
          <span className="status-pill">View: {recommendedView}</span>
          <span className="status-pill">Shape: {detectedShape}</span>
          <span className="status-pill">Lines: {sourceLines}</span>
          {canShowTable && <span className="status-pill">Rows: {tableData.rows.length}</span>}
          {canShowTable && <span className="status-pill">Columns: {Math.max(tableData.columns.length - (tableData.columns.includes('_line') ? 1 : 0), 0)}</span>}
          <span className="status-pill">Issues: {visibleIssues.length}</span>
          {filename && <span className="status-pill">File: {filename}</span>}
          {restored && !filename && <span className="status-pill">Restored session</span>}
        </div>
      </section>

      <section className={`panel source-drawer ${sourcePanelOpen ? 'open' : 'closed'}`}>
        <div className="source-drawer-header">
          <div>
            <h2>Source</h2>
            {(!hasSource || sourcePanelOpen) && (
              <p className="panel-copy source-drawer-copy">
                {!hasSource
                  ? 'Paste, drop, or sample a payload. The drawer starts open while the viewer is empty.'
                  : 'Editing stays one click away. Investigation stays in front.'}
              </p>
            )}
          </div>
          <div className="source-drawer-actions">
            <label className="inline-select">
              <span>Mode</span>
              <select
                aria-label="Mode"
                value={manualFormat}
                onChange={(event) => {
                  setManualFormat(event.target.value as ManualFormat)
                  setAutoView(true)
                }}
              >
                <option value="auto">Auto</option>
                <option value="json">JSON</option>
                <option value="jsonl">JSONL</option>
              </select>
            </label>
            <button
              className="drawer-toggle"
              type="button"
              aria-expanded={sourcePanelOpen}
              onClick={() => setSourcePanelOpen((current) => !current)}
            >
              {sourcePanelOpen ? 'Hide source' : 'Show source'}
            </button>
          </div>
        </div>

        {sourcePanelOpen && (
          <div className="source-drawer-body">
            <div className="source-utility-row">
              <div className="sample-actions compact">
                <button onClick={() => loadSample('json')}>Sample JSON</button>
                <button onClick={() => loadSample('jsonl')}>Sample JSONL</button>
                <button onClick={() => loadSample('broken-jsonl')}>Sample broken JSONL</button>
              </div>
              <label className="checkbox-row compact-checkbox">
                <input
                  type="checkbox"
                  checked={skipInvalidJsonl}
                  onChange={(event) => {
                    setSkipInvalidJsonl(event.target.checked)
                    setAutoView(true)
                  }}
                />
                Ignore invalid JSONL lines in table view
              </label>
            </div>

            <div
              className="dropzone compact-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files?.[0]
                if (file) void handleFile(file)
              }}
            >
              <p className="dropzone-title">Drop a file here or use Upload.</p>
              <p className="muted">Accepts .json, .jsonl, .ndjson, and plain text files.</p>
              {filename && <p className="muted">Current file: {filename}</p>}
              {restored && !filename && <p className="muted">Restored previous session from browser storage.</p>}
            </div>

            <div className="source-text-wrap">
              {!sourceText && (
                <div className="editor-empty-overlay" aria-hidden="true">
                  <p>Paste JSON or JSONL here</p>
                  <pre>{'{"name":"Ada"}\n{"name":"Linus"}'}</pre>
                </div>
              )}
              <textarea
                aria-label="JSON input"
                className="source-text"
                spellCheck={false}
                value={sourceText}
                onChange={(event) => updateSource(event.target.value, filename)}
                placeholder=""
              />
            </div>

            <div className="input-meta compact-meta">
              <span>Lines: {sourceLines}</span>
              <span>Recovered rows: {parsed.jsonlRows.length || tableData.rows.length}</span>
              {canShowTable && <span>Visible rows: {filteredTableData.visibleRows}</span>}
              {canShowTable && <span>Suspicious rows: {investigation.suspiciousRows}</span>}
              <span>Issues: {visibleIssues.length}</span>
            </div>
          </div>
        )}
      </section>

      <section className="panel output-panel">
        <div className="panel-header output-header compact-output-header">
          <div className="output-header-copy">
            {hasSource ? (
              <>
                <span className="output-kicker">{canShowTable ? 'Investigation desk' : `Recommended: ${recommendedView}`}</span>
                <p className="panel-copy">{canShowTable ? 'Table first. Other modes are supporting evidence.' : recommendedViewReason}</p>
              </>
            ) : (
              <>
                <h2>Ready when you are</h2>
                <p className="panel-copy">No payload loaded yet.</p>
              </>
            )}
          </div>
          <div className="tabs tabs-secondary" role="tablist" aria-label="Output views">
            {tabs.map((view) => {
              const label = view === 'table' ? 'Table' : view === 'raw' ? 'Raw' : view === 'tree' ? 'Tree' : 'Errors'
              const disabled = (view === 'tree' && !canShowTree) || (view === 'table' && !canShowTable)
              return (
                <button key={view} className={activeView === view ? 'active' : ''} onClick={() => handleViewClick(view)} disabled={disabled}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {!hasSource ? (
          <div className="output-block empty-output">
            <EmptyState onLoadSample={loadSample} />
          </div>
        ) : activeView === 'raw' ? (
          <div className="output-block">
            <div className="action-row compact-action-row">
              <button onClick={() => void handleCopy(sourceText)} disabled={!hasSource}>Copy source</button>
            </div>
            <pre>{sourceText}</pre>
          </div>
        ) : activeView === 'tree' ? (
          canShowTree ? (
            <div className="output-block tree-block">
              <div className="action-row compact-action-row">
                <button onClick={() => void handleCopy(prettyPrintJson(parsed.jsonValue))}>Copy formatted JSON</button>
              </div>
              <JsonTree value={parsed.jsonValue} />
            </div>
          ) : (
            <div className="output-block">
              <ViewUnavailable
                title="Tree view is not available for this payload"
                description={parsed.format === 'jsonl' ? 'JSONL is a stream of records, so the table is usually the better first view.' : 'Only parsed JSON objects and arrays can be shown as a tree.'}
                action={canShowTable ? <button onClick={() => handleViewClick('table')}>Go to table</button> : <button onClick={() => handleViewClick('errors')}>Inspect errors</button>}
              />
            </div>
          )
        ) : activeView === 'table' ? (
          canShowTable ? (
            <div className="output-block table-block">
              <section className="investigation-strip" aria-label="Payload investigation summary">
                <div className="investigation-metrics">
                  <div className="metric-card emphasis">
                    <span className="metric-label">Rows in play</span>
                    <strong>{filteredTableData.visibleRows}</strong>
                    <span className="metric-subtle">of {filteredTableData.totalRows}</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">Suspicious rows</span>
                    <strong>{investigation.suspiciousRows}</strong>
                    <span className="metric-subtle">missing, null, empty, or nested</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">Sparse columns</span>
                    <strong>{investigation.sparseColumns.length}</strong>
                    <span className="metric-subtle">fields missing in some rows</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">Mixed columns</span>
                    <strong>{investigation.mixedColumns.length}</strong>
                    <span className="metric-subtle">same field, different shapes</span>
                  </div>
                </div>
                <div className="shortcut-strip">
                  {visibleIssues.length > 0 && (
                    <ShortcutButton label={`Open ${visibleIssues.length} parse issue${visibleIssues.length === 1 ? '' : 's'}`} tone="warning" onClick={() => handleViewClick('errors')} />
                  )}
                  {investigation.rowsWithMissing > 0 && (
                    <ShortcutButton label={`Rows with missing fields (${investigation.rowsWithMissing})`} onClick={() => applyInvestigationQuery('has:missing')} />
                  )}
                  {investigation.rowsWithNull > 0 && (
                    <ShortcutButton label={`Rows with nulls (${investigation.rowsWithNull})`} onClick={() => applyInvestigationQuery('has:null')} />
                  )}
                  {investigation.rowsWithEmpty > 0 && (
                    <ShortcutButton label={`Rows with empty strings (${investigation.rowsWithEmpty})`} onClick={() => applyInvestigationQuery('has:empty')} />
                  )}
                  {investigation.rowsWithComplex > 0 && (
                    <ShortcutButton label={`Rows with nested values (${investigation.rowsWithComplex})`} onClick={() => applyInvestigationQuery('has:complex')} />
                  )}
                  {columnShortcutSignals.map((signal) => (
                    <ShortcutButton key={`missing-${signal.column}`} label={`Check ${signal.column} gaps (${signal.missingCount})`} onClick={() => applyInvestigationQuery(`${signal.column}=missing`)} />
                  ))}
                  {mixedShortcutSignals.map(({ signal, kind }) => (
                    <ShortcutButton
                      key={`mixed-${signal.column}-${kind}`}
                      label={`Check ${signal.column} ${semanticPillLabel(kind)} rows`}
                      onClick={() => applyInvestigationQuery(`${signal.column}=${kind}`)}
                    />
                  ))}
                </div>
              </section>

              <div className="action-row table-toolbar compact-action-row">
                <div className="table-query-stack">
                  <div className="table-query-row">
                    <input
                      aria-label="Filter rows"
                      className="table-search"
                      type="text"
                      placeholder="Try has:missing, error=object, notes=empty, score>=90, sort:-_line"
                      value={tableQuery}
                      onChange={(event) => setTableQuery(event.target.value)}
                    />
                    <span className="table-count-pill">{filteredTableData.visibleRows} / {filteredTableData.totalRows} rows</span>
                    {activeFilterCount > 0 && <span className="table-mini-pill">{activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}</span>}
                    <button onClick={() => setTableExpanded((current) => !current)}>
                      {tableExpanded ? 'Collapse table' : 'Expand table'}
                    </button>
                    <button onClick={resetTableControls} disabled={!tableQuery && !tableSort}>Reset table</button>
                    <button onClick={() => void handleCopy(JSON.stringify(filteredTableData.rows.map((row) => row.__raw), null, 2))}>Copy rows</button>
                  </div>
                  <div className="table-query-meta">
                    <p className="muted table-filter-hint">
                      Free text searches every visible column. Structured filters: <code>field:value</code>, <code>field=value</code>, <code>field!=value</code>, <code>field&gt;=10</code>, <code>sort:-field</code>, plus messy-payload helpers like <code>has:missing</code>, <code>field=object</code>, <code>field=array</code>, <code>field=empty</code>.
                    </p>
                    {filteredTableData.chips.length > 0 && (
                      <div className="active-chip-row" aria-label="Active table filters">
                        {filteredTableData.chips.map((chip) => (
                          <ActiveChip key={chip.key} chip={chip} onRemove={handleRemoveChip} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="table-body-layout">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {filteredTableData.columns.map((column) => {
                          const isSorted = filteredTableData.sort?.column === column
                          const direction = filteredTableData.sort?.direction
                          const signal = investigation.columnSignalMap.get(column)

                          return (
                            <th key={column} aria-sort={sortAria(filteredTableData.sort, column)}>
                              <button
                                type="button"
                                className={`column-sort${isSorted ? ' active' : ''}`}
                                onClick={() => handleSortClick(column)}
                                aria-label={`Sort by ${column}${isSorted ? ` (${direction})` : ''}`}
                              >
                                <span className="column-sort-copy">
                                  <span>{column}</span>
                                  <ColumnMeta signal={signal} />
                                </span>
                                <span className="sort-indicator" aria-hidden="true">
                                  {isSorted ? (direction === 'asc' ? '↑' : '↓') : '↕'}
                                </span>
                              </button>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTableData.rows.length > 0 ? (
                        filteredTableData.rows.map((row, index) => {
                          const rowSignal = investigation.rowSignalMap.get(row)
                          const suspect = Boolean(rowSignal && rowSignal.suspectScore > 0)
                          const selected = selectedRow === row

                          return (
                            <tr
                              key={`${row._line ?? 'row'}-${index}`}
                              className={`${suspect ? 'row-suspect' : ''}${selected ? ' row-selected' : ''}`}
                              onClick={() => setSelectedRow(row)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  setSelectedRow(row)
                                }
                              }}
                              tabIndex={0}
                              aria-selected={selected}
                            >
                              {filteredTableData.columns.map((column) => (
                                <td key={column} data-kind={getValueSemantic(row[column])}>
                                  <CellValue column={column} value={row[column]} />
                                </td>
                              ))}
                            </tr>
                          )
                        })
                      ) : (
                        <tr>
                          <td colSpan={filteredTableData.columns.length || 1}>
                            <div className="table-empty-state">
                              <strong>No rows match the current filters.</strong>
                              <span className="muted">Loosen the query or reset the table controls.</span>
                              <button type="button" onClick={resetTableControls}>Reset table</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <RowInspector
                  row={selectedRow}
                  rowSignal={selectedRowSignal}
                  onCopy={(text) => void handleCopy(text)}
                  onFilter={(query) => applyInvestigationQuery(query, 'append')}
                />
              </div>
            </div>
          ) : (
            <div className="output-block">
              <ViewUnavailable
                title="Table view is not available yet"
                description={visibleIssues.length > 0 ? 'No valid rows were recovered from this payload. Check the error list first.' : 'This payload does not flatten into rows yet.'}
                action={<button onClick={() => handleViewClick(visibleIssues.length > 0 ? 'errors' : 'raw')}>{visibleIssues.length > 0 ? 'Inspect errors' : 'Back to raw'}</button>}
              />
            </div>
          )
        ) : (
          <div className="output-block">
            {visibleIssues.length === 0 ? (
              <ViewUnavailable
                title="No parse issues"
                description="The payload parsed cleanly. Use the table, raw view, or tree to inspect the content."
                action={<button onClick={() => handleViewClick(recommendedView === 'errors' ? 'raw' : recommendedView)}>Go to {recommendedView === 'errors' ? 'raw' : recommendedView}</button>}
              />
            ) : (
              <ul className="issues">
                {visibleIssues.map((issue, index) => (
                  <li key={`${issue.line ?? 'x'}-${index}`}>
                    <strong>{issue.line ? `Line ${issue.line}` : 'Error'}:</strong> {issue.message}
                    {issue.content && <pre>{issue.content}</pre>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <footer className="footer-link">
        <a href="https://quodlibet.be" target="_blank" rel="noreferrer">quodlibet.be</a>
      </footer>
    </div>
  )
}

export default App
