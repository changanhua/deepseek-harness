/**
 * 受管理知识库的有限文件存储；文件发布保证完整写入，但不承诺断电耐久。
 * @module @changanhua/dsh-knowledge-base/files
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Stats } from 'node:fs'
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { canonicalHash, knowledgeIdSchema } from './model.ts'

const HASH = /^[a-f0-9]{64}$/u
const FILE_MODE = 0o600
const DIRECTORY_MODE = 0o700

/**
 * 计算未经规范化的 UTF-8 内容摘要。
 *
 * @param content - 要寻址的原始文本。
 * @returns 小写十六进制 SHA-256 摘要。
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** 工作文件已经变化，候选内容仍可从 artifact 路径取回。 */
export class KnowledgeFileConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeFileConflictError'
  }
}

function id(value: string, kind: string): string {
  const parsed = knowledgeIdSchema.safeParse(value)
  if (!parsed.success) throw new Error(`knowledge files: invalid ${kind} id`)
  return parsed.data
}

function hash(value: string): string {
  if (!HASH.test(value)) throw new Error('knowledge files: invalid content hash')
  return value
}

/**
 * 将每个逻辑文件映射到构造时冻结的绝对根，不接受调用方给出的路径片段。
 * 目录逐层检查，拒绝任何已存在的符号链接或 junction。
 */
