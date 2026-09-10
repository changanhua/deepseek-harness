/**
 * Schema + open-time helpers for the SQLite storage backend: the physical
 * layout version, the database open/configure sequence (permissions, pragmas,
 * version stamp/reject), and the unit metadata tables. Unit record tables are
 * created per descriptor in `unit.ts`.
 * @module @deepseek-ai/dsh-storage-sqlite/schema
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { StorageError } from '@deepseek-ai/dsh-storage'
import { preparePrivateDirectory, verifyPrivateDatabaseFile } from './private-directory.ts'

/**
 * The on-disk physical layout version, stored in `PRAGMA user_version`.
 * Orthogonal to each unit's own `version` (stamped per unit in the `units`
 * row). Bumped only on a breaking change to the table layout; any other
 * stamped version rejects — this unreleased format has no migrations.
 */
export const STORAGE_SQLITE_SCHEMA_VERSION = 1

/**
 * Journal modes the backend will run under. `wal` is the default; the
 * rollback-journal modes (`delete`/`truncate`/`persist`) exist for
 * filesystems where WAL's shared-memory files do not work (network mounts).
 * `memory`/`off` are excluded: dropping journal durability silently
 * contradicts the durability clause of the KV backend contract.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
/** Connection ownership retained for the lifetime of this backend. */
export type SqliteOwnership = 'shared' | 'exclusive'
/** Explicit SQLite commit synchronization level. */
export type SqliteSynchronous = 'normal' | 'full' | 'extra'

/** Validated policy applied before the database is exposed to consumers. */
export interface OpenDatabaseOptions {
  readonly journalMode: JournalMode
  readonly ownership: SqliteOwnership
  readonly synchronous?: SqliteSynchronous
  readonly applicationId?: number
  readonly privateDirectory: boolean
}

/* jscpd:ignore-start -- deliberately mirrors the session-persistence-sqlite /
   session-query-sqlite open sequence; this group is the third user, and the
   shared medium helper is deferred to the log-facet migration so the session
   packages stay untouched this phase (see the domain KV storage Agent Note's
   reuse audit). */
/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files retain their modes, and errors other than `EEXIST` propagate.
 * `DatabaseSync` reopens by path, so this does not protect confidentiality or
 * integrity when another principal can replace the database entry in its
 * parent directory.
 */
async function createDatabaseFile(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return false
  }
}

/**
 * Open the database and apply its schema and pragmas. Missing directories and
 * database files are created owner-only (`:memory:` skips filesystem setup).
 * A zero `user_version` is stamped with {@link STORAGE_SQLITE_SCHEMA_VERSION};
 * every other non-current version rejects rather than being migrated in place.
 * @param path - the SQLite database file to open, or `:memory:`.
 * @param options - Validated ownership, journaling, synchronization and identity policy.
 * @returns the open handle with pragmas applied and the unit metadata tables ensured.
 */
