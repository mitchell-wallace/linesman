import { test, expect } from '@playwright/test'
import {
  launchApp,
  makeTask,
  makeTempLapsDir,
  readFile,
  seedFile,
  sleep,
  waitForPoll,
  writeFile,
  type LaunchedApp,
  type TempLapsDir
} from './_helpers'

let tmp: TempLapsDir
let launched: LaunchedApp

test.beforeEach(async () => {
  tmp = makeTempLapsDir(
    seedFile([
      makeTask({ id: 'aaa-001', title: 'Alpha', description: 'first' }),
      makeTask({ id: 'bbb-002', title: 'Beta', description: 'second' })
    ])
  )
  launched = await launchApp(tmp.lapsFile)
})

test.afterEach(async () => {
  await launched.app.close().catch(() => {})
  tmp.cleanup()
})

test('externally added lap appears after poll with toast', async () => {
  test.slow()
  const { win } = launched
  await expect(win.locator('[data-testid="lap-item"]')).toHaveCount(2)

  const file = readFile(tmp.lapsFile)
  file.tasks.push(makeTask({ id: 'zzz-009', title: 'External addition' }))
  writeFile(tmp.lapsFile, file)

  await waitForPoll()

  await expect(win.locator('[data-lap-id="zzz-009"]')).toBeVisible({ timeout: 10000 })
  await expect(win.locator('[data-testid="toast"]')).toContainText('External addition')
})

test('externally modified description of selected lap (no local edits) updates editor silently', async () => {
  test.slow()
  const { win } = launched
  await win.locator('[data-lap-id="bbb-002"]').click()
  await expect(win.locator('[data-testid="editor-description"]')).toHaveValue('second')

  const file = readFile(tmp.lapsFile)
  const t = file.tasks.find((x) => x.id === 'bbb-002')!
  t.description = 'externally rewritten'
  t.updatedAt = new Date().toISOString()
  writeFile(tmp.lapsFile, file)

  await waitForPoll()

  await expect(win.locator('[data-testid="editor-description"]')).toHaveValue(
    'externally rewritten',
    { timeout: 10000 }
  )
  await expect(win.locator('[data-testid="ext-banner"]')).toHaveCount(0)
})

test('external mod while user is editing shows ext badge + ext banner; Keep retains user edit', async () => {
  test.slow()
  const { win } = launched
  await win.locator('[data-lap-id="aaa-001"]').click()
  await win.locator('[data-testid="editor-title"]').fill('user-edited title')
  await win.locator('[data-testid="editor-title"]').blur()

  const file = readFile(tmp.lapsFile)
  const t = file.tasks.find((x) => x.id === 'aaa-001')!
  t.title = 'externally changed'
  t.updatedAt = new Date().toISOString()
  writeFile(tmp.lapsFile, file)

  await waitForPoll()

  await expect(win.locator('[data-lap-id="aaa-001"] [data-testid="lap-item-ext"]')).toBeVisible({
    timeout: 10000
  })
  await expect(win.locator('[data-testid="ext-banner"]')).toBeVisible()

  await win.locator('[data-testid="keep-edits-button"]').click()
  await expect(win.locator('[data-testid="ext-banner"]')).toHaveCount(0)
  await expect(win.locator('[data-testid="editor-title"]')).toHaveValue('user-edited title')
})

test('external mod while user is editing — Discard reloads from disk', async () => {
  test.slow()
  const { win } = launched
  await win.locator('[data-lap-id="aaa-001"]').click()
  await win.locator('[data-testid="editor-title"]').fill('user-edited title')
  await win.locator('[data-testid="editor-title"]').blur()

  const file = readFile(tmp.lapsFile)
  const t = file.tasks.find((x) => x.id === 'aaa-001')!
  t.title = 'externally changed'
  t.updatedAt = new Date().toISOString()
  writeFile(tmp.lapsFile, file)

  await waitForPoll()
  await expect(win.locator('[data-testid="ext-banner"]')).toBeVisible({ timeout: 10000 })

  await win.locator('[data-testid="discard-edits-button"]').click()
  await expect(win.locator('[data-testid="ext-banner"]')).toHaveCount(0)
  await expect(win.locator('[data-testid="editor-title"]')).toHaveValue('externally changed')
})

test('externally deleted selected lap with unsaved edits — Recover restores with edits, preserves id', async () => {
  test.slow()
  const { win } = launched
  await win.locator('[data-lap-id="aaa-001"]').click()
  await win.locator('[data-testid="editor-description"]').fill('local pending edit')
  await win.locator('[data-testid="editor-description"]').blur()
  await sleep(200)

  const file = readFile(tmp.lapsFile)
  file.tasks = file.tasks.filter((x) => x.id !== 'aaa-001')
  writeFile(tmp.lapsFile, file)

  await waitForPoll()

  await expect(win.locator('[data-testid="deleted-banner"]')).toBeVisible({ timeout: 10000 })

  await win.locator('[data-testid="recover-button"]').click()

  await expect.poll(() => {
    const t = readFile(tmp.lapsFile).tasks.find((x) => x.id === 'aaa-001')
    return t?.description
  }, { timeout: 5000 }).toBe('local pending edit')

  const recovered = readFile(tmp.lapsFile).tasks.find((x) => x.id === 'aaa-001')!
  expect(recovered.id).toBe('aaa-001')
  await expect(win.locator('[data-testid="deleted-banner"]')).toHaveCount(0)
})
