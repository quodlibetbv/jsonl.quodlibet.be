import type { TableData, TableQueryChip, TableQueryResult, TableRow, TableSortState } from '../types'

const STRUCTURED_FILTER_RE = /^([A-Za-z0-9_.-]+)(<=|>=|!=|=|:|<|>)(.+)$/
const NUMERIC_RE = /^-?(?:\d+|\d*\.\d+)$/

type FilterOperator = 'contains' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'

interface QueryTokenBase {
  raw: string
  index: number
}

interface SearchToken extends QueryTokenBase {
  kind: 'search'
  value: string
}

interface FilterToken extends QueryTokenBase {
  kind: 'filter'
  column: string
  operator: FilterOperator
  rawValue: string
  value: unknown
}

interface SortToken extends QueryTokenBase {
  kind: 'sort'
  sort: TableSortState
}

type ParsedQueryToken = SearchToken | FilterToken | SortToken

function isDateLike(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[tT ].+)?$/.test(input)
}

function unquote(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
  }
  return trimmed
}

function parseLiteral(input: string): unknown {
  const value = unquote(input)
  const lower = value.toLowerCase()

  if (lower === 'true') return true
  if (lower === 'false') return false
  if (lower === 'null') return null
  if (NUMERIC_RE.test(value)) return Number(value)

  return value
}

function formatSearchableValue(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function normalizeSearchText(value: unknown): string {
  return formatSearchableValue(value).toLowerCase()
}

function parseComparable(value: unknown): { kind: 'number' | 'date' | 'text'; value: number | string } | null {
  if (value === undefined || value === null) return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    return { kind: 'number', value }
  }

  const text = typeof value === 'string' ? value.trim() : formatSearchableValue(value)

  if (NUMERIC_RE.test(text)) {
    return { kind: 'number', value: Number(text) }
  }

  if (isDateLike(text)) {
    const timestamp = Date.parse(text)
    if (!Number.isNaN(timestamp)) {
      return { kind: 'date', value: timestamp }
    }
  }

  return { kind: 'text', value: text.toLowerCase() }
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === undefined) return false
  if (left === null || right === null) return left === right

  const leftComparable = parseComparable(left)
  const rightComparable = parseComparable(right)

  if (leftComparable && rightComparable && leftComparable.kind === rightComparable.kind) {
    return leftComparable.value === rightComparable.value
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') return left === right

  return normalizeSearchText(left) === normalizeSearchText(right)
}

