import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskId, canonicalQueueState } from '@deepseek-ai/dsh-task-queue'
import type { ChangeRecord, Task } from '@deepseek-ai/dsh-task-queue'
import {
  FaultedError, TaskQueueStore, decodeChangeLine, parseChangeLine, serializeChange, sha256,
} from '../src/store.ts'

function task(id: string, status: Task['status'] = 'pending', extra: Partial<Task> = {}): Task {
  return {
    id: TaskId(id),
    title: 't',
    prompt: 'p',
    executor: 'shell',
    status,
    priority: 10,
    attempt: 0,
    maxAttempts: 3,
    backoffMs: 1000,
    delayUntil: null,
    timeoutMs: 1000,
    outputDir: '/out',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastError: null,
    result: null,
    ownerSessionId: null,
    source: 'tool',
    receiptId: 'tool:auto:1',
    terminalSeq: null,
    runs: [],
    dismissed: false,
    ...extra,
  }
}

/** A minimal valid `created` change for one task. */
function createdChange(seq: number, id: string): Extract<ChangeRecord, { taskId: TaskId }> {
  return {
    seq,
    version: 1,
    op: 'created',
    taskId: TaskId(id),
    state: task(id),
    at: '2026-01-01T00:00:00.000Z',
  }
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tq-store-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('TaskQueueStore append/recover', () => {
  it('appendActive then recover replays the change and advances maxSeq', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    await store.appendActive(createdChange(2, 'tq-2'))

    const recovered = await store.recover()
    expect(recovered.nextSeq).toBe(3)
    expect(recovered.repairedTornTail).toBe(false)
    expect(recovered.folded.tasksById.get(TaskId('tq-1'))!.status).toBe('pending')
    expect(recovered.folded.tasksById.get(TaskId('tq-2'))!.status).toBe('pending')
  })

  it('a fresh store recovers to an empty fold with nextSeq 1', async () => {
    const store = new TaskQueueStore(root)
    const recovered = await store.recover()
    expect(recovered.nextSeq).toBe(1)
    expect(recovered.folded.lastSeq).toBe(0)
    expect(recovered.folded.tasksById.size).toBe(0)
  })

  it('durableMaxSeq tracks the appended high-water', async () => {
    const store = new TaskQueueStore(root)
    expect(store.durableMaxSeq).toBe(0)
    await store.appendActive(createdChange(1, 'tq-1'))
    expect(store.durableMaxSeq).toBe(1)
    await store.appendActive(createdChange(2, 'tq-2'))
    expect(store.durableMaxSeq).toBe(2)
  })
})

describe('TaskQueueStore snapshot cache', () => {
  it('replays a tail from a valid snapshot baseline', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    const folded = (await store.recover()).folded
    // Write a valid snapshot by hand (cacheSnapshot fsyncs the file on a
    // read-only handle, which fails on Windows; the recover path is the target).
    const stateDigest = sha256(canonicalQueueState(folded))
    const lastChangeDigest = createHash('sha256')
      .update(`${serializeChange(createdChange(1, 'tq-1'))}\n`).digest('hex')
    const snapshot = {
      version: 1,
      lastSeq: 1,
      lastChangeDigest,
      stateDigest,
      tasks: [...folded.tasksById.values()],
      notifications: [...folded.notificationsById.values()],
    }
    await writeFile(join(root, 'snapshot.json'), JSON.stringify(snapshot))

    // A second append forces a tail-only replay over the snapshot baseline.
    await store.appendActive(createdChange(2, 'tq-2'))
    const recovered = await store.recover()
    expect(recovered.folded.tasksById.size).toBe(2)
    expect(recovered.folded.tasksById.get(TaskId('tq-1'))).toBeDefined()
    expect(recovered.folded.tasksById.get(TaskId('tq-2'))).toBeDefined()
    expect(recovered.nextSeq).toBe(3)
  })

  it('falls back to a full fold when the snapshot stateDigest is corrupt', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    const folded = (await store.recover()).folded
    const snapshot = {
      version: 1,
      lastSeq: 1,
      lastChangeDigest: '0'.repeat(64),
      stateDigest: '0'.repeat(64), // corrupt
      tasks: [...folded.tasksById.values()],
      notifications: [...folded.notificationsById.values()],
    }
    await writeFile(join(root, 'snapshot.json'), JSON.stringify(snapshot))
    await store.appendActive(createdChange(2, 'tq-2'))
    // A corrupt snapshot is discarded and the full log is folded; the result is
    // still correct and does not raise FaultedError.
    const recovered = await store.recover()
    expect(recovered.folded.tasksById.size).toBe(2)
    expect(recovered.folded.tasksById.get(TaskId('tq-1'))).toBeDefined()
    expect(recovered.folded.tasksById.get(TaskId('tq-2'))).toBeDefined()
  })

  it('falls back to a full fold when the snapshot lastSeq exceeds the durable log', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    const folded = (await store.recover()).folded
    const snapshot = {
      version: 1,
      lastSeq: 99, // beyond durable maxSeq
      lastChangeDigest: '0'.repeat(64),
      stateDigest: sha256(canonicalQueueState(folded)),
      tasks: [...folded.tasksById.values()],
      notifications: [...folded.notificationsById.values()],
    }
    await writeFile(join(root, 'snapshot.json'), JSON.stringify(snapshot))
    const recovered = await store.recover()
    expect(recovered.nextSeq).toBe(2)
    expect(recovered.folded.tasksById.get(TaskId('tq-1'))).toBeDefined()
  })
})

