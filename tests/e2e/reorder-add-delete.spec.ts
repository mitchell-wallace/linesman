import { test, expect } from '@playwright/test'
import {
  launchApp,
  makeTask,
  makeTempLapsDir,
  readFile,
  seedFile,
  type LaunchedApp,
  type TempLapsDir
} from './_helpers'

let tmp: TempLapsDir
let launched: LaunchedApp

test.beforeEach(async () => {
  tmp = makeTempLapsDir(
    seedFile([
      makeTask({ id: 'aaa-001', title: 'Alpha' }),
      makeTask({ id: 'bbb-002', title: 'Beta' }),
      makeTask({ id: 'ccc-003', title: 'Gamma' })
    ])
  )
  launched = await launchApp(tmp.lapsFile)
})

test.afterEach(async () => {
  await launched.app.close().catch(() => {})
  tmp.cleanup()
})

test('move-down on the first row reorders on disk', async () => {
  const { win } = launched
  const firstRow = win.locator('[data-lap-id="aaa-001"]')
  await firstRow.hover()
  await firstRow.locator('[data-testid="lap-item-move-down"]').click()

  await expect.poll(() => readFile(tmp.lapsFile).tasks.map((t) => t.id), { timeout: 5000 }).toEqual([
    'bbb-002',
    'aaa-001',
    'ccc-003'
  ])
})

test('move-up on the last row reorders on disk', async () => {
  const { win } = launched
  const lastRow = win.locator('[data-lap-id="ccc-003"]')
  await lastRow.hover()
  await lastRow.locator('[data-testid="lap-item-move-up"]').click()

  await expect.poll(() => readFile(tmp.lapsFile).tasks.map((t) => t.id), { timeout: 5000 }).toEqual([
    'aaa-001',
    'ccc-003',
    'bbb-002'
  ])
})

test('add lap at head', async () => {
  const { win } = launched
  await win.locator('[data-testid="add-lap-button"]').click()
  await win.locator('[data-testid="add-title"]').fill('Brand new head')
  await win.locator('[data-testid="add-position"]').selectOption('head')
  await win.locator('[data-testid="add-submit"]').click()

  await expect.poll(() => {
    const file = readFile(tmp.lapsFile)
    return file.tasks[0]?.title
  }, { timeout: 5000 }).toBe('Brand new head')
  expect(readFile(tmp.lapsFile).tasks).toHaveLength(4)
})

test('add lap at tail', async () => {
  const { win } = launched
  await win.locator('[data-testid="add-lap-button"]').click()
  await win.locator('[data-testid="add-title"]').fill('Brand new tail')
  await win.locator('[data-testid="add-position"]').selectOption('tail')
  await win.locator('[data-testid="add-submit"]').click()

  await expect.poll(() => {
    const file = readFile(tmp.lapsFile)
    return file.tasks[file.tasks.length - 1]?.title
  }, { timeout: 5000 }).toBe('Brand new tail')
})

test('add lap after current selection', async () => {
  const { win } = launched
  await win.locator('[data-lap-id="aaa-001"]').click()
  await win.locator('[data-testid="add-lap-button"]').click()
  await win.locator('[data-testid="add-title"]').fill('Right after Alpha')
  await win.locator('[data-testid="add-position"]').selectOption('after')
  await win.locator('[data-testid="add-submit"]').click()

  await expect.poll(() => {
    const file = readFile(tmp.lapsFile)
    return file.tasks[1]?.title
  }, { timeout: 5000 }).toBe('Right after Alpha')
})

test('delete lap with confirm modal removes it from disk', async () => {
  const { win } = launched
  await win.locator('[data-lap-id="bbb-002"]').click()
  await win.locator('[data-testid="editor-delete"]').click()
  await expect(win.locator('[data-testid="confirm-modal"]')).toBeVisible()
  await win.locator('[data-testid="confirm-yes"]').click()

  await expect.poll(() => readFile(tmp.lapsFile).tasks.map((t) => t.id), { timeout: 5000 }).toEqual([
    'aaa-001',
    'ccc-003'
  ])
})
