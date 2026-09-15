import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const fault = vi.hoisted(() => ({ path: '' }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, lstat: async (...args: Parameters<typeof fs.lstat>) => {
    if (String(args[0]) === fault.path) throw Object.assign(new Error('access denied'), { code: 'EACCES' })
    return fs.lstat(...args)
  } }
})
import { KnowledgeFiles } from '../src/files.ts'

const roots: string[] = []
afterEach(async () => {
  fault.path = ''
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('访问失败不是文件不存在，不得借此覆盖无法读取的工作文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-access-')); roots.push(root)
  const files = new KnowledgeFiles(root)
  const original = await files.writeEntry('game', 'entry', '用户内容', null)
  fault.path = original.path
  await expect(files.readEntry('game', 'entry')).rejects.toMatchObject({ code: 'EACCES' })
  await expect(files.writeEntry('game', 'entry', '候选内容', null)).rejects.toMatchObject({ code: 'EACCES' })
  expect(await readFile(original.path, 'utf8')).toBe('用户内容')
  fault.path = join(root, 'projects', 'game', 'releases', 'v1')
  await expect(files.publishRelease('game', 'v1', { 'README.md': '内容' })).rejects.toMatchObject({ code: 'EACCES' })
})
