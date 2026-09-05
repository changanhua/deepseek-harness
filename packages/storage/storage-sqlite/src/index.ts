/**
 * SQLite storage backend for the storage hub: one database file hosts every
 * routed unit, document-per-row (`key TEXT` / `value TEXT` JSON). Registers
 * as backend `sqlite`; the disposer unregisters first, then closes the medium.
 * @module @deepseek-ai/dsh-storage-sqlite
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { DatabaseSync } from 'node:sqlite'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isAbsolute, resolve } from 'node:path'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type {
  KvFacet,
  KvUnit,
  KvUnitDescriptor,
  StorageBackend,
  StorageBackendGuarantee,
} from '@deepseek-ai/dsh-storage'
import { openDatabase, recordTableName, type JournalMode } from './schema.ts'
import { SqliteKvUnit } from './unit.ts'

export {
  STORAGE_SQLITE_SCHEMA_VERSION,
  type JournalMode,
  type SqliteOwnership,
  type SqliteSynchronous,
} from './schema.ts'

export type StoragePathBase = 'cwd' | 'dsh-home'

/** Cordis plugin name. */
export const name = 'storage-sqlite'
/** The backend registers on the storage hub. */
export const inject = ['storage']

/** Plugin configuration. */
export interface Config {
  /** Storage hub registration name. Existing configurations default to `sqlite`. */
  backendName?: string
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing
   * database fail the open. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) suits local disks; pick
   * a rollback-journal mode (`delete`/`truncate`/`persist`) on filesystems
   * where WAL's shared-memory files do not work (network mounts). See
   * {@link JournalMode}.
   */
  journalMode?: JournalMode
  /** Base for relative paths; the legacy behavior resolves from the process working directory. */
  pathBase?: StoragePathBase
  /** Hold the file for this connection's lifetime, or retain shared SQLite locking. */
  ownership?: 'shared' | 'exclusive'
  /** Explicit SQLite synchronous level; omission preserves SQLite's existing default. */
  synchronous?: 'normal' | 'full' | 'extra'
  /** Non-zero identity; only a newly created file or an exact stamped match opens. */
  applicationId?: number
  /** Require owner-private paths and reject unsafe aliases or writable ancestors. */
  privateDirectory?: boolean
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  backendName: z.string().pattern(UNIT_NAME_RE).default('sqlite'),
  path: z.string().required(),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  pathBase: z.union(['cwd', 'dsh-home'] as const).default('cwd'),
  ownership: z.union(['shared', 'exclusive'] as const).default('shared'),
  synchronous: z.union(['normal', 'full', 'extra'] as const),
  applicationId: z.number().step(1).min(1).max(0x7fff_ffff),
  privateDirectory: z.boolean().default(false),
})

/** Resolve a configured database path without changing legacy relative-path behavior. */
export function resolveStoragePath(
  path: string,
  pathBase: StoragePathBase,
  env: Record<string, string | undefined> = process.env,
): string {
  if (path === ':memory:' || isAbsolute(path)) return path
  return pathBase === 'dsh-home' ? resolve(resolveDshHome(undefined, env), path) : resolve(path)
}

/**
 * The SQLite {@link StorageBackend}. Owns one `DatabaseSync` connection and
 * the open-unit table; `kv.open` validates names, enforces the per-unit
 * version stamp in `units`, and ensures the unit's record tables.
 */
export class SqliteStorageBackend implements StorageBackend {
  readonly guarantees: readonly StorageBackendGuarantee[]
  /** The key-value facet; the only shape this backend serves. */
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }

  private readonly ready: Promise<DatabaseSync>
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  private readonly units = new Map<string, Promise<SqliteKvUnit>>()
  private closing: Promise<void> | undefined

  /**
   * @param config - Validated plugin configuration.
   */
  constructor(config: Config) {
    const resolved = config as Config & {
      backendName: string
      journalMode: JournalMode
      ownership: 'shared' | 'exclusive'
      pathBase: StoragePathBase
      privateDirectory: boolean
    }
    this.guarantees = Object.freeze([
      ...(resolved.ownership === 'exclusive' ? ['single-writer' as const] : []),
      ...(resolved.synchronous === 'full' || resolved.synchronous === 'extra'
        ? ['commit-sync' as const]
        : []),
      ...(resolved.privateDirectory ? ['private-root' as const] : []),
    ])
    this.ready = openDatabase(resolveStoragePath(resolved.path, resolved.pathBase), {
      journalMode: resolved.journalMode,
      ownership: resolved.ownership,
      ...resolved.synchronous === undefined ? {} : { synchronous: resolved.synchronous },
      ...resolved.applicationId === undefined ? {} : { applicationId: resolved.applicationId },
      privateDirectory: resolved.privateDirectory,
    })
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
  }

  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'sqlite storage backend is closed'))
    }
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) {
        return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
      }
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    // Reserve the name synchronously so a concurrent second open of the same
    // name rejects instead of racing past the guard during the awaits below.
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  private async materializeUnit(descriptor: KvUnitDescriptor): Promise<SqliteKvUnit> {
    const db = await this.ready
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT version FROM units WHERE name = ?').get(descriptor.name) as
        | { version: number }
        | undefined
      if (row === undefined) {
        db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run(descriptor.name, descriptor.version)
      } else if (row.version !== descriptor.version) {
        throw new StorageError(
          'version-mismatch',
          `kv unit '${descriptor.name}' is stamped version ${row.version} on the medium, incompatible with descriptor version ${descriptor.version}`,
        )
      }
      for (const table of descriptor.tables) {
        // Both segments passed UNIT_NAME_RE, so the identifier is safe in DDL.
        db.exec(`
          CREATE TABLE IF NOT EXISTS "${recordTableName(descriptor.name, table)}" (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
          ) STRICT
        `)
      }
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }
    return new SqliteKvUnit(db, descriptor, () => {
      this.units.delete(descriptor.name)
    })
  }

  /**
   * Close every open unit and release the database. Idempotent; concurrent
   * and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    let db: DatabaseSync
    try {
      db = await this.ready
    } catch {
      // The medium never opened; that failure already rejected the opener and
      // every unit call, so there is nothing left to release here.
      return
    }
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
    db.close()
  }
}

/**
 * Register the SQLite backend as `sqlite` on the storage hub. The disposer
 * unregisters the name first, then closes the backend.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 */
export function apply(ctx: Context, config: Config) {
  const backend = new SqliteStorageBackend(config)
  const backendName = (config as Config & { backendName: string }).backendName
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register(backendName, backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-sqlite.registerBackend')
  ctx.provide(storageBackendServiceKey(backendName), backend)
}
