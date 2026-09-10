import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeFileConflictError, KnowledgeFiles, contentHash } from '../src/files.ts'
import { canonicalHash } from '../src/model.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function files(): Promise<{ root: string; store: KnowledgeFiles }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-files-'))
  roots.push(root)
  const store = new KnowledgeFiles(root)
  await store.initialize('project')
  return { root, store }
}

describe('KnowledgeFiles', () => {
  it('以原始 UTF-8 内容地址保存 artifact，重复保存保持不变', async () => {
    const { root, store } = await files()
    expect(await store.workingDirectory('project')).toBe(join(root, 'projects', 'project'))
    const first = await store.putArtifact('project', '原始\r\n内容')
    const repeated = await store.putArtifact('project', '原始\r\n内容')
    expect(first).toEqual(repeated)
    expect(first.hash).toBe(contentHash('原始\r\n内容'))
    expect(await readFile(first.path, 'utf8')).toBe('原始\r\n内容')
    expect(first.path).toBe(join(root, 'projects', 'project', 'artifacts', `${first.hash}.txt`))
  })

  it('读取 artifact 时拒绝被手工损坏的内容', async () => {
    const { store } = await files()
    const artifact = await store.putArtifact('project', '可信内容')
    await writeFile(artifact.path, '被修改')
    await expect(store.readArtifact('project', artifact.hash)).rejects.toThrow(/hash|摘要|损坏/i)
  })

  it('条目冲突时保留新内容 artifact，且不覆盖手工修改的工作文件', async () => {
    const { store } = await files()
    const first = await store.writeEntry('project', 'entry', '初稿', null)
    await writeFile(first.path, '人工修改')
    const next = '模型候选'
    await expect(store.writeEntry('project', 'entry', next, first.hash)).rejects.toBeInstanceOf(KnowledgeFileConflictError)
    expect(await readFile(first.path, 'utf8')).toBe('人工修改')
    expect(await store.readArtifact('project', contentHash(next))).toBe(next)
  })

  it('条目内容已经相同则在陈旧 expectedHash 下幂等成功', async () => {
    const { store } = await files()
    const first = await store.writeEntry('project', 'entry', '内容', null)
    const again = await store.writeEntry('project', 'entry', '内容', 'f'.repeat(64))
    expect(again).toEqual(first)
  })

  it('拒绝越界 ID、Windows 保留名和受管理目录中的符号链接', async () => {
    const { root, store } = await files()
    await expect(store.initialize('../outside')).rejects.toThrow()
    await expect(store.initialize('con')).rejects.toThrow()
    const projectRoot = join(root, 'projects', 'project')
    const outside = join(root, 'outside')
    await writeFile(outside, 'outside')
    await symlink(outside, join(projectRoot, 'entries', 'linked.md'))
    await expect(store.readEntry('project', 'linked')).rejects.toThrow(/symbolic|link|符号/i)
    expect(await readFile(outside, 'utf8')).toBe('outside')
  })

  it('完整发布版本，现有相同版本幂等，不同内容拒绝且不动工作区', async () => {
    const { root, store } = await files()
    const entry = await store.writeEntry('project', 'entry', '工作稿', null)
    const release = await store.publishRelease('project', 'v1', {
      'entry-entry.md': '发布稿', 'manifest.json': '{"version":"v1"}\n', 'README.md': '# 发布\n',
    })
    expect(await readFile(join(release, 'entry-entry.md'), 'utf8')).toBe('发布稿')
    expect(await store.publishRelease('project', 'v1', {
      'entry-entry.md': '发布稿', 'manifest.json': '{"version":"v1"}\n', 'README.md': '# 发布\n',
    })).toBe(release)
    await expect(store.publishRelease('project', 'v1', {
      'entry-entry.md': '另一个发布稿', 'manifest.json': '{"version":"v1"}\n', 'README.md': '# 发布\n',
    })).rejects.toThrow(/release|发布|exist/i)
    expect(await readFile(entry.path, 'utf8')).toBe('工作稿')
    await store.selectRelease('project', 'v1')
    expect(await readFile(join(root, 'projects', 'project', 'current-release.json'), 'utf8')).toContain('v1')
  })

  it('拒绝 release 自由路径、目录替代普通文件以及不存在的当前版本', async () => {
    const { root, store } = await files()
    await expect(store.publishRelease('project', 'v2', { '../escape': 'x' })).rejects.toThrow()
    await expect(store.selectRelease('project', 'missing')).rejects.toThrow()
    const artifact = await store.putArtifact('project', 'x')
    await rm(artifact.path)
    await mkdir(artifact.path)
    await expect(store.readArtifact('project', artifact.hash)).rejects.toThrow()
    expect((await lstat(join(root, 'projects', 'project', 'artifacts'))).isDirectory()).toBe(true)
  })

  it('校验发布清单、条目哈希及发布目录篡改', async () => {
    const { store } = await files()
    const exported = {
      'entry-entry.md': '发布稿',
      'README.md': '# 发布\n', 'project.yaml': 'id: project\n', 'map.md': '# 地图\n',
      'sources.json': '[]\n', 'checks.json': '{}\n', 'review-entry.json': '{}\n',
    }
    const manifest = { schemaVersion: 1, entries: { entry: contentHash('发布稿') }, files: Object.fromEntries(
      Object.entries(exported).filter(([name]) => name !== 'manifest.json').map(([name, content]) => [name, contentHash(content)]),
    ) }
    const release = await store.exportProject('project', 'v3', { ...exported, 'manifest.json': JSON.stringify(manifest) })
    await expect(store.verifyRelease('project', 'v3', {
      manifestHash: canonicalHash(manifest), entries: manifest.entries,
    })).resolves.toMatchObject({ 'entry-entry.md': '发布稿', 'map.md': '# 地图\n' })
    await writeFile(join(release, 'entry-entry.md'), '篡改')
    await expect(store.verifyRelease('project', 'v3', {
      manifestHash: canonicalHash(manifest), entries: manifest.entries,
    })).rejects.toThrow(/hash|release|发布/i)
  })

  it('允许清空当前发布指针，并拒绝缺少或伪造的发布清单字段', async () => {
    const { root, store } = await files()
    await store.selectRelease('project', null)
    expect(await readFile(join(root, 'projects', 'project', 'current-release.json'), 'utf8')).toBe('{"version":null}\n')
    const release = await store.publishRelease('project', 'v4', { 'manifest.json': '{bad', 'README.md': '# x\n' })
    await expect(store.verifyRelease('project', 'v4', {
      manifestHash: canonicalHash({}), entries: {},
    })).rejects.toThrow(/manifest/i)
    await writeFile(join(release, 'extra.txt'), 'not declared')
    await expect(store.publishRelease('project', 'v4', { 'manifest.json': '{bad', 'README.md': '# x\n' }))
      .rejects.toThrow(/different content|release/i)
  })

  it('将检查报告写入受管理目录', async () => {
    const { root, store } = await files()
    const path = await store.writeReport('project', 'check', '# 检查\n')
    expect(path).toBe(join(root, 'projects', 'project', 'reports', 'check.md'))
    expect(await readFile(path, 'utf8')).toBe('# 检查\n')
  })

  it('拒绝非绝对根、受控根被普通文件占用、损坏 artifact 重复发布和非字符串发布内容', async () => {
    expect(() => new KnowledgeFiles('relative')).toThrow(/absolute/)
    const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-files-root-'))
    roots.push(root)
    const blocked = join(root, 'blocked')
    await writeFile(blocked, 'file')
    await expect(new KnowledgeFiles(blocked).initialize('project')).rejects.toThrow(/root|directory/i)
    const { store } = await files()
    await expect(store.readArtifact('project', 'not-a-hash')).rejects.toThrow(/hash/)
    await expect(store.writeEntry('project', 'entry', 'x', 'not-a-hash')).rejects.toThrow(/hash/)
    const artifact = await store.putArtifact('project', 'immutable')
    await writeFile(artifact.path, 'corrupt')
    await expect(store.putArtifact('project', 'immutable')).rejects.toThrow(/corrupt/i)
    await expect(store.publishRelease('project', 'v5', { 'README.md': 1 as never })).rejects.toThrow(/string/i)
  })

  it('验证发布清单时拒绝 JSON 标量、数组条目和目录中多出的未声明文件', async () => {
    const { root, store } = await files()
    await store.publishRelease('project', 'v6', { 'manifest.json': 'null', 'README.md': '# x\n' })
    await expect(store.verifyRelease('project', 'v6', { manifestHash: canonicalHash(null), entries: {} })).rejects.toThrow(/object/i)
    const arrayManifest = { entries: [], files: { 'README.md': contentHash('# x\n') } }
    await store.publishRelease('project', 'v7', { 'manifest.json': JSON.stringify(arrayManifest), 'README.md': '# x\n' })
    await expect(store.verifyRelease('project', 'v7', { manifestHash: canonicalHash(arrayManifest), entries: {} })).rejects.toThrow(/entries/i)
    const clean = { entries: {}, files: { 'README.md': contentHash('# x\n') } }
    const release = await store.publishRelease('project', 'v8', { 'manifest.json': JSON.stringify(clean), 'README.md': '# x\n' })
    await writeFile(join(release, 'extra.txt'), 'x')
    await expect(store.verifyRelease('project', 'v8', { manifestHash: canonicalHash(clean), entries: {} })).rejects.toThrow(/directory/i)
    expect(await readFile(join(root, 'projects', 'project', 'releases', 'v8', 'extra.txt'), 'utf8')).toBe('x')
  })

  it('拒绝缺失 release 与持久记录摘要不同的 manifest', async () => {
    const { store } = await files()
    await expect(store.verifyRelease('project', 'missing', { manifestHash: 'a'.repeat(64), entries: {} }))
      .rejects.toThrow(/release does not exist/)
    const manifest = { entries: {}, files: { 'README.md': contentHash('# x\n') } }
    await store.publishRelease('project', 'v9', { 'manifest.json': JSON.stringify(manifest), 'README.md': '# x\n' })
    await expect(store.verifyRelease('project', 'v9', { manifestHash: 'b'.repeat(64), entries: {} }))
      .rejects.toThrow(/manifest hash mismatch/)
  })

  it('逐层拒绝发布条目数量、条目摘要、文件声明和文件内容的不一致', async () => {
    const { store } = await files()
    const check = async (version: string, manifest: unknown, entries: Record<string, string>, message: RegExp) => {
      await store.publishRelease('project', version, { 'manifest.json': JSON.stringify(manifest), 'README.md': '# x\n' })
      await expect(store.verifyRelease('project', version, { manifestHash: canonicalHash(manifest), entries })).rejects.toThrow(message)
    }
    await check('v10', { entries: { entry: 'a'.repeat(64) }, files: {} }, {}, /entries differ/)
    await check('v11', { entries: { entry: 'a'.repeat(64) }, files: {} }, { entry: 'b'.repeat(64) }, /entry hash differs/)
    await check('v12', { entries: {}, files: [] }, {}, /files are invalid/)
    await check('v13', { entries: {}, files: { 'escape.txt': 'a'.repeat(64) } }, {}, /forbidden manifest file/)
    await check('v14', { entries: {}, files: { 'entry-other.md': 'a'.repeat(64) } }, {}, /unexpected release entry/)
    await check('v15', { entries: {}, files: { 'README.md': 1 } }, {}, /invalid release file hash/)
    await check('v16', { entries: {}, files: { 'README.md': 'a'.repeat(64) } }, {}, /content hash mismatch/)
  })

  it('拒绝缺失 artifact、报告目标目录和被替换为符号链接的受管理目录', async () => {
    const { root, store } = await files()
    await expect(store.readArtifact('project', 'a'.repeat(64))).rejects.toThrow(/required file is missing/)
    const reports = join(root, 'projects', 'project', 'reports')
    await mkdir(join(reports, 'blocked.md'))
    await expect(store.writeReport('project', 'blocked', 'x')).rejects.toThrow(/non-ordinary target/)
    const entries = join(root, 'projects', 'project', 'entries')
    const outside = join(root, 'outside-directory')
    await mkdir(outside)
    await rm(entries, { recursive: true })
    await symlink(outside, entries)
    await expect(store.readEntry('project', 'entry')).rejects.toThrow(/managed directory is unsafe/)
  })

  it('拒绝把符号链接当作既有发布版本', async () => {
    const { root, store } = await files()
    const releases = join(root, 'projects', 'project', 'releases')
    const outside = join(root, 'outside-release')
    await mkdir(outside)
    await symlink(outside, join(releases, 'v17'))
    await expect(store.publishRelease('project', 'v17', { 'README.md': '# x\n' })).rejects.toThrow(/unsafe release target/)
  })
})