describe('TaskQueueStore torn-tail repair', () => {
  it('repairs the active segments torn tail and still replays complete lines', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    // Simulate a crash mid-append: a torn (newline-less) second line.
    await writeFile(join(root, 'active.jsonl'), `${serializeChange(createdChange(1, 'tq-1'))}\n{"seq":2,"version":1,"op":"c`, 'utf8')

    const recovered = await store.recover()
    expect(recovered.repairedTornTail).toBe(true)
    expect(recovered.nextSeq).toBe(2) // only the complete first line survives
    expect(recovered.folded.tasksById.get(TaskId('tq-1'))).toBeDefined()
  })
})

describe('TaskQueueStore corruption fails closed', () => {
  it('throws FaultedError on a seq gap in the active segment', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    await writeFile(join(root, 'active.jsonl'), `${serializeChange(createdChange(1, 'tq-1'))}\n${serializeChange(createdChange(3, 'tq-3'))}\n`, 'utf8')
    await expect(store.recover()).rejects.toBeInstanceOf(FaultedError)
    await expect(store.recover()).rejects.toThrow(/seq gap/)
  })

  it('throws FaultedError on an invalid (non-JSON) change line', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    await writeFile(join(root, 'active.jsonl'), `${serializeChange(createdChange(1, 'tq-1'))}\nnot-json\n`, 'utf8')
    await expect(store.recover()).rejects.toBeInstanceOf(FaultedError)
    await expect(store.recover()).rejects.toThrow(/not valid JSON/)
  })

  it('throws FaultedError on a change line whose state.id mismatches taskId', async () => {
    const bad: ChangeRecord = { ...createdChange(1, 'tq-1'), taskId: TaskId('tq-OTHER') }
    expect(() => parseChangeLine(bad)).toThrow(FaultedError)
  })

  it('throws FaultedError on an unknown op', async () => {
    expect(() => parseChangeLine({ seq: 1, version: 1, op: 'bogus', taskId: 'tq-1', at: 'x', state: task('tq-1') }))
      .toThrow(FaultedError)
  })

  it('rejects a sealed segment with a torn final line', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    // Manually create a sealed segment with a torn tail to exercise the sealed-path check.
    const segmentsDir = join(root, 'segments')
    await mkdir(segmentsDir, { recursive: true })
    await writeFile(join(segmentsDir, '1-1.jsonl'), `${serializeChange(createdChange(1, 'tq-1'))}\ntorn`, 'utf8')
    await expect(store.recover()).rejects.toThrow(/torn final line/)
  })

  it('rejects a sealed segment filename with an invalid range', async () => {
    const store = new TaskQueueStore(root)
    await store.appendActive(createdChange(1, 'tq-1'))
    const segmentsDir = join(root, 'segments')
    await mkdir(segmentsDir, { recursive: true })
    await writeFile(join(segmentsDir, '5-3.jsonl'), '', 'utf8')
    await expect(store.recover()).rejects.toThrow(/invalid sealed segment range/)
  })
})

describe('store line codec', () => {
  it('decodeChangeLine round-trips a serializeChange payload', () => {
    const change = createdChange(1, 'tq-1')
    expect(decodeChangeLine(serializeChange(change))).toEqual(change)
  })

  it('decodeChangeLine throws FaultedError on invalid JSON', () => {
    expect(() => decodeChangeLine('{ not json')).toThrow(FaultedError)
  })
})
