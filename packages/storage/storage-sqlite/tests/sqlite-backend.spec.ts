import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { runKvBackendContract } from '../../storage/tests/contract.ts'
import * as StorageSqlite from '../src/index.ts'
import {
  Config,
  resolveStoragePath,
  SqliteStorageBackend,
  STORAGE_SQLITE_SCHEMA_VERSION,
} from '../src/index.ts'
import { privateDirectoryChildEnv } from '../src/private-directory.ts'

/** Mirror the loader: resolve schemastery defaults before construction. */
function backendAt(path: string, options: Omit<Config, 'path'> = {}): SqliteStorageBackend {
  return new SqliteStorageBackend(new Config({ path, ...options }))
}

const dirs: string[] = []
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }) })

async function freshDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-storage-sqlite-'))
  dirs.push(dir)
  return join(dir, 'storage.db')
}

// The contract suite's reopen() needs a surviving medium, so the harness binds
// a real file; :memory: gets its own cases below.
runKvBackendContract('sqlite', async () => {
  const path = await freshDbPath()
  return {
    backend: backendAt(path),
    reopen: async () => backendAt(path),
  }
})

const DESCRIPTOR: KvUnitDescriptor = {
  name: 'specimen',
  version: 1,
  tables: ['records'],
  hasGlobal: true,
}

const exclusiveOwnerFixture = fileURLToPath(new URL('./fixtures/exclusive-owner.ts', import.meta.url))

