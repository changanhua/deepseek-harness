import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectResources } from '../src/resources.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

const disposals: (() => Promise<void>)[] = []
const workspaceId = 'project' as WorkspaceId
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose() })

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-resources-'))
  disposals.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  disposals.push(() => ctx.fiber.dispose())
  let available = true
  const resources = new ProjectResources(async (id) => {
    if (!available) throw new Error('workspace unavailable')
    if (id !== workspaceId) throw new Error('unknown workspace')
    return root
  }, () => ctx.subprocess, { maxBytes: 262144, logBytes: 1024, graceMs: 200 })
  disposals.push(() => resources.dispose())
  return { root, resources, ctx, invalidate: () => { available = false } }
}

describe('project resources', () => {
  it('can stop an owned process after its workspace becomes unavailable', async () => {
    const { root, resources, invalidate } = await harness()
    await writeFile(join(root, 'server.cjs'), 'setInterval(() => {}, 1000)')
    const entry = await resources.add(workspaceId, { kind: 'service', name: 'server', cwd: '.', command: 'node server.cjs' })
    const running = await resources.start(workspaceId, entry.id)
    invalidate()
    await resources.stop(workspaceId, entry.id)
    expect(() => process.kill(running.pid!, 0)).toThrow()
  }, 20_000)

  it('does not silently overwrite a successful concurrent write from another instance', async () => {
    const { root, resources, ctx } = await harness()
    await mkdir(join(root, '.dsh'))
    await writeFile(join(root, 'file.txt'), 'contents')
    const other = new ProjectResources(async () => root, () => ctx.subprocess, { maxBytes: 262144, logBytes: 1024, graceMs: 200 })
    disposals.push(() => other.dispose())
    const results = await Promise.allSettled([resources, other].map((owner, index) => owner.add(workspaceId, { kind: 'file', name: `entry-${index}`, path: 'file.txt' })))
    const saved = (await resources.list(workspaceId)).entries
    expect(saved).toHaveLength(results.filter(result => result.status === 'fulfilled').length)
    for (const result of results) {
      if (result.status === 'fulfilled') expect(saved.some(entry => entry.id === result.value.id)).toBe(true)
      else expect(String(result.reason)).toContain('Resource update is busy')
    }
  })
  it('keeps Markdown and file references on disk across reopening, without deleting their files', async () => {
    const { root, resources, ctx } = await harness()
    await writeFile(join(root, 'input.txt'), 'existing input')
    const note = await resources.add(workspaceId, { kind: 'note', name: '常用方法', content: '# 方法\n先检查输入。' })
    const file = await resources.add(workspaceId, { kind: 'file', name: '输入', path: 'input.txt' })
    expect(await readFile(join(root, note.path!), 'utf8')).toBe('# 方法\n先检查输入。')
    const reopened = new ProjectResources(async () => root, () => ctx.subprocess, { maxBytes: 262144, logBytes: 1024, graceMs: 200 })
    disposals.push(() => reopened.dispose())
    expect((await reopened.list(workspaceId)).entries.map(item => item.name)).toEqual(['常用方法', '输入'])
    expect(await reopened.read(workspaceId, file.id)).toMatchObject({ text: 'existing input' })
    await reopened.remove(workspaceId, file.id)
    expect(await readFile(join(root, 'input.txt'), 'utf8')).toBe('existing input')
  })

  it('rejects out-of-project files, linked escapes, invalid URLs and malformed existing configuration', async () => {
    const { root, resources } = await harness()
    await expect(resources.add(workspaceId, { kind: 'file', name: 'escape', path: '../outside' })).rejects.toThrow()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-resources-outside-'))
    disposals.unshift(() => rm(outside, { recursive: true, force: true }))
    await symlink(outside, join(root, 'linked'), 'junction')
    await expect(resources.add(workspaceId, { kind: 'file', name: 'escape', path: 'linked' })).rejects.toThrow()
    await expect(resources.add(workspaceId, { kind: 'service', name: 'bad', cwd: '.', command: 'echo ok', url: 'javascript:alert(1)' })).rejects.toThrow()
    await mkdir(join(root, '.dsh'), { recursive: true })
    await writeFile(join(root, '.dsh/resources.json'), '{broken')
    await expect(resources.list(workspaceId)).rejects.toThrow()
    expect(await readFile(join(root, '.dsh/resources.json'), 'utf8')).toBe('{broken')
  })

  it('serializes concurrent registration without losing either entry', async () => {
    const { root, resources } = await harness()
    await writeFile(join(root, 'one.txt'), 'one')
    await Promise.all(['first', 'second'].map(name => resources.add(workspaceId, { kind: 'file', name, path: 'one.txt' })))
    expect((await resources.list(workspaceId)).entries).toHaveLength(2)
  })

  it('starts only one owned process and stops its tree while retaining configuration', async () => {
    const { root, resources } = await harness()
    await writeFile(join(root, 'server.cjs'), 'console.log("resource ready"); setInterval(() => {}, 1000)')
    const service = await resources.add(workspaceId, { kind: 'service', name: 'server', cwd: '.', command: 'node server.cjs' })
    const [first, second] = await Promise.all([resources.start(workspaceId, service.id), resources.start(workspaceId, service.id)])
    expect(first.pid).toBeGreaterThan(0)
    expect(second.pid).toBe(first.pid)
    await expect.poll(async () => (await resources.list(workspaceId)).entries[0]?.logs).toContain('resource ready')
    await expect(resources.remove(workspaceId, service.id)).rejects.toThrow(/stop/i)
    await resources.stop(workspaceId, service.id)
    expect((await resources.list(workspaceId)).entries[0]?.status).toBe('stopped')
    expect(() => process.kill(first.pid!, 0)).toThrow()
  }, 20_000)

  it('stops owned processes on disposal and refuses new work afterwards', async () => {
    const { root, resources } = await harness()
    await writeFile(join(root, 'server.cjs'), 'setInterval(() => {}, 1000)')
    const service = await resources.add(workspaceId, { kind: 'service', name: 'server', cwd: '.', command: 'node server.cjs' })
    const running = await resources.start(workspaceId, service.id)
    await resources.dispose()
    expect(() => process.kill(running.pid!, 0)).toThrow()
    await expect(resources.start(workspaceId, service.id)).rejects.toThrow(/closed/i)
  }, 20_000)
})
