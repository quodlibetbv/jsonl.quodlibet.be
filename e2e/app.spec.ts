import { expect, test } from '@playwright/test'

test('defaults to the table for loaded JSON objects', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"user":{"name":"Ada"},"active":true}')

  await expect(page.locator('table')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /user.name/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sort by active' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tree' })).toHaveCount(0)
})

test('keeps the loaded surface quiet and opens parse issues on demand', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"id":1,"name":"Ada"}\nnot json\n{"id":2,"name":"Linus"}')

  await expect(page.locator('table')).toBeVisible()
  await expect(page.getByText('Rows in play')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Open 1 parse issue/i })).toHaveCount(0)

  await page.getByLabel('Smart command bar').fill('/errors')
  await page.getByLabel('Smart command bar').press('Enter')
  await expect(page.getByRole('heading', { name: 'Parse issues' })).toBeVisible()
  await expect(page.getByText(/Line 2/)).toBeVisible()
})

test('row detail stays hidden until a row is selected and can append anomaly filters', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill(
    '{"id":1,"name":"Ada","payload":{"retryable":true},"notes":""}\n' +
      '{"id":2,"name":"Linus","payload":"timeout","notes":null}\n' +
      '{"id":3,"name":"Grace","payload":["warn"]}'
  )

  await expect(page.getByLabel('Row detail')).toHaveCount(0)
  await page.locator('tbody tr').nth(2).click()

  const detail = page.getByLabel('Row detail')
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Line 3' })).toBeVisible()
  await detail.getByRole('button', { name: 'notes' }).click()
  await expect(page.getByLabel('Smart command bar')).toHaveValue(/notes=missing/)
  await expect(page.locator('tbody tr')).toHaveCount(1)
})

test('source stays out of the default loaded view and reopens through the explicit edit path', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Source' })).toBeVisible()

  await page.getByRole('button', { name: 'Load JSON sample' }).click()
  await expect(page.getByRole('heading', { name: 'Source' })).toHaveCount(0)
  await expect(page.locator('table')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit source' })).toBeVisible()

  await page.getByRole('button', { name: 'Edit source' }).click()
  await expect(page.getByRole('heading', { name: 'Source' })).toBeVisible()
})

test('supports file upload and keeps the row detail closed after load', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'sample.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from('{"id":1}\n{"id":2}'),
  })

  await expect(page.locator('table')).toBeVisible()
  await expect(page.getByLabel('Row detail')).toHaveCount(0)
  await page.getByLabel('Smart command bar').fill('/source')
  await page.getByLabel('Smart command bar').press('Enter')
  await expect(page.getByText('Current file: sample.jsonl')).toBeVisible()
})

test('restores into the simplified loaded layout after reload with an explicit source edit path', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('JSON input').fill('{"persist":true}')
  await page.reload()

  await expect(page.locator('table')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Source' })).toHaveCount(0)
  await expect(page.getByLabel('Smart command bar')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Edit source' })).toBeVisible()

  await page.getByRole('button', { name: 'Edit source' }).click()
  await expect(page.getByLabel('JSON input')).toHaveValue('{"persist":true}')
  await expect(page.getByText(/Restored previous session/)).toBeVisible()
})
