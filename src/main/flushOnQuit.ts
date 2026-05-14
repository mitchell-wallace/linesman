/**
 * Pure helper for the flush-and-quit handshake. The main process intercepts
 * window close / app before-quit, asks the renderer to save pending edits,
 * and waits for an ack (or a safety timeout) before letting the quit
 * proceed. Extracted from main/index.ts so the timeout/ack semantics can be
 * unit-tested without spinning up Electron.
 */

export interface FlushDeps {
  // Tell the renderer to start flushing. Should return true if the message
  // was sent, false if the renderer is already gone (in which case we
  // resolve immediately).
  sendFlushRequest: () => boolean
  // Register a one-shot callback to be invoked when the renderer acks
  // ("quit ready"). The returned function clears the registration.
  onQuitReady: (cb: () => void) => () => void
  // Schedule a safety timeout. Returns a cancel handle.
  scheduleTimeout: (cb: () => void) => () => void
}

/**
 * Resolves when the renderer acks `laps:quit-ready`, or when the safety
 * timeout fires — whichever happens first. Never rejects.
 */
export function awaitFlush(deps: FlushDeps): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    let cancelAck: (() => void) | null = null
    let cancelTimer: (() => void) | null = null

    const settle = (): void => {
      if (settled) return
      settled = true
      cancelAck?.()
      cancelTimer?.()
      resolve()
    }

    cancelAck = deps.onQuitReady(settle)
    cancelTimer = deps.scheduleTimeout(settle)
    const sent = deps.sendFlushRequest()
    if (!sent) settle()
  })
}