export async function openDatabase(path: string, options: OpenDatabaseOptions): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (options.ownership === 'exclusive' && options.journalMode !== 'delete') {
    throw new Error('exclusive SQLite ownership requires journalMode delete')
  }
  if (options.ownership === 'exclusive' && actual === ':memory:') {
    throw new Error('exclusive SQLite ownership requires file storage')
  }
  if (options.applicationId !== undefined && actual === ':memory:') {
    throw new Error('SQLite applicationId requires file storage')
  }
  let created = false
  if (actual !== ':memory:') {
    if (options.privateDirectory) {
      await preparePrivateDirectory(actual)
    } else {
      await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    }
    created = await createDatabaseFile(actual)
    if (options.privateDirectory) await verifyPrivateDatabaseFile(actual)
  } else if (options.privateDirectory) {
    throw new Error('private SQLite directory requires file storage')
  }
  const db = new DatabaseSync(actual, { allowExtension: false, timeout: 0 })
  try {
    configureDatabase(db, actual, options, created)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureDatabase(
  db: DatabaseSync,
  path: string,
  options: OpenDatabaseOptions,
  created: boolean,
): void {
  db.exec('PRAGMA trusted_schema = OFF')
  db.exec('PRAGMA mmap_size = 0')
  db.exec('PRAGMA foreign_keys = ON')
  if (options.synchronous !== undefined) {
    db.exec(`PRAGMA synchronous = ${options.synchronous.toUpperCase()}`)
    const expected = { normal: 1, full: 2, extra: 3 }[options.synchronous]
    const selected = integerPragma(db, 'synchronous')
    if (selected !== expected) {
      throw new Error(`storage database at "${path}" retained synchronous=${selected}, expected ${expected}`)
    }
  }
  if (options.ownership === 'exclusive') {
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    if (stringPragma(db, 'locking_mode') !== 'exclusive') {
      throw new Error(`storage database at "${path}" did not retain exclusive locking mode`)
    }
  }

  if (options.applicationId === undefined || created) {
    db.exec(`PRAGMA journal_mode = ${options.journalMode.toUpperCase()}`)
  }
  let began = false
  try {
    db.exec(options.ownership === 'exclusive' ? 'BEGIN EXCLUSIVE' : 'BEGIN IMMEDIATE')
    began = true
    const onDisk = integerPragma(db, 'user_version')
    const applicationId = integerPragma(db, 'application_id')
    const objectCount = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
    ).get() as { count: number }).count
    if (options.applicationId !== undefined) {
      if (!created && onDisk === 0) {
        throw new Error(`storage existing database has no DSH identity at "${path}"`)
      }
      if (onDisk === 0 && (applicationId !== 0 || objectCount > 0)) {
        throw new Error(`storage database at "${path}" has an unversioned schema or application identity`)
      }
      if (onDisk !== 0 && applicationId !== options.applicationId) {
        throw new Error(
          `storage database at "${path}" has application id ${applicationId}, expected ${options.applicationId}`,
        )
      }
    }
    const selectedJournal = stringPragma(db, 'journal_mode')
    const expectedJournal = path === ':memory:' ? 'memory' : options.journalMode
    if (selectedJournal !== expectedJournal) {
      throw new Error(`storage database at "${path}" has journal mode ${selectedJournal}, expected ${expectedJournal}`)
    }
    if (onDisk !== 0 && onDisk !== STORAGE_SQLITE_SCHEMA_VERSION) {
      throw new StorageError(
        'version-mismatch',
        `storage database at "${path}" has schema version ${onDisk}, incompatible with this build (${STORAGE_SQLITE_SCHEMA_VERSION})`,
      )
    }
    /* jscpd:ignore-end */
    db.exec(`
      CREATE TABLE IF NOT EXISTS units (
        name    TEXT PRIMARY KEY,
        version INTEGER NOT NULL
      ) STRICT
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS unit_globals (
        unit  TEXT PRIMARY KEY REFERENCES units(name),
        value TEXT NOT NULL
      ) STRICT
    `)
    if (onDisk === 0) {
      if (options.applicationId !== undefined) db.exec(`PRAGMA application_id = ${options.applicationId}`)
      // Stamp fresh databases LAST: the stamp asserts the layout is complete.
      db.exec(`PRAGMA user_version = ${STORAGE_SQLITE_SCHEMA_VERSION}`)
    }
    db.exec('COMMIT')
    began = false
  } catch (error) {
    if (began) {
      try { db.exec('ROLLBACK') } catch {}
    }
    throw error
  }
}

function integerPragma(db: DatabaseSync, name: string): number {
  return Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0] as number
}

function stringPragma(db: DatabaseSync, name: string): string {
  return String(Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0]).toLowerCase()
}

/**
 * Physical table name for one unit table. Both segments are validated against
 * `UNIT_NAME_RE` before reaching this, so the result is safe to interpolate
 * into DDL and prepared-statement text.
 * @param unit - Validated unit name.
 * @param table - Validated table name.
 * @returns the `u_<unit>_<table>` identifier.
 */
export function recordTableName(unit: string, table: string): string {
  return `u_${unit}_${table}`
}
