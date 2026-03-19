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
  await page.locator('section.panel select').selectOption('json')
  await page.getByRole('button', { name: 'Minify' }).click()
  await expect(input).toHaveValue(original)
})

test('pretty is a no-op for broken json input', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('JSON input')
  const original = '{\n  "a": 1,\n'
  await input.fill(original)
  await page.locator('section.panel select').selectOption('json')
  await page.getByRole('button', { name: 'Pretty' }).click()
  await expect(input).toHaveValue(original)
})

test('supports file upload', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'sample.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from('{"id":1}\n{"id":2}'),
  })
  await expect(page.getByText('Current file: sample.jsonl')).toBeVisible()
  await expect(page.locator('table')).toBeVisible()
})

test('persists source and restores after reload', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('JSON input')
  await input.fill('{"persist":true}')
  await page.reload()
  await expect(input).toHaveValue('{"persist":true}')
  await expect(page.getByText(/Restored previous session/)).toBeVisible()
})

test('theme toggle works', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Theme').selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('table search filters rows', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada"}\n{"id":2,"name":"Linus"}\n{"id":3,"name":"Grace"}')
  await page.getByLabel('Search table').fill('lin')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('cell', { name: 'Linus' })).toBeVisible()
})

test('column filters narrow table results', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada","meta":{"team":"core"}}\n{"id":2,"name":"Linus","meta":{"team":"ops"}}')
  await page.getByLabel('Filter meta.team').fill('ops')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('cell', { name: 'ops' })).toBeVisible()
})

test('table can expand and collapse', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada"}\n{"id":2,"name":"Linus"}')
  await page.getByRole('button', { name: 'Expand table' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/table-expanded/)
  await page.getByRole('button', { name: 'Collapse table' }).click()
  await expect(page.locator('.app-shell')).not.toHaveClass(/table-expanded/)
})
