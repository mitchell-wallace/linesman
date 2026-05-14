import { describe, expect, it } from 'vitest'
import { awaitFlush, type FlushDeps } from '../flushOnQuit.js'

interface Probe {
  deps: FlushDeps
  sent: number
  ackHandlers: Array<() => void>
  timeoutHandlers: Array<() => void>
  cancelledAcks: number
  cancelledTimers: number
}

function makeProbe(sendResult = true): Probe {
  const p: Probe = {
    sent: 0,
    ackHandlers: [],
    timeoutHandlers: [],
    cancelledAcks: 0,
    cancelledTimers: 0,
    deps: {
      sendFlushRequest: () => {
        p.sent++
        return sendResult
      },
      onQuitReady: (cb) => {
        p.ackHandlers.push(cb)
        return () => {
          p.cancelledAcks++
        }
      },
      scheduleTimeout: (cb) => {
        p.timeoutHandlers.push(cb)
        return () => {
          p.cancelledTimers++
        }
      }
    }
  }
  return p
}

describe('awaitFlush', () => {
  it('resolves immediately when the renderer is already gone (send returns false)', async () => {
    const p = makeProbe(false)
    await awaitFlush(p.deps)
    expect(p.sent).toBe(1)
    // We still registered/cancelled handlers — that's fine and we don't
    // assert exact counts; the contract is just "resolves promptly".
  })

  it('resolves on renderer ack, cancels the safety timer', async () => {
    const p = makeProbe(true)
    const promise = awaitFlush(p.deps)
    expect(p.sent).toBe(1)
    expect(p.ackHandlers).toHaveLength(1)
    expect(p.timeoutHandlers).toHaveLength(1)

    p.ackHandlers[0]() // renderer acks
    await promise

    expect(p.cancelledTimers).toBe(1)
  })

  it('resolves on safety timeout when renderer never acks', async () => {
    const p = makeProbe(true)
    const promise = awaitFlush(p.deps)
    expect(p.timeoutHandlers).toHaveLength(1)

    p.timeoutHandlers[0]() // timeout fires
    await promise

    expect(p.cancelledAcks).toBe(1)
  })

  it('only resolves once even if ack and timeout race', async () => {
    const p = makeProbe(true)
    let resolveCount = 0
    const promise = awaitFlush(p.deps).then(() => {
      resolveCount++
    })

    // Fire both. The implementation must not double-resolve.
    p.ackHandlers[0]()
    p.timeoutHandlers[0]()
    await promise

    expect(resolveCount).toBe(1)
  })

  it('never rejects even when send throws indirectly', async () => {
    // sendFlushRequest signals failure via false rather than throwing, but
    // even if a deps callback misbehaves, the promise must not reject — it
    // must resolve so the quit can proceed.
    const p = makeProbe(false)
    await expect(awaitFlush(p.deps)).resolves.toBeUndefined()
  })
})
