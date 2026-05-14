import { test, expect } from '@playwright/test'
import {
  launchApp,
  makeTask,
  makeTempLapsDir,
  seedFile,
  type LaunchedApp,
  type TempLapsDir
} from './_helpers'

let tmp: TempLapsDir
let launched: LaunchedApp

test.beforeEach(async () => {
  tmp = makeTempLapsDir(
    seedFile([
      makeTask({ id: 'aaa-001', title: 'Alpha task', description: 'first thing' }),
      makeTask({ id: 'bbb-002', title: 'Beta task', description: 'middle item with apples', isDone: true }),
      makeTask({ id: 'ccc-003', title: 'Gamma task', description: 'last entry' })
    ])
  )
  launched = await launchApp(tmp.lapsFile)
})

test.afterEach(async () => {
  await launched.app.close().catch(() => {})
  tmp.cleanup()
})

test('renders all seeded laps in order', async () => {
  const { win } = launched
  const items = win.locator('[data-testid="lap-item"]')
  await expect(items).toHaveCount(3)
  const titles = await items.locator('[data-testid="lap-item-title"]').allInnerTexts()
  expect(titles).toEqual(['Alpha task', 'Beta task', 'Gamma task'])
})

test('search filters list by title', async () => {
  const { win } = launched
  await win.locator('[data-testid="search"]').fill('alpha')
  const items = win.locator('[data-testid="lap-item"]')
  await expect(items).toHaveCount(1)
  await expect(items.first().locator('[data-testid="lap-item-title"]')).toHaveText('Alpha task')
})

test('search filters list by description', async () => {
  const { win } = launched
  await win.locator('[data-testid="search"]').fill('apples')
  const items = win.locator('[data-testid="lap-item"]')
  await expect(items).toHaveCount(1)
  await expect(items.first().locator('[data-testid="lap-item-title"]')).toHaveText('Beta task')
})

test('filter chip "todo" hides done laps', async () => {
  const { win } = launched
  await win.locator('[data-testid="filter-todo"]').click()
  const items = win.locator('[data-testid="lap-item"]')
  await expect(items).toHaveCount(2)
  const titles = await items.locator('[data-testid="lap-item-title"]').allInnerTexts()
  expect(titles).toEqual(['Alpha task', 'Gamma task'])
})

test('filter chip "done" shows only done laps', async () => {
  const { win } = launched
  await win.locator('[data-testid="filter-done"]').click()
  const items = win.locator('[data-testid="lap-item"]')
  await expect(items).toHaveCount(1)
  await expect(items.first().locator('[data-testid="lap-item-title"]')).toHaveText('Beta task')
})

test('file path is displayed', async () => {
  const { win } = launched
  const pathEl = win.locator('[data-testid="file-path"]')
  await expect(pathEl).toContainText(tmp.lapsFile)
})