export class KnowledgeFiles {
  /** 构造时校验并冻结的绝对受管理根目录。 */
  readonly root: string

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error('knowledge files: root must be absolute')
    this.root = resolve(root)
  }

  /**
   * 创建项目的受管理目录树，并拒绝符号链接或 junction。
   *
   * @param projectId - 受管理项目 ID。
   * @returns 目录树可安全使用后完成。
   */
  async initialize(projectId: string): Promise<void> {
    await this.ensureDirectory(this.root)
    await this.ensureDirectory(this.projectsDirectory())
    await this.ensureDirectory(this.projectDirectory(projectId))
    await Promise.all(['artifacts', 'entries', 'reports', 'releases'].map(name =>
      this.ensureDirectory(join(this.projectDirectory(projectId), name))))
  }

  /**
   * 为受信 Host 执行器提供已校验的项目工作目录。
   *
   * @param projectId - 受管理项目 ID。
   * @returns 项目的绝对工作目录。
   */
  async workingDirectory(projectId: string): Promise<string> {
    await this.initialize(projectId)
    return this.projectDirectory(projectId)
  }

  /**
   * 以内容摘要发布不可变产物；同摘要不同字节会失败。
   *
   * @param projectId - 受管理项目 ID。
   * @param content - 要保存的原始内容。
   * @returns 产物摘要及绝对路径。
   */
  async putArtifact(projectId: string, content: string): Promise<{ hash: string; path: string }> {
    await this.initialize(projectId)
    const digest = contentHash(content)
    const path = this.artifactPath(projectId, digest)
    const existing = await this.readOptionalRegular(path)
    if (existing !== null) {
      if (contentHash(existing) !== digest) throw new Error(`knowledge files: immutable artifact is corrupt: ${digest}`)
      return { hash: digest, path }
    }
    await this.writeSyncedImmutable(path, content)
    const published = await this.readRequiredRegular(path)
    if (contentHash(published) !== digest) throw new Error(`knowledge files: artifact publication hash mismatch: ${digest}`)
    return { hash: digest, path }
  }

  /**
   * 读取并复核不可变产物。
   *
   * @param projectId - 受管理项目 ID。
   * @param digest - 预期内容摘要。
   * @returns 已通过摘要核验的内容。
   */
  async readArtifact(projectId: string, digest: string): Promise<string> {
    await this.initialize(projectId)
    const expected = hash(digest)
    const content = await this.readRequiredRegular(this.artifactPath(projectId, expected))
    if (contentHash(content) !== expected) throw new Error(`knowledge files: artifact hash mismatch: ${expected}`)
    return content
  }

  /**
   * 读取工作条目，不存在时返回 null。
   *
   * @param projectId - 受管理项目 ID。
   * @param entryId - 条目 ID。
   * @returns 工作条目文本或 null。
   */
  async readEntry(projectId: string, entryId: string): Promise<string | null> {
    await this.initialize(projectId)
    return this.readOptionalRegular(this.entryPath(projectId, entryId))
  }

  /**
   * 以期望摘要保护工作条目写入，冲突时保留候选产物。
   *
   * @param projectId - 受管理项目 ID。
   * @param entryId - 条目 ID。
   * @param content - 候选 Markdown 内容。
   * @param expectedHash - 调用方观察到的旧摘要，或 null。
   * @returns 已保存内容的摘要及路径。
   */
  async writeEntry(
    projectId: string, entryId: string, content: string, expectedHash: string | null,
  ): Promise<{ hash: string; path: string }> {
    await this.initialize(projectId)
    if (expectedHash !== null) hash(expectedHash)
    const candidate = await this.putArtifact(projectId, content)
    const path = this.entryPath(projectId, entryId)
    const current = await this.readOptionalRegular(path)
    const nextHash = candidate.hash
    if (current !== null && contentHash(current) === nextHash) return { hash: nextHash, path }
    if ((current === null && expectedHash !== null) || (current !== null && contentHash(current) !== expectedHash)) {
      throw new KnowledgeFileConflictError(`knowledge files: entry changed; candidate artifact retained at ${candidate.path}`)
    }
    await this.writeManagedFile(path, content)
    return { hash: nextHash, path }
  }

  /**
   * 写入受管理检查报告。
   *
   * @param projectId - 受管理项目 ID。
   * @param reportId - 报告 ID。
   * @param content - 报告内容。
   * @returns 报告绝对路径。
   */
  async writeReport(projectId: string, reportId: string, content: string): Promise<string> {
    await this.initialize(projectId)
    const path = join(this.projectDirectory(projectId), 'reports', `${id(reportId, 'report')}.md`)
    await this.writeManagedFile(path, content)
    return path
  }

  /**
   * 原子发布完整版本，拒绝覆盖同名不同内容版本。
   *
   * @param projectId - 受管理项目 ID。
   * @param version - 发布版本 ID。
   * @param files - 经调用方组装的受限发布文件。
   * @returns 发布目录的绝对路径。
   */
  async publishRelease(projectId: string, version: string, files: Readonly<Record<string, string>>): Promise<string> {
    await this.initialize(projectId)
    const target = join(this.projectDirectory(projectId), 'releases', id(version, 'release'))
    this.validateReleaseFiles(files)
    if (await this.pathExists(target)) {
      if (await this.releaseMatches(target, files)) return target
      throw new Error(`knowledge files: release already exists with different content: ${version}`)
    }
    const releases = join(this.projectDirectory(projectId), 'releases')
    const temporary = await mkdtemp(join(releases, '.release-'))
    try {
      for (const [name, content] of Object.entries(files)) await this.writeManagedFile(join(temporary, name), content)
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      if (await this.pathExists(target) && await this.releaseMatches(target, files)) return target
      throw error
    }
    return target
  }

  /**
   * 导出项目派生物仍走同一份临时目录发布协议。
   *
   * @param projectId - 受管理项目 ID。
   * @param version - 导出版本 ID。
   * @param files - 受限派生文件。
   * @returns 导出目录的绝对路径。
   */
  exportProject(projectId: string, version: string, files: Readonly<Record<string, string>>): Promise<string> {
    return this.publishRelease(projectId, version, files)
  }

  /**
   * 在选择发布版本前验证磁盘上完整 release 的清单和每个条目字节。
   * 这不是签名验证；调用者提供的是已持久业务记录中的期望摘要。
   *
   * @param projectId - 受管理项目 ID。
   * @param version - 要核验的发布版本。
   * @param expected - 持久业务记录中的清单摘要和条目摘要。
   * @returns 所有发布文件与清单匹配后完成。
   */
  async verifyRelease(
    projectId: string, version: string, expected: { manifestHash: string; entries: Readonly<Record<string, string>> },
  ): Promise<void> {
    await this.initialize(projectId)
    hash(expected.manifestHash)
    const release = join(this.projectDirectory(projectId), 'releases', id(version, 'release'))
    const state = await this.statOptional(release)
    if (!state?.isDirectory() || state.isSymbolicLink()) throw new Error(`knowledge files: release does not exist: ${version}`)
    const expectedEntries = Object.entries(expected.entries).map(([entryId, digest]) => [id(entryId, 'entry'), hash(digest)] as const)
    const manifestText = await this.readRequiredRegular(join(release, 'manifest.json'))
    let manifest: unknown
    try { manifest = JSON.parse(manifestText) } catch { throw new Error('knowledge files: release manifest is invalid JSON') }
    if (canonicalHash(manifest) !== expected.manifestHash) throw new Error('knowledge files: release manifest hash mismatch')
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('knowledge files: release manifest is not an object')
    const entries = (manifest as Record<string, unknown>).entries
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('knowledge files: release manifest entries are invalid')
    const manifestEntries = Object.entries(entries as Record<string, unknown>)
    if (manifestEntries.length !== expectedEntries.length) throw new Error('knowledge files: release entries differ from expectation')
    for (const [entryId, digest] of expectedEntries) {
      if ((entries as Record<string, unknown>)[entryId] !== digest) throw new Error(`knowledge files: release entry hash differs: ${entryId}`)
      const content = await this.readRequiredRegular(join(release, `entry-${entryId}.md`))
      if (contentHash(content) !== digest) throw new Error(`knowledge files: release entry content hash mismatch: ${entryId}`)
    }
    const manifestFiles = (manifest as Record<string, unknown>).files
    if (!manifestFiles || typeof manifestFiles !== 'object' || Array.isArray(manifestFiles)) {
      throw new Error('knowledge files: release manifest files are invalid')
    }
    const declaredFiles = Object.entries(manifestFiles as Record<string, unknown>)
    for (const [name, digest] of declaredFiles) {
      if (!this.isAllowedReleaseFile(name) && !/^entry-[a-z][a-z0-9-]{0,63}\.md$/u.test(name)) {
        throw new Error(`knowledge files: forbidden manifest file: ${name}`)
      }
      if (/^entry-/u.test(name) && !expectedEntries.some(([entryId]) => name === `entry-${entryId}.md`)) {
        throw new Error(`knowledge files: unexpected release entry: ${name}`)
      }
      if (typeof digest !== 'string') throw new Error(`knowledge files: invalid release file hash: ${name}`)
      const content = await this.readRequiredRegular(join(release, name))
      if (contentHash(content) !== hash(digest)) throw new Error(`knowledge files: release file content hash mismatch: ${name}`)
    }
    const names = await readdir(release)
    const expectedNames = new Set(['manifest.json', ...declaredFiles.map(([name]) => name)])
    if (names.length !== expectedNames.size || names.some(name => !expectedNames.has(name))) {
      throw new Error('knowledge files: release directory files differ from manifest')
    }
  }

  /**
   * 将当前发布指针切换到已存在版本，或清除指针。
   *
   * @param projectId - 受管理项目 ID。
   * @param version - 已验证发布版本，或 null。
   * @returns 指针持久化后完成。
   */
  async selectRelease(projectId: string, version: string | null): Promise<void> {
    await this.initialize(projectId)
    if (version === null) {
      await this.writeManagedFile(join(this.projectDirectory(projectId), 'current-release.json'), '{"version":null}\n')
      return
    }
    const release = join(this.projectDirectory(projectId), 'releases', id(version, 'release'))
    const state = await this.statOptional(release)
    if (!state?.isDirectory() || state.isSymbolicLink()) throw new Error(`knowledge files: release does not exist: ${version}`)
    await this.writeManagedFile(join(this.projectDirectory(projectId), 'current-release.json'), `${JSON.stringify({ version })}\n`)
  }

  private projectsDirectory(): string {
    return join(this.root, 'projects')
  }

  private projectDirectory(projectId: string): string {
    return join(this.projectsDirectory(), id(projectId, 'project'))
  }

  private artifactPath(projectId: string, digest: string): string {
    return join(this.projectDirectory(projectId), 'artifacts', `${hash(digest)}.txt`)
  }

  private entryPath(projectId: string, entryId: string): string {
    return join(this.projectDirectory(projectId), 'entries', `${id(entryId, 'entry')}.md`)
  }

  private async ensureDirectory(path: string): Promise<void> {
    const tail = relative(this.root, path)
    await mkdir(this.root, { recursive: true, mode: DIRECTORY_MODE })
    const rootState = await lstat(this.root)
    if (!rootState.isDirectory() || rootState.isSymbolicLink()) throw new Error('knowledge files: root is not a real directory')
    let current = this.root
    for (const segment of tail === '' ? [] : tail.split(sep)) {
      current = join(current, segment)
      await mkdir(current, { mode: DIRECTORY_MODE }).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
      const state = await lstat(current)
      if (!state.isDirectory() || state.isSymbolicLink()) throw new Error(`knowledge files: managed directory is unsafe: ${current}`)
    }
  }

  private async readOptionalRegular(path: string): Promise<string | null> {
    const state = await this.statOptional(path)
    if (state === null) return null
    if (!state.isFile() || state.isSymbolicLink()) throw new Error(`knowledge files: expected ordinary file: ${path}`)
    return readFile(path, 'utf8')
  }

  private async readRequiredRegular(path: string): Promise<string> {
    const content = await this.readOptionalRegular(path)
    if (content === null) throw new Error(`knowledge files: required file is missing: ${path}`)
    return content
  }

  private async writeManagedFile(path: string, content: string): Promise<void> {
    const state = await this.statOptional(path)
    if (state !== null && (!state.isFile() || state.isSymbolicLink())) {
      throw new Error(`knowledge files: refusing non-ordinary target: ${path}`)
    }
    await writeFileAtomic(path, content, { mode: FILE_MODE, dirMode: DIRECTORY_MODE })
  }

  /** artifact 在 hard-link 发布前同步文件本身；目录 fsync 与断电耐久不在此契约内。 */
  private async writeSyncedImmutable(path: string, content: string): Promise<void> {
    const existing = await this.readOptionalRegular(path)
    if (existing !== null) {
      if (contentHash(existing) !== contentHash(content)) throw new Error(`knowledge files: immutable artifact is corrupt: ${path}`)
      return
    }
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(temporary, 'wx', FILE_MODE)
      await handle.writeFile(content, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      // link(2) is an exclusive publication step: unlike rename it cannot
      // replace a concurrently planted artifact at the immutable target.
      await link(temporary, path)
      await rm(temporary)
    } catch (error) {
      await handle?.close().catch(() => {})
      await rm(temporary, { force: true })
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const published = await this.readOptionalRegular(path)
        if (published !== null && contentHash(published) === contentHash(content)) return
      }
      throw error
    }
  }

  private async releaseMatches(path: string, files: Readonly<Record<string, string>>): Promise<boolean> {
    const state = await lstat(path)
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error(`knowledge files: unsafe release target: ${path}`)
    const names = await readdir(path)
    const expected = Object.keys(files).sort()
    if (names.sort().join('\0') !== expected.join('\0')) return false
    for (const name of expected) if (await this.readRequiredRegular(join(path, name)) !== files[name]) return false
    return true
  }

  private validateReleaseFiles(files: Readonly<Record<string, string>>): void {
    for (const [name, content] of Object.entries(files)) {
      if (typeof content !== 'string') throw new Error('knowledge files: release content must be a string')
      if (this.isAllowedReleaseFile(name)) continue
      const match = /^entry-([a-z][a-z0-9-]{0,63})\.md$/u.exec(name)
      if (!match) throw new Error(`knowledge files: forbidden release file: ${name}`)
      id((match as RegExpExecArray & { 1: string })[1], 'entry')
    }
  }

  private isAllowedReleaseFile(name: string): boolean {
    return name === 'manifest.json' || name === 'README.md' || name === 'project.yaml'
      || name === 'map.md' || name === 'sources.json' || name === 'checks.json'
      || /^review-[a-z][a-z0-9-]{0,63}\.json$/u.test(name)
  }

  private async pathExists(path: string): Promise<boolean> {
    return (await this.statOptional(path)) !== null
  }

  private async statOptional(path: string): Promise<Stats | null> {
    try {
      return await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return null
    }
  }
}