describe('sqlite backend specifics', () => {
  it('scrubs ambient credentials and DSH identity from the Windows ACL helper environment', () => {
    const originalDsh = process.env['DSH_REVIEW_LEAK']
    const originalSecret = process.env['P1A_REVIEW_SECRET']
    const originalSafe = process.env['P1A_SAFE_MARKER']
    process.env['DSH_REVIEW_LEAK'] = 'must-not-leak'
    process.env['P1A_REVIEW_SECRET'] = 'must-not-leak'
    process.env['P1A_SAFE_MARKER'] = 'kept'
    try {
      const env = privateDirectoryChildEnv('C:/private/content', 'directory')
      expect(env['DSH_REVIEW_LEAK']).toBeUndefined()
      expect(env['P1A_REVIEW_SECRET']).toBeUndefined()
      expect(env['P1A_SAFE_MARKER']).toBe('kept')
      expect(env['DSH_STORAGE_PRIVATE_TARGET']).toBe('C:/private/content')
      expect(env['DSH_STORAGE_PRIVATE_KIND']).toBe('directory')
    } finally {
      if (originalDsh === undefined) delete process.env['DSH_REVIEW_LEAK']
      else process.env['DSH_REVIEW_LEAK'] = originalDsh
      if (originalSecret === undefined) delete process.env['P1A_REVIEW_SECRET']
      else process.env['P1A_REVIEW_SECRET'] = originalSecret
      if (originalSafe === undefined) delete process.env['P1A_SAFE_MARKER']
      else process.env['P1A_SAFE_MARKER'] = originalSafe
    }
  })

  it('rejects application identity on an in-memory database with an accurate diagnostic', async () => {
    const backend = backendAt(':memory:', { applicationId: 0x44534843 })
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toThrow(/applicationId requires file storage/)
    await backend.close()
  })

  it('preserves legacy defaults and resolves an explicit dsh-home path base', () => {
    const config = new Config({ path: 'storage.db' })
    expect(config).toMatchObject({
      backendName: 'sqlite',
      journalMode: 'wal',
      ownership: 'shared',
      pathBase: 'cwd',
      privateDirectory: false,
    })
    expect(resolveStoragePath('storage.db', 'cwd', {})).toBe(resolve('storage.db'))
    expect(resolveStoragePath('content/main/content.sqlite', 'dsh-home', { DSH_HOME: 'D:/dsh-test-home' }))
      .toBe(resolve('D:/dsh-test-home/content/main/content.sqlite'))
    expect(() => new Config({ path: ':memory:', backendName: 'bad.name' })).toThrow(/backendName/)
  })

  it('sets and validates an explicit application id without claiming a foreign database', async () => {
    const path = await freshDbPath()
    const applicationId = 0x44534843
    const backend = backendAt(path, { applicationId, journalMode: 'delete' })
    await backend.kv.open(DESCRIPTOR)
    await backend.close()
    const verified = new DatabaseSync(path)
    expect((verified.prepare('PRAGMA application_id').get() as { application_id: number }).application_id)
      .toBe(applicationId)
    verified.close()

    const foreignPath = await freshDbPath()
    const foreign = new DatabaseSync(foreignPath)
    foreign.exec('PRAGMA journal_mode = WAL; CREATE TABLE foreign_data (value TEXT)')
    foreign.close()
    const rejected = backendAt(foreignPath, { applicationId, journalMode: 'delete' })
    await expect(rejected.kv.open(DESCRIPTOR)).rejects.toThrow(/DSH identity|application identity|unversioned schema/)
    await rejected.close()
    const untouched = new DatabaseSync(foreignPath)
    expect((untouched.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
    expect(untouched.prepare("SELECT name FROM sqlite_master WHERE name = 'units'").get()).toBeUndefined()
    untouched.close()

    const externallyCreatedPath = await freshDbPath()
    new DatabaseSync(externallyCreatedPath).close()
    const externalEmpty = backendAt(externallyCreatedPath, { applicationId, journalMode: 'delete' })
    await expect(externalEmpty.kv.open(DESCRIPTOR)).rejects.toThrow(/existing database has no DSH identity/)
    await externalEmpty.close()
    const stillEmpty = new DatabaseSync(externallyCreatedPath)
    expect((stillEmpty.prepare('PRAGMA application_id').get() as { application_id: number }).application_id).toBe(0)
    expect((stillEmpty.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0)
    expect(stillEmpty.prepare("SELECT name FROM sqlite_master WHERE name = 'units'").get()).toBeUndefined()
    stillEmpty.close()
  })

  it('holds an exclusive connection lock until close and advertises only configured guarantees', async () => {
    const path = await freshDbPath()
    const first = backendAt(path, {
      journalMode: 'delete',
      ownership: 'exclusive',
      synchronous: 'extra',
    })
    expect(first.guarantees).toEqual(['single-writer', 'commit-sync'])
    await first.kv.open(DESCRIPTOR)

    const second = backendAt(path, {
      journalMode: 'delete',
      ownership: 'exclusive',
      synchronous: 'extra',
    })
    await expect(second.kv.open(DESCRIPTOR)).rejects.toMatchObject({ errcode: 5 })
    await second.close()
    await first.close()

    const reopened = backendAt(path, {
      journalMode: 'delete',
      ownership: 'exclusive',
      synchronous: 'extra',
    })
    await expect(reopened.kv.open(DESCRIPTOR)).resolves.toBeDefined()
    await reopened.close()
  })

  it('holds the exclusive lock across processes and releases it when the owner exits', async () => {
    const path = await freshDbPath()
    const owner = spawn(process.execPath, [
      '--import', 'tsx', exclusiveOwnerFixture, path,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let childError = ''
    owner.stderr?.on('data', (chunk) => {
      childError += String(chunk)
    })
    try {
      const ready = await new Promise<Buffer>((resolve, reject) => {
        owner.stdout.once('data', (chunk: Buffer) => { resolve(chunk) })
        owner.once('exit', (code) => {
          reject(new Error(`exclusive owner fixture exited ${String(code)} before ready: ${childError}`))
        })
      })
      expect(String(ready)).toBe('ready\n')
      const competing = backendAt(path, {
        journalMode: 'delete',
        ownership: 'exclusive',
        synchronous: 'extra',
      })
      await expect(competing.kv.open(DESCRIPTOR)).rejects.toMatchObject({ errcode: 5 })
      await competing.close()
      owner.kill()
      await once(owner, 'exit')

      const successor = backendAt(path, {
        journalMode: 'delete',
        ownership: 'exclusive',
        synchronous: 'extra',
      })
      await expect(successor.kv.open(DESCRIPTOR)).resolves.toBeDefined()
      await successor.close()
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) {
        owner.kill()
        await once(owner, 'exit')
      }
    }
  }, 15_000)

  it('rejects exclusive ownership with a non-delete journal or without file storage', async () => {
    const wal = backendAt(await freshDbPath(), { ownership: 'exclusive', journalMode: 'wal' })
    await expect(wal.kv.open(DESCRIPTOR)).rejects.toThrow(/exclusive.*delete/i)
    await wal.close()
    const memory = backendAt(':memory:', { ownership: 'exclusive', journalMode: 'delete' })
    await expect(memory.kv.open(DESCRIPTOR)).rejects.toThrow(/exclusive.*file/i)
    await memory.close()
  })

  it.runIf(process.platform === 'win32')('creates and verifies a protected NTFS directory before private storage opens', async () => {
    // The ambient TEMP grants Modify to the repository's sandbox test SID on
    // this machine; a private-root test must start under the caller's home.
    const root = await mkdtemp(join(homedir(), 'dsh-storage-private-parent-'))
    dirs.push(root)
    const path = join(root, 'content', 'main', 'content.sqlite')
    const backend = backendAt(path, {
      journalMode: 'delete',
      ownership: 'exclusive',
      synchronous: 'extra',
      applicationId: 0x44534843,
      privateDirectory: true,
    })
    expect(backend.guarantees).toEqual(['single-writer', 'commit-sync', 'private-root'])
    await backend.kv.open(DESCRIPTOR)
    await backend.close()

    const currentSid = execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    ], { encoding: 'utf8', windowsHide: true }).trim()
    for (const directory of [join(root, 'content'), join(root, 'content', 'main')]) {
      const raw = execFileSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        '& { param([string]$Target) $info=New-Object System.IO.DirectoryInfo($Target); $acl=$info.GetAccessControl(); [pscustomobject]@{ Protected=$acl.AreAccessRulesProtected; Sids=@($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique) } | ConvertTo-Json -Compress }',
        directory,
      ], { encoding: 'utf8', windowsHide: true })
      const acl = JSON.parse(raw) as { Protected: boolean; Sids: string[] }
      expect(acl.Protected).toBe(true)
      expect(acl.Sids.every(sid => ['S-1-5-18', 'S-1-5-32-544', currentSid].includes(sid))).toBe(true)
    }
  })

  it.runIf(process.platform === 'win32')('rejects an existing directory whose ACL is not protected', async () => {
    const root = await mkdtemp(join(homedir(), 'dsh-storage-private-existing-'))
    dirs.push(root)
    const directory = join(root, 'content', 'main')
    await mkdir(directory, { recursive: true })
    const path = join(directory, 'content.sqlite')
    const backend = backendAt(path, { privateDirectory: true })
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toThrow(/ACL is not protected/)
    await backend.close()
  })

  it.runIf(process.platform !== 'win32')('rejects symbolic-link databases and non-sticky writable ancestors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-storage-private-posix-'))
    dirs.push(root)
    const directory = join(root, 'private')
    await mkdir(directory, { mode: 0o700 })
    const target = join(root, 'target.db')
    await writeFile(target, '', { mode: 0o600 })
    const linked = join(directory, 'linked.db')
    await symlink(target, linked)
    const linkBackend = backendAt(linked, { privateDirectory: true })
    await expect(linkBackend.kv.open(DESCRIPTOR)).rejects.toThrow(/regular file|symbolic link/)
    await linkBackend.close()

    const unsafe = join(root, 'unsafe')
    await mkdir(unsafe, { mode: 0o777 })
    await chmod(unsafe, 0o777)
    const ancestorBackend = backendAt(join(unsafe, 'private', 'content.db'), { privateDirectory: true })
    await expect(ancestorBackend.kv.open(DESCRIPTOR)).rejects.toThrow(/writable ancestor/)
    await ancestorBackend.close()

    const outside = join(root, 'outside')
    await mkdir(outside, { mode: 0o700 })
    const linkedParent = join(root, 'linked-parent')
    await symlink(outside, linkedParent, 'dir')
    const intermediateLink = backendAt(join(linkedParent, 'must-not-exist', 'content.db'), {
      privateDirectory: true,
    })
    await expect(intermediateLink.kv.open(DESCRIPTOR)).rejects.toThrow(/symbolic-link|non-directory ancestor/)
    await intermediateLink.close()
    await expect(lstat(join(outside, 'must-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('opens an in-memory database', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })
    expect((await unit.loadAll()).tables['records']).toEqual({ k: { n: 1 } })
    await backend.close()
  })

  it('materializes STRICT record tables and stamps the schema version', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })
    await backend.close()

    const db = new DatabaseSync(path)
    try {
      const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version).toBe(STORAGE_SQLITE_SCHEMA_VERSION)
      const table = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'u_specimen_records'",
      ).get() as { sql: string } | undefined
      expect(table?.sql).toContain('STRICT')
      const unitRow = db.prepare('SELECT version FROM units WHERE name = ?').get('specimen') as { version: number }
      expect(unitRow.version).toBe(DESCRIPTOR.version)
    } finally {
      db.close()
    }
  })

  it('rejects a mismatched database schema version', async () => {
    const path = await freshDbPath()
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 999')
    db.close()

    const backend = backendAt(path)
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'version-mismatch',
    })
    await backend.close()
  })

  it('rejects invalid unit and table names before touching the medium', async () => {
    const backend = backendAt(':memory:')
    await expect(backend.kv.open({ ...DESCRIPTOR, name: 'Bad-Name' })).rejects.toThrow(/violates/)
    await expect(backend.kv.open({ ...DESCRIPTOR, tables: ['ok', '1bad'] })).rejects.toThrow(/violates/)
    await backend.close()
  })

  it('rejects a second open of the same unit name', async () => {
    const backend = backendAt(':memory:')
    await backend.kv.open(DESCRIPTOR)
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toThrow(/already open/)
    await backend.close()
  })

  it('allows re-open after unit close, and rejects open on a closed backend', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.close()
    const again = await backend.kv.open(DESCRIPTOR)
    await again.putRecord('records', 'k', 1)
    await backend.close()
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'closed' })
  })

  it('round-trips prototype-polluting keys as own properties', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', '__proto__', { evil: true })
    await unit.putRecord('records', 'constructor', { n: 1 })
    const { tables } = await unit.loadAll()
    const records = tables['records']!
    expect(Object.hasOwn(records, '__proto__')).toBe(true)
    expect(records['__proto__']).toEqual({ evil: true })
    expect(records['constructor']).toEqual({ n: 1 })
    expect(Object.getPrototypeOf({})).not.toHaveProperty('evil')
    await backend.close()
  })

  it('leaves a failed materialization unstamped so a repaired medium reopens', async () => {
    const path = await freshDbPath()
    // Obstruct table creation: an index squatting on the unit_globals name
    // makes CREATE TABLE IF NOT EXISTS throw AFTER the units table exists.
    const setup = new DatabaseSync(path)
    setup.exec('CREATE TABLE squatter (x TEXT)')
    setup.exec('CREATE INDEX unit_globals ON squatter(x)')
    setup.close()

    const broken = backendAt(path)
    await expect(broken.kv.open(DESCRIPTOR)).rejects.toThrow(/already an index/)
    await broken.close()

    // Clear the obstruction; the medium must still be version 0, not a
    // half-materialized database stamped as current.
    const repair = new DatabaseSync(path)
    expect((repair.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0)
    repair.exec('DROP INDEX unit_globals')
    repair.close()

    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })
    await backend.close()
  })

  it('rejects unparsable stored JSON with malformed-medium', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'good', { n: 1 })
    await unit.setGlobal({ g: 1 })
    await backend.close()

    const db = new DatabaseSync(path)
    db.prepare('UPDATE u_specimen_records SET value = ? WHERE key = ?').run('{not json', 'good')
    db.close()

    const reopened = backendAt(path)
    const damaged = await reopened.kv.open(DESCRIPTOR)
    await expect(damaged.loadAll()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await reopened.close()
  })

  it('wraps a non-Error toJSON throw into an Error rejection', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open(DESCRIPTOR)
    // JSON.stringify propagates a value's own toJSON throw verbatim; the unit
    // must still reject with an Error instance.
    const hostile = { toJSON: () => { throw 'not an error' } }
    await expect(unit.putRecord('records', 'k', hostile)).rejects.toThrow('not an error')
    await expect(unit.putRecord('records', 'k', hostile)).rejects.toBeInstanceOf(Error)
    await backend.close()
  })

  it('rejects setGlobal on a unit without a global slot and writes to undeclared tables', async () => {
    const backend = backendAt(':memory:')
    const unit = await backend.kv.open({ ...DESCRIPTOR, hasGlobal: false })
    await expect(unit.setGlobal({ g: 1 })).rejects.toThrow(/declared no global slot/)
    await expect(unit.putRecord('undeclared', 'k', 1)).rejects.toThrow(/declared no table/)
    expect((await unit.loadAll()).global).toBeNull()
    await backend.close()
  })

  it('drains a still-pending failed open during close', async () => {
    const path = await freshDbPath()
    const first = backendAt(path)
    await (await first.kv.open(DESCRIPTOR)).close()
    await first.close()

    const backend = backendAt(path)
    // Do not await: close() must tolerate an in-flight open that will reject
    // (version mismatch) while its name is still reserved in the unit table.
    const pending = backend.kv.open({ ...DESCRIPTOR, version: 99 })
    const closed = backend.close()
    await expect(pending).rejects.toMatchObject({ code: 'version-mismatch' })
    await closed
  })

  it('propagates filesystem errors other than an existing database file', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'dsh-storage-sqlite-'))
    dirs.push(dir)
    await chmod(dir, 0o500)
    const backend = backendAt(join(dir, 'storage.db'))
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'EACCES' })
    await backend.close()
    await chmod(dir, 0o700)
  })

  it('propagates an invalid database filename before opening SQLite', async () => {
    const path = await freshDbPath()
    const backend = backendAt(`${path}\0invalid`)
    await expect(backend.kv.open(DESCRIPTOR)).rejects.toThrow(/null bytes/i)
    await backend.close()
  })

  it('preserves the mode of an existing database file', async () => {
    if (process.platform === 'win32') return
    const path = await freshDbPath()
    await writeFile(path, '', { mode: 0o644 })
    await chmod(path, 0o644)
    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', 1)
    await backend.close()
  })

  it('registers on the storage hub as backend sqlite and closes on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const fiber = await ctx.plugin(StorageSqlite, { path: ':memory:' })
    const backend = ctx.storage.backend.get('sqlite')
    expect(ctx.get(storageBackendServiceKey('sqlite'))).toBe(backend)
    const unit = await backend.kv!.open(DESCRIPTOR)
    await unit.putRecord('records', 'k', { n: 1 })

    await fiber.dispose()
    expect(ctx.storage.backend.names()).toEqual([])
    expect(ctx.get(storageBackendServiceKey('sqlite'))).toBeUndefined()
    await expect(backend.kv!.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'closed' })
  })

  it('registers and provides a configured backend name', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const fiber = await ctx.plugin(StorageSqlite, { path: ':memory:', backendName: 'content_sqlite' })
    const backend = ctx.storage.backend.get('content_sqlite')
    expect(ctx.get(storageBackendServiceKey('content_sqlite'))).toBe(backend)
    expect(ctx.storage.backend.names()).toEqual(['content_sqlite'])
    await fiber.dispose()
  })

  it('mounts independent named instances in one composition', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const shared = await ctx.plugin(StorageSqlite, { path: ':memory:', backendName: 'shared_sqlite' })
    const strictPath = await freshDbPath()
    const strict = await ctx.plugin(StorageSqlite, {
      path: strictPath,
      backendName: 'content_sqlite',
      journalMode: 'delete',
      ownership: 'exclusive',
      synchronous: 'extra',
    })
    expect(ctx.storage.backend.names().sort()).toEqual(['content_sqlite', 'shared_sqlite'])
    await ctx.storage.backend.get('content_sqlite').kv!.open(DESCRIPTOR)
    await ctx.storage.backend.get('shared_sqlite').kv!.open(DESCRIPTOR)
    await strict.dispose()
    expect(ctx.storage.backend.names()).toEqual(['shared_sqlite'])
    await shared.dispose()
  })

  it('rejects an unparsable global slot with malformed-medium', async () => {
    const path = await freshDbPath()
    const backend = backendAt(path)
    const unit = await backend.kv.open(DESCRIPTOR)
    await unit.setGlobal({ g: 1 })
    await backend.close()

    const db = new DatabaseSync(path)
    db.prepare('UPDATE unit_globals SET value = ? WHERE unit = ?').run('][', 'specimen')
    db.close()

    const reopened = backendAt(path)
    const damaged = await reopened.kv.open(DESCRIPTOR)
    await expect(damaged.loadAll()).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-medium',
    })
    await reopened.close()
  })
})
