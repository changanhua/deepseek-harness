import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { DiskUsageMonitor, inspectDiskUsage, observeDiskUsage } from '../src/disk.ts'

test('counts only contained regular files and refuses links added after Host capture without touching their target', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'eval-disk-'))
  try {
    const root = join(parent, 'world'), outside = join(parent, 'outside')
    await mkdir(root); await mkdir(outside)
    await writeFile(join(root, 'owned'), '1234')
    await writeFile(join(outside, 'keep'), 'private')
    expect(await observeDiskUsage([root], { maxBytes: 8, maxEntries: 8, sampleMs: 10 }, AbortSignal.timeout(1000)))
      .toEqual({ bytes: 4, entries: 2 })
    let fail: ((failure: string) => void) | undefined
    const observed = new Promise<string>((resolve) => { fail = (failure) => { resolve(failure) } })
    const monitor = await DiskUsageMonitor.start([root], { maxBytes: 8, maxEntries: 8, sampleMs: 10 },
      new AbortController().signal, (failure) => { fail?.(failure) })
    await symlink(outside, join(root, 'escape'), 'junction')
    const deadline = new Promise<string>((_, reject) => {
      setTimeout(() => { reject(new Error('monitor did not observe link')) }, 1000)
    })
    await expect(Promise.race([observed, deadline]))
      .resolves.toBe('eval-disk-observation-uncertain')
    monitor.stop()
    await expect(observeDiskUsage([root], { maxBytes: 8, maxEntries: 8, sampleMs: 10 }, AbortSignal.timeout(1000)))
      .rejects.toThrow('eval-disk-path-refused')
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('private')
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('rejects byte and entry growth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-disk-'))
  try {
    await writeFile(join(root, 'large'), '12345')
    await expect(observeDiskUsage([root], { maxBytes: 4, maxEntries: 8, sampleMs: 10 }, AbortSignal.timeout(1000))).rejects.toThrow('eval-disk-capacity')
    await expect(observeDiskUsage([root], { maxBytes: 8, maxEntries: 1, sampleMs: 10 }, AbortSignal.timeout(1000))).rejects.toThrow('eval-disk-entry-capacity')
    expect(await inspectDiskUsage([root], { maxBytes: 4, maxEntries: 8, sampleMs: 10 }, AbortSignal.timeout(1000))).toEqual({ status: 'limit-exceeded', usage: null })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('keeps the first root identity across samples and refuses a replacement', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'eval-disk-'))
  try {
    const root = join(parent, 'world'), original = join(parent, 'original')
    await mkdir(root); await writeFile(join(root, 'owned'), 'private')
    let fail: ((failure: string) => void) | undefined
    const observed = new Promise<string>((resolve) => { fail = (failure) => { resolve(failure) } })
    const monitor = await DiskUsageMonitor.start([root], { maxBytes: 64, maxEntries: 8, sampleMs: 10 },
      new AbortController().signal, (failure) => { fail?.(failure) })
    await rename(root, original); await mkdir(root); await writeFile(join(root, 'replacement'), 'different')
    const deadline = new Promise<string>((_, reject) => {
      setTimeout(() => { reject(new Error('monitor did not observe root replacement')) }, 1000)
    })
    await expect(Promise.race([observed, deadline])).resolves.toBe('eval-disk-observation-uncertain')
    monitor.stop()
    expect(await readFile(join(original, 'owned'), 'utf8')).toBe('private')
    expect(await readFile(join(root, 'replacement'), 'utf8')).toBe('different')
  } finally { await rm(parent, { recursive: true, force: true }) }
})
