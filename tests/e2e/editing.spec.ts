import { test, expect } from '@playwright/test'
import {
  launchApp,
  makeTask,
  makeTempLapsDir,
  readFile,
  seedFile,
  sleep,
  type LaunchedApp,
  type TempLapsDir
} from './_helpers'

let tmp: TempLapsDir
let launched: LaunchedApp

test.beforeEach(async () => {
  tmp = makeTempLapsDir(
    seedFile([
      makeTask({ id: 'aaa-001', title: 'Alpha task', description: 'first' }),
      makeTask({ id: 'bbb-002', title: 'Beta task', description: 'second' }),
      makeTask({ id: 'ccc-003', title: 'Gamma task', description: 'third' })
    ])
  )
  launched = await launchApp(tmp.lapsFile)
})

test.afterEach(async () => {
  await launched.app.close().catch(() => {})
  tmp.cleanup()
})

test('selecting a lap populates the editor with its data', async () => {
  const { win } = launched
  await win.locator('[data-lap-id="bbb-002"]').click()
  await expect(win.locator('[data-testid="editor-title"]')).toHaveValue('Beta task')
  await expect(win.locator('[data-testid="editor-description"]')).toHaveValue('second')
})

test('typing in title then switching laps saves to disk', async () => {
  const { win } = launched
  await win.locator('[data-lap-id="aaa-001"]').click()
  const titleInput = win.locator('[data-testid="editor-title"]')
  await titleInput.fill('Alpha task — edited')

  await win.locator('[data-lap-id="ccc-003"]').click()

  await expect.poll(() => {
    const file = readFile(tmp.lapsFile)
    const t = file.tasks.find((x) => x.id === 'aaa-001')
    return t?.title
  }, { timeout: 5000 }).toBe('Alpha task — edited')
})

test('idle save flushes pending edit to disk after timeout', async () => {
  test.slow()
  const { win } = launched
  await win.locator('[data-lap-id="aaa-001"]').click()
  await win.locator('[data-testid="editor-title"]').fill('Alpha task — idle saved')

  await sleep(32000)

  await expect.poll(() => {
    const file = readFile(tmp.lapsFile)
    return file.tasks.find((x) => x.id === 'aaa-001')?.title
  }, { timeout: 5000 }).toBe('Alpha task — idle saved')
})

test('toggling isDone saves immediately and shows strikethrough', async () => {
  const { win } = launched
  await win.locator('[data-lap-id="aaa-001"]').click()
  await win.locator('[data-testid="editor-done"]').check()

  await expect.poll(() => {
    const t = readFile(tmp.lapsFile).tasks.find((x) => x.id === 'aaa-001')
    return t?.isDone
  }, { timeout: 5000 }).toBe(true)

  const titleEl = win.locator('[data-lap-id="aaa-001"] [data-testid="lap-item-title"]')
  await expect(titleEl).toHaveClass(/line-through/)
})

test('editing description then deleting the lap removes it from disk', async () => {
  const { win } = launched
  await win.locator('[data-lap-id="bbb-002"]').click()
  await win.locator('[data-testid="editor-description"]').fill('updated description')
  await win.locator('[data-testid="editor-delete"]').click()
  await expect(win.locator('[data-testid="confirm-modal"]')).toBeVisible()
  await win.locator('[data-testid="confirm-yes"]').click()

  await expect.poll(() => {
    const file = readFile(tmp.lapsFile)
    return file.tasks.find((x) => x.id === 'bbb-002')
  }, { timeout: 5000 }).toBeUndefined()
})
