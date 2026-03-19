import { useEffect, useMemo, useRef, useState } from 'react'
import logoUrl from './assets/quodlibet-logo.svg'
import './App.css'
import type { DetectedFormat, ParseIssue, ThemeMode, ViewMode } from './types'
import { parseInput } from './lib/parser'
import { formatCellValue, minifyJson, prettyPrintJson, stringifyJsonl } from './lib/format'
import { filterTableData } from './lib/filter'
import { tableDataFromJson, tableDataFromJsonl } from './lib/table'
import { clearState, loadState, saveState } from './lib/storage'

type ManualFormat = DetectedFormat | 'auto'

function valueKind(value: unknown): string {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
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

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [sourceText, setSourceText] = useState('')
  const [filename, setFilename] = useState<string | undefined>()
  const [manualFormat, setManualFormat] = useState<ManualFormat>('auto')
  const [activeView, setActiveView] = useState<ViewMode>('raw')
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [skipInvalidJsonl, setSkipInvalidJsonl] = useState(true)
  const [tableExpanded, setTableExpanded] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [restored, setRestored] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  const parsed = useMemo(
    () => parseInput(sourceText, { manualFormat, filename, skipInvalidJsonl }),
    [sourceText, manualFormat, filename, skipInvalidJsonl],
  )

  const tableData = useMemo(() => {
    if (parsed.format === 'json' && parsed.jsonValue !== undefined) return tableDataFromJson(parsed.jsonValue)
    if (parsed.format === 'jsonl') return tableDataFromJsonl(parsed.jsonlRows)
    return { columns: [], rows: [] }
  }, [parsed])

  const filteredTableData = useMemo(
    () => filterTableData(tableData, tableSearch, columnFilters),
    [tableData, tableSearch, columnFilters],
  )

  useEffect(() => {
    void loadState().then((saved) => {
      if (saved) {
        setSourceText(saved.sourceText)
        setManualFormat(saved.manualFormat)
        setActiveView(saved.activeView)
        setTheme(saved.theme)
        setSkipInvalidJsonl(saved.skipInvalidJsonl)
        setTableExpanded(saved.tableExpanded ?? false)
        setTableSearch(saved.tableSearch ?? '')
        setColumnFilters(saved.columnFilters ?? {})
        setRestored(Boolean(saved.sourceText))
      }
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (!hydrated) return
    void saveState({ sourceText, manualFormat, activeView, theme, skipInvalidJsonl, tableExpanded, tableSearch, columnFilters })
  }, [sourceText, manualFormat, activeView, theme, skipInvalidJsonl, tableExpanded, tableSearch, columnFilters, hydrated])

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
    if (!sourceText.trim()) {
      setActiveView('raw')
      return
    }

    if (parsed.format === 'jsonl') {
      setActiveView((current) => (current === 'raw' ? 'table' : current))
    } else if (parsed.format === 'json') {
      setActiveView((current) => (current === 'raw' ? 'tree' : current))
    }
  }, [parsed.format, sourceText])

  function updateSource(next: string, nextFilename?: string) {
    setSourceText(next)
    setFilename(nextFilename)
  }

  async function handleFile(file: File) {
    const text = await file.text()
    updateSource(text, file.name)
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

    setSourceText(nextText)
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
    setTableSearch('')
    setColumnFilters({})
    setRestored(false)
    await clearState()
  }

  function setColumnFilter(column: string, value: string) {
    setColumnFilters((current) => ({ ...current, [column]: value }))
  }

  function resetTableFilters() {
    setTableSearch('')
    setColumnFilters({})
  }

  const formatBadge = parsed.format === 'unknown' ? 'Unknown' : parsed.format.toUpperCase()
  const canShowTree = parsed.format === 'json' && parsed.jsonValue !== undefined
  const canShowTable = tableData.rows.length > 0
  const visibleIssues: ParseIssue[] = parsed.issues

  return (
    <div className={`app-shell${tableExpanded ? ' table-expanded' : ''}`}>
      <header className="topbar">
        <div>
          <div className="brand-row">
            <img src={logoUrl} alt="Quodlibet logo" className="brand-logo" />
            <div>
              <p className="eyebrow">quodlibet's json(l) viewer</p>
              <h1>Built for messy payloads</h1>
            </div>
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
          <button onClick={handlePrettyPrint} disabled={!sourceText.trim()}>Pretty</button>
          <button onClick={handleMinify} disabled={!sourceText.trim()}>Minify</button>
          <button onClick={handleDownload} disabled={!sourceText.trim()}>Download</button>
          <button className="danger" onClick={() => void handleClear()} disabled={!sourceText.trim()}>Clear</button>
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

      <main className="main-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Input</h2>
            <div className="inline-controls">
              <label>
                Mode
                <select value={manualFormat} onChange={(event) => setManualFormat(event.target.value as ManualFormat)}>
                  <option value="auto">Auto</option>
                  <option value="json">JSON</option>
                  <option value="jsonl">JSONL</option>
                </select>
              </label>
            </div>
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
            <p>Paste raw JSON or JSONL, or drop a file here.</p>
            {filename && <p className="muted">Current file: {filename}</p>}
            {restored && !filename && <p className="muted">Restored previous session from browser storage.</p>}
          </div>

          <textarea
            aria-label="JSON input"
            className="source-text"
            spellCheck={false}
            value={sourceText}
            onChange={(event) => updateSource(event.target.value)}
            placeholder={'Paste JSON or JSONL here\n{"name":"Ada"}\n{"name":"Linus"}'}
          />

          <div className="input-meta">
            <span>Lines: {sourceText ? sourceText.split(/\r?\n/).length : 0}</span>
            <span>Rows: {parsed.jsonlRows.length || tableData.rows.length}</span>
            {canShowTable && <span>Visible: {filteredTableData.rows.length}</span>}
            <span>Issues: {visibleIssues.length}</span>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={skipInvalidJsonl}
              onChange={(event) => setSkipInvalidJsonl(event.target.checked)}
            />
            Ignore invalid JSONL lines in table view
          </label>
        </section>

        <section className="panel">
          <div className="panel-header output-header">
            <h2>Output</h2>
            <div className="tabs" role="tablist" aria-label="Output views">
              <button className={activeView === 'raw' ? 'active' : ''} onClick={() => setActiveView('raw')}>Raw</button>
              <button className={activeView === 'tree' ? 'active' : ''} onClick={() => setActiveView('tree')} disabled={!canShowTree}>Tree</button>
              <button className={activeView === 'table' ? 'active' : ''} onClick={() => setActiveView('table')} disabled={!canShowTable}>Table</button>
              <button className={activeView === 'errors' ? 'active' : ''} onClick={() => setActiveView('errors')}>Errors</button>
            </div>
          </div>

          {activeView === 'raw' && (
            <div className="output-block">
              <div className="action-row">
                <button onClick={() => void handleCopy(sourceText)} disabled={!sourceText.trim()}>Copy source</button>
              </div>
              <pre>{sourceText || 'No input yet.'}</pre>
            </div>
          )}

          {activeView === 'tree' && canShowTree && (
            <div className="output-block tree-block">
              <div className="action-row">
                <button onClick={() => void handleCopy(prettyPrintJson(parsed.jsonValue))}>Copy formatted JSON</button>
              </div>
              <JsonTree value={parsed.jsonValue} />
            </div>
          )}

          {activeView === 'table' && canShowTable && (
            <div className="output-block table-block">
              <div className="action-row table-toolbar">
                <input
                  aria-label="Search table"
                  className="table-search"
                  type="text"
                  placeholder="Search visible columns"
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                />
                <span className="muted table-count">{filteredTableData.rows.length} / {tableData.rows.length} rows</span>
                <button onClick={() => setTableExpanded((current) => !current)}>
                  {tableExpanded ? 'Collapse table' : 'Expand table'}
                </button>
                <button onClick={resetTableFilters}>Reset filters</button>
                <button onClick={() => void handleCopy(JSON.stringify(filteredTableData.rows.map((row) => row.__raw), null, 2))}>Copy rows</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {filteredTableData.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                    <tr>
                      {filteredTableData.columns.map((column) => (
                        <th key={`${column}-filter`}>
                          <input
                            aria-label={`Filter ${column}`}
                            className="column-filter"
                            type="text"
                            placeholder="Filter"
                            value={columnFilters[column] ?? ''}
                            onChange={(event) => setColumnFilter(column, event.target.value)}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTableData.rows.map((row, index) => (
                      <tr key={index}>
                        {filteredTableData.columns.map((column) => (
                          <td key={column} data-kind={valueKind(row[column])}>
                            {formatCellValue(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeView === 'errors' && (
            <div className="output-block">
              {visibleIssues.length === 0 ? (
                <p className="muted">No parse issues.</p>
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
      </main>

      <footer className="footer-link">
        <a href="https://quodlibet.be" target="_blank" rel="noreferrer">quodlibet.be</a>
      </footer>
    </div>
  )
}

export default App
