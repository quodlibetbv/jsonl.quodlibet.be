import { expect, test } from '@playwright/test'

test('detects JSON and shows tree view by default', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"user":{"name":"Ada"},"active":true}')
  await expect(page.getByRole('button', { name: 'Tree' })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: /user/ })).toBeVisible()
  await expect(page.locator('.token-string', { hasText: 'Ada' })).toBeVisible()
})

test('detects JSONL and shows table view with line numbers and errors', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada"}\nnot json\n{"id":2,"name":"Linus"}')
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveClass(/active/)
  await expect(page.locator('table')).toBeVisible()
  await expect(page.getByRole('cell', { name: '1' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Errors' }).click()
  await expect(page.getByText(/Line 2/)).toBeVisible()
})

test('shows an empty state before input and collapses source after loading a sample', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Paste a payload or drop a file to start.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hide source' })).toBeVisible()
  await page.getByRole('button', { name: 'Load JSON sample' }).click()
  await expect(page.getByRole('button', { name: 'Tree' })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: 'Show source' })).toBeVisible()
  await expect(page.locator('.token-string', { hasText: 'Ada Lovelace' })).toBeVisible()
})

test('defaults to table for top-level json arrays', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('[{"id":1,"name":"Ada"},{"id":2,"name":"Linus"}]')
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveClass(/active/)
  await expect(page.locator('table')).toBeVisible()
})

test('defaults to errors for invalid json', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{')
  await expect(page.getByRole('button', { name: 'Errors' })).toHaveClass(/active/)
  await expect(page.locator('.issues li')).toContainText("Expected property name or '}' in JSON")
})

test('pretty and minify actions rewrite simple json text', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('JSON input')
  await input.fill('{"a":1,"b":2}')
  await page.getByRole('button', { name: 'Pretty' }).click()
  await expect(input).toHaveValue(/\n  "a": 1,/) 
  await page.getByRole('button', { name: 'Minify' }).click()
  await expect(input).toHaveValue('{"a":1,"b":2}')
})

test('minify preserves nested json content and does not blank the editor', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('JSON input')
  await input.fill(`{
  "glossary": {
    "title": "example glossary",
    "GlossDiv": {
      "title": "S",
      "GlossList": {
        "GlossEntry": {
          "ID": "SGML",
          "SortAs": "SGML",
          "GlossTerm": "Standard Generalized Markup Language",
          "Acronym": "SGML",
          "Abbrev": "ISO 8879:1986",
          "GlossDef": {
            "para": "A meta-markup language, used to create markup languages such as DocBook.",
            "GlossSeeAlso": ["GML", "XML"]
          },
          "GlossSee": "markup"
        }
      }
    }
  }
}`)
  await page.getByRole('button', { name: 'Minify' }).click()
  await expect(input).not.toHaveValue('')
  await expect(input).toHaveValue(/"GlossSeeAlso":\["GML","XML"\]/)
  await expect(input).toHaveValue(/"GlossTerm":"Standard Generalized Markup Language"/)
})

test('minify preserves jsonl content and does not blank the editor', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('JSON input')
  await input.fill('{"id":1,"name":"Ada"}\n{"id":2,"name":"Linus"}')
  await page.getByRole('button', { name: 'Minify' }).click()
  await expect(input).not.toHaveValue('')
  await expect(input).toHaveValue('{"id":1,"name":"Ada"}\n{"id":2,"name":"Linus"}')
})

test('minify is a no-op for jsonl content when mode is forced to json', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('JSON input')
  const original = '{"id":1,"name":"Ada"}\n{"id":2,"name":"Linus"}'
  await input.fill(original)
  await page.getByLabel('Mode').selectOption('json')
  await page.getByRole('button', { name: 'Minify' }).click()
  await expect(input).toHaveValue(original)
})

test('pretty is a no-op for broken json input', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('JSON input')
  const original = '{\n  "a": 1,\n'
  await input.fill(original)
  await page.getByLabel('Mode').selectOption('json')
  await page.getByRole('button', { name: 'Pretty' }).click()
  await expect(input).toHaveValue(original)
})

test('supports file upload and keeps the source drawer collapsed', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'sample.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from('{"id":1}\n{"id":2}'),
  })
  await expect(page.getByRole('button', { name: 'Show source' })).toBeVisible()
  await expect(page.locator('table')).toBeVisible()
  await page.getByRole('button', { name: 'Show source' }).click()
  await expect(page.getByText('Current file: sample.jsonl')).toBeVisible()
})

test('persists source and restores into the compact loaded layout after reload', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"persist":true}')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Show source' })).toBeVisible()
  await page.getByRole('button', { name: 'Show source' }).click()
  await expect(page.getByLabel('JSON input')).toHaveValue('{"persist":true}')
  await expect(page.getByText(/Restored previous session/)).toBeVisible()
})

test('theme toggle works', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Theme').selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('universal filter bar supports free text and structured filters', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada","team":"research","score":98}\n{"id":2,"name":"Linus","team":"platform","score":88}\n{"id":3,"name":"Grace","team":"research","score":91}')
  await page.getByLabel('Filter rows').fill('research score>=90 sort:-score')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.getByText('2 / 3 rows')).toBeVisible()
  await expect(page.locator('tbody tr').nth(0).locator('td').nth(2)).toHaveText('Ada')
  await expect(page.locator('tbody tr').nth(1).locator('td').nth(2)).toHaveText('Grace')
  await expect(page.getByRole('button', { name: 'Remove filter: text:research' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove filter: score>=90' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear sort: sort:-score' })).toBeVisible()
})

test('sort headers cycle asc desc off and expose a removable sort chip', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Grace"}\n{"id":2,"name":"Ada"}\n{"id":3,"name":"Linus"}')
  await page.getByRole('button', { name: 'Sort by name' }).click()
  await expect(page.locator('tbody tr').nth(0).locator('td').nth(2)).toHaveText('Ada')
  await expect(page.getByRole('button', { name: 'Clear sort: sort:name' })).toBeVisible()
  await page.getByRole('button', { name: /Sort by name \(asc\)|Sort by name/ }).click()
  await expect(page.locator('tbody tr').nth(0).locator('td').nth(2)).toHaveText('Linus')
  await expect(page.getByRole('button', { name: 'Clear sort: sort:-name' })).toBeVisible()
  await page.getByRole('button', { name: /Clear sort: sort:-name/ }).click()
  await expect(page.getByRole('button', { name: 'Clear sort: sort:-name' })).toHaveCount(0)
})

test('query chips can be removed to widen the result set', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada","team":"research"}\n{"id":2,"name":"Linus","team":"platform"}\n{"id":3,"name":"Grace","team":"research"}')
  await page.getByLabel('Filter rows').fill('team:research')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove filter: team:research' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await expect(page.getByLabel('Filter rows')).toHaveValue('')
})

test('can require clean jsonl before showing the table', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada"}\nnot json\n{"id":2,"name":"Linus"}')
  await expect(page.locator('table')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Ignore invalid JSONL lines in table view' }).uncheck()
  await expect(page.getByRole('button', { name: 'Errors' })).toHaveClass(/active/)
  await expect(page.locator('table')).toHaveCount(0)
})

test('table can expand and collapse', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada"}\n{"id":2,"name":"Linus"}')
  await page.getByRole('button', { name: 'Expand table' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/table-expanded/)
  await page.getByRole('button', { name: 'Collapse table' }).click()
  await expect(page.locator('.app-shell')).not.toHaveClass(/table-expanded/)
})
