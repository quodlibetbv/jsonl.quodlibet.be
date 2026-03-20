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
type DrawerPanel = 'help' | 'source' | 'raw' | 'tree' | 'errors' | null

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
      <button className="ghost-inline" onClick={() => setCollapsed((current) => !current)}>
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
        <p className="empty-kicker">Start with a payload</p>
        <h3>Paste JSON or JSONL to inspect it.</h3>
        <p>Load a sample, paste into the source drawer, or drop a file there. The loaded state stays table-first.</p>
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
          <button key={`${title}-${column}`} type="button" className="inspector-chip" onClick={() => onFilter(`${column}=${kind}`)}>
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
  onClose,
  onCopy,
  onFilter,
}: {
  row: TableRow
  rowSignal: RowSignal | null
  onClose: () => void
  onCopy: (text: string) => void
  onFilter: (query: string) => void
}) {
  const labels = rowSignal ? rowSignalLabel(rowSignal) : []
  const headline = row._line ? `Line ${row._line}` : 'Selected row'

  return (
    <aside className="row-inspector" aria-label="Row detail">
      <div className="row-inspector-header">
        <div>
          <p className="inspector-kicker">On-demand detail</p>
          <h3>{headline}</h3>
        </div>
        <div className="drawer-actions">
          <button type="button" onClick={() => onCopy(JSON.stringify(row.__raw, null, 2))}>
            Copy row JSON
          </button>
          <button type="button" className="quiet-button" onClick={onClose}>
            Close
          </button>
        </div>
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

      {rowSignal && (
        <>
          <SignalList title="Missing fields" columns={rowSignal.missingColumns} kind="missing" onFilter={onFilter} />
          <SignalList title="Null fields" columns={rowSignal.nullColumns} kind="null" onFilter={onFilter} />
          <SignalList title="Empty strings" columns={rowSignal.emptyColumns} kind="empty" onFilter={onFilter} />
          <SignalList title="Object fields" columns={rowSignal.objectColumns} kind="object" onFilter={onFilter} />
          <SignalList title="Array fields" columns={rowSignal.arrayColumns} kind="array" onFilter={onFilter} />
        </>
      )}

      <section className="inspector-section">
        <h4>Raw payload</h4>
        <pre>{JSON.stringify(row.__raw, null, 2)}</pre>
      </section>
    </aside>
  )
}

