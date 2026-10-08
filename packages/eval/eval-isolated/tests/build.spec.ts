import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { RuntimeImageCache, observeRuntimeTree } from '../src/build.ts'

it('shares one verified image per role, rejects reconstructed proof and detects later artifact changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-build-'))
  const cache = new RuntimeImageCache(root, { maxFiles: 10, maxBytes: 8192 })
  const signal = new AbortController().signal
  const commit = 'a'.repeat(40)
  let builds = 0
  const build = async (destination: string) => { builds++; await writeFile(join(destination, 'runtime.js'), 'actual-v1') }
  try {
    const [a, b] = await Promise.all([cache.prepare('subject', commit, build, signal), cache.prepare('subject', commit, build, signal)])
    expect(a).toBe(b)
    expect(builds).toBe(1)
    const grader = await cache.prepare('grader', commit, build, signal)
    expect(builds).toBe(2)
    expect(await cache.verify(grader, signal)).not.toBe(await cache.verify(a, signal))
    await expect(cache.verify(structuredClone(a), signal)).rejects.toThrow('proof-refused')
    await writeFile(join(await cache.verify(a, signal), 'runtime.js'), 'actual-v2')
    await expect(cache.verify(a, signal)).rejects.toThrow('identity-changed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('never retries a failed build and rejects shared file identities and complete-tree overflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-build-'))
  const cache = new RuntimeImageCache(root, { maxFiles: 10, maxBytes: 8192 })
  const signal = new AbortController().signal
  let attempts = 0
  const failed = async () => { attempts++; throw new Error('uncertain build') }
  try {
    for (let i = 0; i < 2; i++) await expect(cache.prepare('subject', 'b'.repeat(40), failed, signal)).rejects.toThrow('uncertain build')
    expect(attempts).toBe(1)
    const tree = join(root, 'tree')
    await mkdir(tree)
    await writeFile(join(tree, 'a'), '12345678')
    await expect(observeRuntimeTree(tree, { maxFiles: 2, maxBytes: 7 }, signal)).rejects.toThrow('capacity')
    await link(join(tree, 'a'), join(tree, 'b'))
    await expect(observeRuntimeTree(tree, { maxFiles: 2, maxBytes: 100 }, signal)).rejects.toThrow('file-refused')
  } finally { await rm(root, { recursive: true, force: true }) }
})