function compareValues(left: unknown, right: unknown): number | null {
  const leftComparable = parseComparable(left)
  const rightComparable = parseComparable(right)

  if (!leftComparable || !rightComparable) return null
  if (leftComparable.kind !== rightComparable.kind) return null

  if (typeof leftComparable.value === 'number' && typeof rightComparable.value === 'number') {
    return leftComparable.value - rightComparable.value
  }

  return String(leftComparable.value).localeCompare(String(rightComparable.value), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function tokenLabel(token: ParsedQueryToken): string {
  if (token.kind === 'search') return `text:${token.value}`
  if (token.kind === 'sort') return `sort:${token.sort.direction === 'desc' ? '-' : ''}${token.sort.column}`

  const operatorLabel =
    token.operator === 'contains'
      ? ':'
      : token.operator === 'eq'
        ? '='
        : token.operator === 'neq'
          ? '!='
          : token.operator === 'gt'
            ? '>'
            : token.operator === 'gte'
              ? '>='
              : token.operator === 'lt'
                ? '<'
                : '<='

  return `${token.column}${operatorLabel}${token.rawValue}`
}

function tokenizeQuery(query: string): QueryTokenBase[] {
  const tokens: QueryTokenBase[] = []
  let index = 0
  let tokenIndex = 0

  while (index < query.length) {
    while (index < query.length && /\s/.test(query[index])) index += 1
    if (index >= query.length) break

    const start = index
    let inQuotes = false
    let escaped = false

    while (index < query.length) {
      const character = query[index]

      if (inQuotes) {
        if (escaped) {
          escaped = false
          index += 1
          continue
        }

        if (character === '\\') {
          escaped = true
          index += 1
          continue
        }

        if (character === '"') {
          inQuotes = false
          index += 1
          continue
        }

        index += 1
        continue
      }

      if (character === '"') {
        inQuotes = true
        index += 1
        continue
      }

      if (/\s/.test(character)) break
      index += 1
    }

    const raw = query.slice(start, index)
    if (raw) {
      tokens.push({ raw, index: tokenIndex })
      tokenIndex += 1
    }
  }

  return tokens
}

function parseSortToken(token: QueryTokenBase): SortToken | null {
  if (!token.raw.toLowerCase().startsWith('sort:')) return null

  const body = unquote(token.raw.slice(5))
  if (!body) return null

  let column = body
  let direction: TableSortState['direction'] = 'asc'

  if (body.startsWith('-')) {
    column = body.slice(1)
    direction = 'desc'
  } else if (body.startsWith('+')) {
    column = body.slice(1)
  }

  if (column.endsWith(':desc')) {
    column = column.slice(0, -5)
    direction = 'desc'
  } else if (column.endsWith(':asc')) {
    column = column.slice(0, -4)
    direction = 'asc'
  }

  if (!column) return null

  return {
    ...token,
    kind: 'sort',
    sort: { column, direction },
  }
}

function parseFilterToken(token: QueryTokenBase): FilterToken | SearchToken {
  const match = token.raw.match(STRUCTURED_FILTER_RE)
  if (!match) {
    return {
      ...token,
      kind: 'search',
      value: unquote(token.raw),
    }
  }

  const [, column, operator, rawValue] = match
  const normalizedOperator: FilterOperator =
    operator === ':'
      ? 'contains'
      : operator === '='
        ? 'eq'
        : operator === '!='
          ? 'neq'
          : operator === '>'
            ? 'gt'
            : operator === '>='
              ? 'gte'
              : operator === '<'
                ? 'lt'
                : 'lte'

  return {
    ...token,
    kind: 'filter',
    column,
    operator: normalizedOperator,
    rawValue,
    value: parseLiteral(rawValue),
  }
}

export function parseTableQuery(query: string): ParsedQueryToken[] {
  return tokenizeQuery(query)
    .map((token) => parseSortToken(token) ?? parseFilterToken(token))
    .filter((token) => !(token.kind === 'search' && token.value.length === 0))
}

function rowMatchesSearch(row: TableRow, columns: string[], searchTokens: SearchToken[]): boolean {
  return searchTokens.every((token) => {
    const query = token.value.toLowerCase()
    if (!query) return true
    return columns.some((column) => normalizeSearchText(row[column]).includes(query))
  })
}

function rowMatchesFilter(row: TableRow, filter: FilterToken): boolean {
  const cellValue = row[filter.column]

  if (filter.operator === 'contains') {
    return normalizeSearchText(cellValue).includes(String(filter.value).toLowerCase())
  }

  if (filter.operator === 'eq') return valuesEqual(cellValue, filter.value)
  if (filter.operator === 'neq') return !valuesEqual(cellValue, filter.value)

  const comparison = compareValues(cellValue, filter.value)
  if (comparison === null) return false

  if (filter.operator === 'gt') return comparison > 0
  if (filter.operator === 'gte') return comparison >= 0
  if (filter.operator === 'lt') return comparison < 0
  return comparison <= 0
}

function rowMatchesFilters(row: TableRow, filterTokens: FilterToken[]): boolean {
  return filterTokens.every((token) => rowMatchesFilter(row, token))
}

function compareForSort(left: unknown, right: unknown): number {
  if (left === undefined && right === undefined) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right)
  }

  const numeric = compareValues(left, right)
  if (numeric !== null) return numeric

  return formatSearchableValue(left).localeCompare(formatSearchableValue(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortRows(rows: TableRow[], sort: TableSortState | null): TableRow[] {
  if (!sort) return rows

  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((left, right) => {
    const comparison = compareForSort(left[sort.column], right[sort.column])
    if (comparison !== 0) return comparison * direction

    return compareForSort(left._line, right._line)
  })
}

function buildChips(tokens: ParsedQueryToken[], resolvedSort: TableSortState | null, stateSort: TableSortState | null): TableQueryChip[] {
  const chips: TableQueryChip[] = tokens.map((token) => ({
    key: `${token.kind}-${token.index}-${token.raw}`,
    kind: token.kind,
    label: tokenLabel(token),
    tokenIndex: token.index,
    source: 'query',
  }))

  const sortFromQuery = tokens.some((token) => token.kind === 'sort')
  if (resolvedSort && stateSort && !sortFromQuery) {
    chips.push({
      key: `sort-state-${resolvedSort.column}-${resolvedSort.direction}`,
      kind: 'sort',
      label: `sort:${resolvedSort.direction === 'desc' ? '-' : ''}${resolvedSort.column}`,
      source: 'state',
    })
  }

  return chips
}

export function filterTableData(table: TableData, query: string, stateSort: TableSortState | null = null): TableQueryResult {
  const parsedTokens = parseTableQuery(query)
  const searchTokens = parsedTokens.filter((token): token is SearchToken => token.kind === 'search')
  const filterTokens = parsedTokens.filter((token): token is FilterToken => token.kind === 'filter')
  const sortTokens = parsedTokens.filter((token): token is SortToken => token.kind === 'sort')
  const querySort = sortTokens.at(-1)?.sort ?? null
  const resolvedSort = querySort ?? stateSort

  const filteredRows = table.rows.filter((row) => rowMatchesSearch(row, table.columns, searchTokens) && rowMatchesFilters(row, filterTokens))
  const rows = sortRows(filteredRows, resolvedSort)

  return {
    columns: table.columns,
    rows,
    totalRows: table.rows.length,
    visibleRows: rows.length,
    chips: buildChips(parsedTokens, resolvedSort, stateSort),
    sort: resolvedSort,
    sortSource: querySort ? 'query' : stateSort ? 'state' : null,
  }
}

export function removeQueryToken(query: string, tokenIndex: number): string {
  return tokenizeQuery(query)
    .filter((token) => token.index !== tokenIndex)
    .map((token) => token.raw)
    .join(' ')
}

export function stripSortTokens(query: string): string {
  return parseTableQuery(query)
    .filter((token) => token.kind !== 'sort')
    .map((token) => token.raw)
    .join(' ')
}

export function toggleSortState(current: TableSortState | null, column: string): TableSortState | null {
  if (!current || current.column !== column) return { column, direction: 'asc' }
  if (current.direction === 'asc') return { column, direction: 'desc' }
  return null
}