function CommandHelp() {
  return (
    <div className="help-grid" aria-label="Command bar help">
      <section className="help-card">
        <h3>Filters</h3>
        <p>Free text searches every visible column. Structured filters stay live as you type.</p>
        <pre>{`ada
status:error
score>=90
has:missing
payload=object
sort:-_line`}</pre>
      </section>
      <section className="help-card">
        <h3>Commands</h3>
        <p>Type a slash command in the same bar, then press Enter.</p>
        <pre>{`/source
/raw
/tree
/errors
/reset
/pretty
/minify
/download
/theme dark`}</pre>
      </section>
      <section className="help-card">
        <h3>Hidden extras</h3>
        <p>Use commands to keep the surface quiet while preserving the old power.</p>
        <pre>{`/mode jsonl
/skip invalid off
/sample jsonl
/expand
/copy rows
/clear`}</pre>
      </section>
    </div>
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
  const [commandBarValue, setCommandBarValue] = useState('')
  const [restored, setRestored] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [autoView, setAutoView] = useState(true)
  const [drawerPanel, setDrawerPanel] = useState<DrawerPanel>('source')
  const [selectedRow, setSelectedRow] = useState<TableRow | null>(null)
  const [statusFlash, setStatusFlash] = useState<string | null>(null)

  const [tableSort, setTableSort] = useState<TableSortState | null>(null)

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
        const savedQuery = legacyQueryFromState(saved)
        setSourceText(saved.sourceText)
        setFilename(undefined)
        setManualFormat(saved.manualFormat)
        setActiveView(saved.activeView)
        setTheme(saved.theme)
        setSkipInvalidJsonl(saved.skipInvalidJsonl)
        setTableExpanded(saved.tableExpanded ?? false)
        setTableQuery(savedQuery)
        setCommandBarValue(savedQuery)
        setTableSort(saved.tableSort ?? null)
        setRestored(Boolean(saved.sourceText))
        setAutoView(false)
        setDrawerPanel(saved.sourceText ? null : 'source')
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

  useEffect(() => {
    if (!statusFlash) return
    const timeout = window.setTimeout(() => setStatusFlash(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [statusFlash])

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

  useEffect(() => {
    if (!hasSource) {
      setActiveView('raw')
      setSelectedRow(null)
      return
    }

    const activeViewUnavailable =
      (activeView === 'tree' && !canShowTree) ||
      (activeView === 'table' && !canShowTable) ||
      (activeView === 'errors' && visibleIssues.length === 0 && recommendedView !== 'errors')

    if (autoView || activeViewUnavailable) {
      setActiveView(recommendedView)
    }
  }, [activeView, autoView, canShowTable, canShowTree, hasSource, recommendedView, visibleIssues.length])

  useEffect(() => {
    if (!canShowTable || filteredTableData.rows.length === 0) {
      setSelectedRow(null)
      return
    }

    if (selectedRow && !filteredTableData.rows.includes(selectedRow)) {
      setSelectedRow(null)
    }
  }, [canShowTable, filteredTableData.rows, selectedRow])

  function syncQuery(next: string) {
    setTableQuery(next)
    setCommandBarValue(next)
  }

  function updateSource(next: string, nextFilename?: string, options?: { closeSource?: boolean }) {
    setSourceText(next)
    setFilename(nextFilename)
    setRestored(false)
    setAutoView(true)
    setSelectedRow(null)
    setStatusFlash(null)
    if (options?.closeSource && next.trim().length > 0) {
      setDrawerPanel(null)
    }
    if (next.trim().length === 0) {
      setDrawerPanel('source')
    }
  }

  async function handleFile(file: File) {
    const text = await file.text()
    updateSource(text, file.name, { closeSource: true })
  }

  function applyTransform(kind: 'pretty' | 'minify') {
    let nextText: string | null = null

    if (parsed.format === 'json' && parsed.jsonValue !== undefined) {
      nextText = kind === 'pretty' ? prettyPrintJson(parsed.jsonValue) : minifyJson(parsed.jsonValue)
    } else if (parsed.format === 'jsonl' && parsed.jsonlRows.length > 0) {
      nextText = stringifyJsonl(parsed.jsonlRows.map((row) => row.value))
    }

    if (nextText === null || nextText.length === 0) {
      setStatusFlash(`Nothing to ${kind}.`)
      return false
    }

    updateSource(nextText, filename)
    setStatusFlash(kind === 'pretty' ? 'Formatted source.' : 'Minified source.')
    return true
  }

  async function handleCopy(text: string, label = 'Copied to clipboard.') {
    await navigator.clipboard.writeText(text)
    setStatusFlash(label)
  }

  function handleDownload() {
    const blob = new Blob([sourceText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename ?? (parsed.format === 'jsonl' ? 'data.jsonl' : 'data.json')
    link.click()
    URL.revokeObjectURL(url)
    setStatusFlash('Downloaded current source.')
  }

  async function handleClear() {
    setSourceText('')
    setFilename(undefined)
    setManualFormat('auto')
    setActiveView('raw')
    setTableExpanded(false)
    setTableQuery('')
    setCommandBarValue('')
    setTableSort(null)
    setRestored(false)
    setAutoView(true)
    setDrawerPanel('source')
    setSelectedRow(null)
    setStatusFlash('Cleared payload and local state.')
    await clearState()
  }

  function resetTableControls() {
    setTableSort(null)
    syncQuery('')
    setStatusFlash('Cleared filters and sort.')
  }

  function loadSample(sample: 'json' | 'jsonl' | 'broken-jsonl') {
    if (sample === 'json') {
      updateSource(JSON_SAMPLE, 'sample.json', { closeSource: true })
      setStatusFlash('Loaded JSON sample.')
      return
    }

    if (sample === 'jsonl') {
      updateSource(JSONL_SAMPLE, 'sample.jsonl', { closeSource: true })
      setStatusFlash('Loaded JSONL sample.')
      return
    }

    updateSource(BROKEN_JSONL_SAMPLE, 'broken.jsonl', { closeSource: true })
    setStatusFlash('Loaded broken JSONL sample.')
  }

  function handleRemoveChip(chip: TableQueryChip) {
    if (chip.source === 'state') {
      setTableSort(null)
      setStatusFlash('Cleared sort.')
      return
    }

    if (chip.tokenIndex === undefined) return
    const next = removeQueryToken(tableQuery, chip.tokenIndex)
    syncQuery(next)
  }

  function handleSortClick(column: string) {
    setCommandBarValue((current) => (current.trimStart().startsWith('/') ? current : stripSortTokens(current)))
    setTableQuery((current) => (filteredTableData.sortSource === 'query' ? stripSortTokens(current) : current))
    setTableSort(toggleSortState(filteredTableData.sort, column))
    setStatusFlash(`Sorted by ${column}${filteredTableData.sort?.column === column && filteredTableData.sort?.direction === 'asc' ? ' descending' : ' ascending'}.`)
  }

  function applyInvestigationQuery(nextQuery: string, mode: 'replace' | 'append' = 'replace') {
    setActiveView('table')
    setAutoView(false)
    setDrawerPanel(null)

    const next = mode === 'append' ? appendToken(tableQuery, nextQuery) : nextQuery
    syncQuery(next)
  }

  function handleCommandInput(next: string) {
    setCommandBarValue(next)
    if (!next.trimStart().startsWith('/')) {
      setTableQuery(next)
    }
  }

  function showSecondaryView(view: 'raw' | 'tree' | 'errors') {
    if (view === 'tree' && !canShowTree) {
      setStatusFlash('Tree view is not available for this payload.')
      return
    }

    if (view === 'errors' && visibleIssues.length === 0) {
      setStatusFlash('No parse issues to show.')
      return
    }

    if (canShowTable) {
      setDrawerPanel(view)
      return
    }

    setActiveView(view)
    setAutoView(false)
  }

  async function runCommand() {
    const raw = commandBarValue.trim()
    if (!raw.startsWith('/')) return

    const [command, ...rest] = raw.slice(1).trim().split(/\s+/)
    const lowerCommand = command?.toLowerCase() ?? ''
    const firstArg = rest[0]?.toLowerCase()
    const secondArg = rest[1]?.toLowerCase()
    let nextBarValue = tableQuery

    switch (lowerCommand) {
      case 'help':
        setDrawerPanel('help')
        setStatusFlash('Opened command help.')
        break
      case 'source': {
        const nextPanel = drawerPanel === 'source' ? null : 'source'
        setDrawerPanel(nextPanel)
        setStatusFlash(nextPanel === 'source' ? 'Opened source drawer.' : 'Closed source drawer.')
        break
      }
      case 'raw':
        showSecondaryView('raw')
        break
      case 'tree':
        showSecondaryView('tree')
        break
      case 'errors':
        showSecondaryView('errors')
        break
      case 'table':
        setDrawerPanel(null)
        setActiveView('table')
        setAutoView(false)
        setStatusFlash('Back to the table.')
        break
      case 'pretty':
        applyTransform('pretty')
        break
      case 'minify':
        applyTransform('minify')
        break
      case 'download':
        handleDownload()
        break
      case 'clear':
        await handleClear()
        nextBarValue = ''
        break
      case 'reset':
        resetTableControls()
        nextBarValue = ''
        break
      case 'expand':
        setTableExpanded(true)
        setStatusFlash('Expanded table width.')
        break
      case 'collapse':
        setTableExpanded(false)
        setStatusFlash('Returned to normal width.')
        break
      case 'copy':
        if (firstArg === 'rows') {
          await handleCopy(JSON.stringify(filteredTableData.rows.map((row) => row.__raw), null, 2), 'Copied filtered rows.')
        } else if (firstArg === 'source') {
          await handleCopy(sourceText, 'Copied source.')
        } else if (firstArg === 'row' && selectedRow) {
          await handleCopy(JSON.stringify(selectedRow.__raw, null, 2), 'Copied selected row.')
        } else {
          setStatusFlash('Try /copy rows, /copy source, or /copy row.')
        }
        break
      case 'theme':
        if (firstArg === 'light' || firstArg === 'dark' || firstArg === 'system') {
          setTheme(firstArg)
          setStatusFlash(`Theme set to ${firstArg}.`)
        } else {
          setStatusFlash('Try /theme system, /theme light, or /theme dark.')
        }
        break
      case 'mode':
        if (firstArg === 'auto' || firstArg === 'json' || firstArg === 'jsonl') {
          setManualFormat(firstArg)
          setAutoView(true)
          setStatusFlash(`Mode set to ${firstArg}.`)
        } else {
          setStatusFlash('Try /mode auto, /mode json, or /mode jsonl.')
        }
        break
      case 'skip': {
        const decision = firstArg === 'invalid' ? secondArg : firstArg
        if (decision === 'on' || decision === 'off') {
          setSkipInvalidJsonl(decision === 'on')
          setAutoView(true)
          setStatusFlash(`Ignore invalid JSONL lines ${decision === 'on' ? 'enabled' : 'disabled'}.`)
        } else {
          setStatusFlash('Try /skip invalid on or /skip invalid off.')
        }
        break
      }
      case 'sample':
        if (firstArg === 'json') loadSample('json')
        else if (firstArg === 'jsonl') loadSample('jsonl')
        else if (firstArg === 'broken' || firstArg === 'broken-jsonl') loadSample('broken-jsonl')
        else setStatusFlash('Try /sample json, /sample jsonl, or /sample broken-jsonl.')
        nextBarValue = tableQuery
        break
      case 'close':
        setDrawerPanel(null)
        setSelectedRow(null)
        setStatusFlash('Closed open drawers.')
        break
      default:
        setStatusFlash('Unknown command. Try /help.')
        break
    }

    setCommandBarValue(nextBarValue)
  }

  const selectedRowSignal = selectedRow ? investigation.rowSignalMap.get(selectedRow) ?? null : null
  const activeCommand = commandBarValue.trimStart().startsWith('/')
  const showSourceDrawer = !hasSource || drawerPanel === 'source'
  const showAuxDrawer = drawerPanel === 'help' || (canShowTable && drawerPanel !== null && drawerPanel !== 'source')
  const mainView: ViewMode = canShowTable ? 'table' : activeView
  const visibleDataColumns = Math.max(tableData.columns.length - (tableData.columns.includes('_line') ? 1 : 0), 0)

  const statusSummary = !hasSource
    ? 'No payload loaded.'
    : canShowTable
      ? `${filteredTableData.visibleRows}/${filteredTableData.totalRows} rows · ${visibleDataColumns} cols · ${visibleIssues.length} issue${visibleIssues.length === 1 ? '' : 's'} · ${formatBadge}`
      : `${formatBadge} · ${recommendedViewReason}`

  const statusSecondary = activeCommand
    ? `Press Enter to run ${commandBarValue.trim()}`
    : statusFlash ?? (!hasSource ? 'Use /sample jsonl or open the source drawer.' : 'Type /help to surface hidden tools.')

  return (
    <div className={`app-shell${tableExpanded ? ' table-expanded' : ''}${hasSource ? ' has-source' : ' is-empty'}`}>
      <header className="topbar">
        <div className="brand-row">
          <img src={logoUrl} alt="Quodlibet logo" className="brand-logo" />
          <div>
            <h1>Quodlibet JSON(L) Viewer</h1>
            <p className="eyebrow">Built for messy payloads</p>
          </div>
        </div>
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
      </header>

      <section className="panel command-shell">
        <input
          aria-label="Smart command bar"
          className="smart-command"
          type="text"
          value={commandBarValue}
          placeholder={
            hasSource
              ? 'Filter rows or run /help, /source, /raw, /tree, /errors, /theme dark'
              : 'Type /sample jsonl, /help, or open the source drawer below'
          }
          onChange={(event) => handleCommandInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && commandBarValue.trimStart().startsWith('/')) {
              event.preventDefault()
              void runCommand()
            }

            if (event.key === 'Escape') {
              if (commandBarValue.trimStart().startsWith('/')) {
                setCommandBarValue(tableQuery)
              } else if (drawerPanel !== null || selectedRow) {
                setDrawerPanel(null)
                setSelectedRow(null)
                setStatusFlash('Closed open drawers.')
              }
            }
          }}
        />
        {!activeCommand && filteredTableData.chips.length > 0 && (
          <div className="active-chip-row" aria-label="Active table filters">
            {filteredTableData.chips.map((chip) => (
              <ActiveChip key={chip.key} chip={chip} onRemove={handleRemoveChip} />
            ))}
          </div>
        )}
      </section>

      <section className={`status-line tone-${parseTone}`} aria-live="polite">
        <span className="status-summary">{statusSummary}</span>
        <span className="status-secondary">{statusSecondary}</span>
      </section>

      {showSourceDrawer && (
        <section className="panel drawer" aria-label="Source drawer">
          <div className="drawer-header">
            <div>
              <h2>Source</h2>
              <p className="panel-copy">
                Paste, edit, drop, or upload payloads here. Once loaded, the table stays in front and the source stays one command away.
              </p>
            </div>
            <div className="drawer-actions">
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
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                Upload
              </button>
              {hasSource && (
                <button type="button" className="quiet-button" onClick={() => setDrawerPanel(null)}>
                  Hide source
                </button>
              )}
            </div>
          </div>

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
              className="dropzone"
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

            <div className="input-meta">
              <span>Lines: {sourceLines}</span>
              <span>Shape: {detectedShape}</span>
              {canShowTable && <span>Rows: {tableData.rows.length}</span>}
              <span>Issues: {visibleIssues.length}</span>
            </div>
          </div>
        </section>
      )}

      {showAuxDrawer && drawerPanel === 'help' && (
        <section className="panel drawer">
          <div className="drawer-header">
            <div>
              <h2>Help</h2>
              <p className="panel-copy">The power is still here. It just no longer shouts over the table.</p>
            </div>
            <div className="drawer-actions">
              <button type="button" className="quiet-button" onClick={() => setDrawerPanel(null)}>
                Close
              </button>
            </div>
          </div>
          <CommandHelp />
        </section>
      )}

      {showAuxDrawer && drawerPanel === 'raw' && (
        <section className="panel drawer">
          <div className="drawer-header">
            <div>
              <h2>Raw source</h2>
              <p className="panel-copy">Secondary evidence, surfaced only when asked.</p>
            </div>
            <div className="drawer-actions">
              <button type="button" onClick={() => void handleCopy(sourceText, 'Copied source.')} disabled={!hasSource}>
                Copy source
              </button>
              <button type="button" className="quiet-button" onClick={() => setDrawerPanel(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="output-block drawer-block">
            <pre>{sourceText}</pre>
          </div>
        </section>
      )}

      {showAuxDrawer && drawerPanel === 'tree' && (
        <section className="panel drawer">
          <div className="drawer-header">
            <div>
              <h2>Tree</h2>
              <p className="panel-copy">Structured drill-down when the table flattening is not enough.</p>
            </div>
            <div className="drawer-actions">
              <button type="button" onClick={() => void handleCopy(prettyPrintJson(parsed.jsonValue), 'Copied formatted JSON.')} disabled={!canShowTree}>
                Copy formatted JSON
              </button>
              <button type="button" className="quiet-button" onClick={() => setDrawerPanel(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="output-block drawer-block">
            {canShowTree ? (
              <JsonTree value={parsed.jsonValue} />
            ) : (
              <ViewUnavailable
                title="Tree view is not available for this payload"
                description={parsed.format === 'jsonl' ? 'JSONL is a stream of records, so the table is usually the better first view.' : 'Only parsed JSON objects and arrays can be shown as a tree.'}
              />
            )}
          </div>
        </section>
      )}

      {showAuxDrawer && drawerPanel === 'errors' && (
        <section className="panel drawer">
          <div className="drawer-header">
            <div>
              <h2>Parse issues</h2>
              <p className="panel-copy">Only visible on demand now.</p>
            </div>
            <div className="drawer-actions">
              <button type="button" className="quiet-button" onClick={() => setDrawerPanel(null)}>
                Close
              </button>
            </div>
          </div>
          <div className="output-block drawer-block">
            {visibleIssues.length === 0 ? (
              <ViewUnavailable title="No parse issues" description="The payload parsed cleanly." />
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
        </section>
      )}

      <section className="panel output-panel">
        {!hasSource ? (
          <div className="output-block empty-output">
            <EmptyState onLoadSample={loadSample} />
          </div>
        ) : mainView === 'raw' ? (
          <div className="output-block">
            <pre>{sourceText}</pre>
          </div>
        ) : mainView === 'tree' ? (
          canShowTree ? (
            <div className="output-block tree-block">
              <JsonTree value={parsed.jsonValue} />
            </div>
          ) : (
            <div className="output-block">
              <ViewUnavailable
                title="Tree view is not available for this payload"
                description={parsed.format === 'jsonl' ? 'JSONL is a stream of records, so the table is usually the better first view.' : 'Only parsed JSON objects and arrays can be shown as a tree.'}
                action={canShowTable ? <button onClick={() => setDrawerPanel(null)}>Back to table</button> : undefined}
              />
            </div>
          )
        ) : mainView === 'table' ? (
          canShowTable ? (
            <div className="output-block table-block">
              <div className={`table-shell${selectedRow ? ' detail-open' : ''}`}>
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
                              <span className="muted">Loosen the query, clear chips, or use /reset.</span>
                              <button type="button" onClick={resetTableControls}>Clear filters</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {selectedRow && (
                  <RowInspector
                    row={selectedRow}
                    rowSignal={selectedRowSignal}
                    onClose={() => setSelectedRow(null)}
                    onCopy={(text) => void handleCopy(text, 'Copied selected row.')}
                    onFilter={(query) => applyInvestigationQuery(query, 'append')}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="output-block">
              <ViewUnavailable
                title="Table view is not available yet"
                description={visibleIssues.length > 0 ? 'No valid rows were recovered from this payload. Open parse issues or fix the source first.' : 'This payload does not flatten into rows yet.'}
              />
            </div>
          )
        ) : (
          <div className="output-block">
            {visibleIssues.length === 0 ? (
              <ViewUnavailable title="No parse issues" description="The payload parsed cleanly. Use /raw or /tree if you need secondary views." />
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
