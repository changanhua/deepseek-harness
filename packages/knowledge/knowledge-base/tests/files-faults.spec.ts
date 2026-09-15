import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({
  link: null as null | ((source: string, target: string) => Promise<void>),
  rename: null as null | ((source: string, target: string) => Promise<void>),
  open: null as null | ((path: string, flags: string, mode?: number) => Promise<never>),
  mkdir: null as null | ((path: string) => Promise<void>),
  lstat: null as null | ((path: string) => Promise<never>),
  actualLink: null as null | ((source: string, target: string) => Promise<void>),
  actualRename: null as null | ((source: string, target: string) => Promise<void>),
  actualMkdir: null as null | ((path: string, options?: unknown) => Promise<unknown>),
  actualLstat: null as null | ((path: string) => Promise<unknown>),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  faults.actualLink = actual.link
  faults.actualRename = actual.rename
  faults.actualMkdir = actual.mkdir as never
  faults.actualLstat = actual.lstat
  return {
    ...actual,
    link: (source: string, target: string) => faults.link ? faults.link(source, target) : actual.link(source, target),
    rename: (source: string, target: string) => faults.rename ? faults.rename(source, target) : actual.rename(source, target),
    open: (path: string, flags: string, mode?: number) => faults.open ? faults.open(path, flags, mode) : actual.open(path, flags, mode),
    mkdir: (path: string, options?: unknown) => faults.mkdir ? faults.mkdir(path) : actual.mkdir(path, options as never),
    lstat: (path: string) => faults.lstat ? faults.lstat(path) : actual.lstat(path),
  }
})

import { KnowledgeFiles, contentHash } from '../src/files.ts'

