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

test('CLI write right after our save is reflected promptly via reconcile (Fix 2)', async () => {
  // Validates the reconcile-after-write path end-to-end. The renderer
  // performs a save; reconcile re-reads the file from disk, detects that
  // disk no longer matches what we wrote (because a CLI writer raced in),
  // and pushes an external-change event to the renderer right away.
  //
  // Note: we don't try to win the actual sub-millisecond race here; what
  // we test is that the renderer converges to disk truth WITHOUT waiting
  // a full ~15s poll cycle. The unit tests in reconcile.test.ts cover
  // the exact "freshHash !== ourHash" detection logic.
  test.slow()
  const { win } = launched
  await expect(win.locator('[data-testid="lap-item"]')).toHaveCount(2)

  await win.locator('[data-lap-id="aaa-001"]').click()

  // Trigger a save (toggling done is the cheapest single-shot save).
  // Then immediately overwrite the file with CLI-style content. Even if
  // the CLI write lands AFTER our write+rename, the renderer's next
  // interaction will trigger a save+reconcile which will surface the
  // mismatch.
  await win.locator('[data-testid="editor-done"]').check()
  await expect.poll(() => {
    return readFile(tmp.lapsFile).tasks.find((x) => x.id === 'aaa-001')?.isDone
  }, { timeout: 5000 }).toBe(true)

  // CLI overwrites the file.
  {
    const file = readFile(tmp.lapsFile)
    const t = file.tasks.find((x) => x.id === 'aaa-001')!
    t.title = 'cli-won-the-race'
    t.updatedAt = new Date().toISOString()
    writeFile(tmp.lapsFile, file)
  }

  // Now trigger ANOTHER renderer save — reconcile will read disk, see
  // its own hash doesn't match (CLI's content is there now, not ours),
  // and push an external-change event. The renderer must reflect that
  // within a few seconds, well before the 15s watcher poll.
  await win.locator('[data-testid="editor-done"]').uncheck()

  await expect(win.locator('[data-testid="editor-title"]')).toHaveValue(
    'cli-won-the-race',
    { timeout: 8000 }
  )
})

test('queued external during save: post-save uses fresh disk truth (Fix 1)', async () => {
  // Validates Fix 1: when a watcher event is queued during a save, the
  // post-save handler re-fetches disk state instead of applying the
  // (now stale) snapshot captured at queue time. We test this by:
  //   1. Externally modifying a non-selected lap (watcher fires after
  //      ~15s poll, queued snapshot captured).
  //   2. While that event is in flight / queued, trigger our own save
  //      and overwrite disk AGAIN with newer content.
  //   3. Verify the renderer ends up showing the LATEST disk content,
  //      not the snapshot from step 1.
  //
  // Because the watcher uses a 15s interval and we can't tweak it from
  // outside, we settle for waiting one full poll cycle. The key claim
  // we exercise is "after a save with a queued event, the renderer
  // matches disk" — even if that disk has moved on twice.
  test.slow()
  const { win } = launched
  await expect(win.locator('[data-testid="lap-item"]')).toHaveCount(2)

  await win.locator('[data-lap-id="aaa-001"]').click()

  // External write #1: change bbb-002 title.
  {
    const file = readFile(tmp.lapsFile)
    const t = file.tasks.find((x) => x.id === 'bbb-002')!
    t.title = 'first external'
    t.updatedAt = new Date().toISOString()
    writeFile(tmp.lapsFile, file)
  }

  // Wait for the watcher to pick it up.
  await waitForPoll()

  // External write #2 (the "newer" content the renderer should converge to).
  {
    const file = readFile(tmp.lapsFile)
    const t = file.tasks.find((x) => x.id === 'bbb-002')!
    t.title = 'newer external'
    t.updatedAt = new Date().toISOString()
    writeFile(tmp.lapsFile, file)
  }

  // Save aaa-001 (toggling done) — this exercises the post-save fresh
  // disk fetch path. Reconcile will detect the mismatch and push the
  // newer external content immediately, AND the post-save handler in
  // the renderer will re-fetch disk truth if any external was queued.
  await win.locator('[data-testid="editor-done"]').check()

  // The renderer must show the newest bbb-002 title.
  await expect(
    win.locator('[data-lap-id="bbb-002"] [data-testid="lap-item-title"]')
  ).toHaveText('newer external', { timeout: 8000 })
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
