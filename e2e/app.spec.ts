import { expect, test } from '@playwright/test'

test('detects JSON and shows tree view by default', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"user":{"name":"Ada"},"active":true}')
  await expect(page.getByRole('button', { name: 'Tree' })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: /user/ })).toBeVisible()
  await expect(page.locator('.token-string', { hasText: 'Ada' })).toBeVisible()
})

test('centers JSONL investigation in table mode with parse-issue shortcut', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada"}\nnot json\n{"id":2,"name":"Linus"}')
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveClass(/active/)
  await expect(page.getByText('Investigation desk')).toBeVisible()
  await expect(page.getByText('Rows in play')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open 1 parse issue' })).toBeVisible()
  await page.getByRole('button', { name: 'Open 1 parse issue' }).click()
  await expect(page.getByText(/Line 2/)).toBeVisible()
})

test('shows focused shortcuts for missing and nested signals', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill(
    '{"id":1,"name":"Ada","error":null,"payload":{"retryable":true}}\n' +
      '{"id":2,"name":"Linus","payload":"timeout"}\n' +
      '{"id":3,"name":"Grace","payload":["warn"]}'
  )

  await expect(page.getByRole('button', { name: 'Rows with missing fields (2)' })).toBeVisible()
  await page.getByRole('button', { name: 'Rows with missing fields (2)' }).click()
  await expect(page.getByLabel('Filter rows')).toHaveValue('has:missing')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('tbody tr')).toContainText(['Linus', 'Grace'])

  await page.getByRole('button', { name: 'Reset table' }).click()
  await page.getByRole('button', { name: 'Rows with nested values (2)' }).click()
  await expect(page.getByLabel('Filter rows')).toHaveValue('has:complex')
  await expect(page.locator('tbody tr')).toHaveCount(2)
})

test('row inspector shows forensic details and can append anomaly filters', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill(
    '{"id":1,"name":"Ada","payload":{"retryable":true},"notes":""}\n' +
      '{"id":2,"name":"Linus","payload":"timeout","notes":null}\n' +
      '{"id":3,"name":"Grace","payload":["warn"]}'
  )

  const inspector = page.getByRole('complementary')
  await page.locator('tbody tr').nth(2).click()
  await expect(inspector.getByRole('heading', { name: 'Line 3' })).toBeVisible()
  await expect(inspector.getByText('Missing fields')).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'notes' })).toBeVisible()
  await inspector.getByRole('button', { name: 'notes' }).click()
  await expect(page.getByLabel('Filter rows')).toHaveValue(/notes=missing/)
  await expect(page.locator('tbody tr')).toHaveCount(1)
})

test('shows semantic cells for null and structured values', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"error":null,"payload":{"retryable":true},"trace":["a","b"]}')
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.locator('.semantic-pill.kind-null')).toBeVisible()
  await expect(page.locator('.semantic-pill.kind-object')).toBeVisible()
  await expect(page.locator('.semantic-pill.kind-array')).toBeVisible()
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