const roots: string[] = []
afterEach(async () => {
  faults.link = null
  faults.rename = null
  faults.open = null
  faults.mkdir = null
  faults.lstat = null
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function files() {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-files-fault-'))
  roots.push(root)
  const store = new KnowledgeFiles(root)
  await store.initialize('project')
  return { root, store }
}

describe('KnowledgeFiles 文件系统故障恢复', () => {
  it('硬链接报告 EEXIST 时读取同内容竞争者并保持 artifact 幂等', async () => {
    const { store } = await files()
    faults.link = async (temporary, target) => {
      await faults.actualLink!(temporary, target)
      throw Object.assign(new Error('simulated concurrent publish'), { code: 'EEXIST' })
    }
    const artifact = await store.putArtifact('project', '竞争内容')
    expect(artifact.hash).toBe(contentHash('竞争内容'))
    expect(await store.readArtifact('project', artifact.hash)).toBe('竞争内容')
  })

  it('硬链接竞争者内容不匹配时拒绝伪造 artifact', async () => {
    const { store } = await files()
    faults.link = async (_temporary, target) => {
      const fs = await import('node:fs/promises')
      await fs.writeFile(target, '伪造内容')
      throw Object.assign(new Error('simulated corrupt competitor'), { code: 'EEXIST' })
    }
    await expect(store.putArtifact('project', '原始内容')).rejects.toThrow(/corrupt competitor/)
  })

  it('链接完成后文件被篡改时拒绝不完整的 artifact 发布', async () => {
    const { store } = await files()
    faults.link = async (temporary, target) => {
      await faults.actualLink!(temporary, target)
      const fs = await import('node:fs/promises')
      await fs.writeFile(target, '发布后篡改')
    }
    await expect(store.putArtifact('project', '应校验摘要')).rejects.toThrow(/publication hash mismatch/)
  })

  it('创建 artifact 临时文件失败时不遗留候选文件', async () => {
    const { root, store } = await files()
    faults.open = async (path) => {
      if (path.includes('artifacts') && path.endsWith('.tmp')) throw new Error('simulated open failure')
      throw new Error('unexpected open path: ' + path)
    }
    await expect(store.putArtifact('project', '不能写入')).rejects.toThrow(/simulated open failure/)
    const artifacts = await readdir(join(root, 'projects', 'project', 'artifacts'))
    expect(artifacts).toEqual([])
  })

  it('重命名在目标已完整发布后失败时返回同一 release，并清理临时目录', async () => {
    const { root, store } = await files()
    const releaseFiles = { 'README.md': '# 发布\n', 'manifest.json': '{}\n' }
    faults.rename = async (temporary, target) => {
      if (!target.endsWith('releases\\v1')) return faults.actualRename!(temporary, target)
      await faults.actualRename!(temporary, target)
      throw new Error('simulated post-rename error')
    }
    const release = await store.publishRelease('project', 'v1', releaseFiles)
    expect(release).toBe(join(root, 'projects', 'project', 'releases', 'v1'))
    expect((await readdir(join(root, 'projects', 'project', 'releases'))).some(name => name.startsWith('.release-'))).toBe(false)
  })

  it('重命名在目标尚未发布时失败，清理临时目录并向调用者报告 IO 错误', async () => {
    const { root, store } = await files()
    faults.rename = async (temporary, target) => {
      if (target.endsWith('releases\\v2')) throw new Error('simulated rename failure')
      return faults.actualRename!(temporary, target)
    }
    await expect(store.publishRelease('project', 'v2', { 'README.md': '# 发布\n' })).rejects.toThrow(/rename failure/)
    const releases = await readdir(join(root, 'projects', 'project', 'releases'))
    expect(releases).toEqual([])
  })

  it('检测被替换的根目录，并把子目录非 EEXIST 的创建错误传回调用者', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knowledge-files-root-fault-'))
    roots.push(root)
    const unsafeRoot = join(root, 'unsafe-root')
    const fs = await import('node:fs/promises')
    await fs.writeFile(unsafeRoot, 'ordinary file')
    const unsafe = new KnowledgeFiles(unsafeRoot)
    faults.mkdir = async (path) => {
      if (path === unsafeRoot) return
      return faults.actualMkdir!(path, { recursive: true }) as Promise<void>
    }
    await expect(unsafe.initialize('project')).rejects.toThrow(/root is not a real directory/)
    faults.mkdir = async (path) => {
      if (path.endsWith('\\projects')) throw new Error('simulated mkdir failure')
      return faults.actualMkdir!(path, { recursive: true }) as Promise<void>
    }
    const clean = new KnowledgeFiles(join(root, 'clean-root'))
    await expect(clean.initialize('project')).rejects.toThrow(/simulated mkdir failure/)
  })

  it('外层检查与不可变写入之间出现同内容 artifact 时仍幂等，异内容则拒绝', async () => {
    const run = async (content: string, planted: string) => {
      const { store } = await files()
      const target = join((await store.workingDirectory('project')), 'artifacts', `${contentHash(content)}.txt`)
      let first = true
      faults.lstat = async (path) => {
        if (path === target && first) {
          first = false
          const fs = await import('node:fs/promises')
          await fs.writeFile(target, planted)
          throw Object.assign(new Error('simulated missing before competitor publish'), { code: 'ENOENT' })
        }
        return faults.actualLstat!(path) as Promise<never>
      }
      return store.putArtifact('project', content)
    }
    await expect(run('同内容', '同内容')).resolves.toMatchObject({ hash: contentHash('同内容') })
    await expect(run('目标内容', '不同内容')).rejects.toThrow(/immutable artifact is corrupt/)
  })

  it('临时文件句柄写入和关闭都失败时保留原始写入错误并清理候选', async () => {
    const { root, store } = await files()
    faults.open = async (path) => {
      if (path.endsWith('.tmp')) return {
        writeFile: async () => { throw new Error('simulated write failure') },
        sync: async () => {},
        close: async () => { throw new Error('simulated close failure') },
      } as never
      throw new Error('unexpected open path: ' + path)
    }
    await expect(store.putArtifact('project', '句柄失败')).rejects.toThrow(/simulated write failure/)
    expect(await readdir(join(root, 'projects', 'project', 'artifacts'))).toEqual([])
  })
})
