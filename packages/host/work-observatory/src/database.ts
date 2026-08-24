/** SQLite ownership and projections for Work Observatory accounting. */

import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  ClientObservation,
  HumanIntervalKind,
  WorkInterval,
} from './types.ts'

/** Current independent on-disk layout version. Unknown versions are rejected. */
export const WORK_OBSERVATORY_SCHEMA_VERSION = 1

interface ClientStateRow {
  max_seq: number
  visible: number
  active: number
  last_seen_at: number
}

interface ClientIdRow {
  client_id: string
}

interface IntervalRow {
  start: number
  end: number
}

/** Owns the Work Observatory SQLite connection and all accounting transactions. */
export class WorkObservatoryDatabase {
  private readonly db: DatabaseSync
  private closed = false

  /**
   * Open or create one independently versioned Work Observatory database.
   * @param path - SQLite file path, or `:memory:` for an ephemeral database.
   */
  constructor(path: string) {
    this.db = openDatabase(path)
  }

  /**
   * Apply one already-validated observation atomically.
   * @param input - producer snapshot.
   * @param receivedAt - Host receive timestamp used for accounting.
   * @returns whether this sequence advanced producer state.
   */
  acceptClientObservation(input: ClientObservation, receivedAt: number): boolean {
    return this.transaction(() => {
      const current = this.db.prepare(`
        SELECT max_seq, visible, active, last_seen_at
        FROM wo_client_state
        WHERE client_id = ?
      `).get(input.clientId) as ClientStateRow | undefined

      if (current !== undefined && input.seq <= current.max_seq) return false

      if (current === undefined) {
        this.db.prepare(`
          INSERT INTO wo_client_state (
            client_id, max_seq, visible, active, last_seen_at, stale
          ) VALUES (?, ?, ?, ?, ?, 0)
        `).run(input.clientId, input.seq, Number(input.visible), Number(input.active), receivedAt)
        if (input.visible) this.openHumanInterval(input.clientId, 'visible', receivedAt)
        if (input.active) this.openHumanInterval(input.clientId, 'active', receivedAt)
        return true
      }

      const effectiveAt = Math.max(receivedAt, current.last_seen_at)
      this.transitionHumanInterval(input.clientId, 'active', current.active === 1, input.active, effectiveAt)
      this.transitionHumanInterval(input.clientId, 'visible', current.visible === 1, input.visible, effectiveAt)
      this.db.prepare(`
        UPDATE wo_client_state
        SET max_seq = ?, visible = ?, active = ?, last_seen_at = ?, stale = 0
        WHERE client_id = ?
      `).run(input.seq, Number(input.visible), Number(input.active), effectiveAt, input.clientId)
      return true
    })
  }

  /**
   * Close stale producer intervals at their own last evidence.
   * @param now - Host sweep timestamp.
   * @param staleAfterMs - evidence age at which a live producer is stale.
   * @returns number of producer states closed.
   */
  closeStaleClients(now: number, staleAfterMs: number): number {
    return this.transaction(() => {
      const stale = this.db.prepare(`
        SELECT client_id
        FROM wo_client_state
        WHERE stale = 0
          AND (visible = 1 OR active = 1)
          AND last_seen_at <= ?
      `).all(now - staleAfterMs) as unknown as ClientIdRow[]
      for (const { client_id: clientId } of stale) {
        this.closeHumanAtLastEvidence(clientId, 'active')
        this.closeHumanAtLastEvidence(clientId, 'visible')
        this.db.prepare(`
          UPDATE wo_client_state
          SET visible = 0, active = 0, stale = 1
          WHERE client_id = ?
        `).run(clientId)
      }
      return stale.length
    })
  }

  /**
   * Read Human interval candidates clipped later by the shared interval algebra.
   * Open rows end at their last Host evidence, never query time.
   * @param kind - visible or active timeline.
   * @param from - query start.
   * @param to - query end.
   * @returns ascending candidate intervals with effective ends.
   */
  queryHumanIntervals(kind: HumanIntervalKind, from: number, to: number): WorkInterval[] {
    return this.db.prepare(`
      SELECT started_at AS start, COALESCE(ended_at, last_seen_at) AS end
      FROM wo_human_interval
      WHERE kind = ?
        AND started_at < ?
        AND COALESCE(ended_at, last_seen_at) > ?
      ORDER BY started_at, id
    `).all(kind, to, from) as unknown as IntervalRow[]
  }

  /**
   * Close every historical open Agent row conservatively at its last evidence.
   * @returns number of rows closed.
   */
  reconcileOpenAgentSteps(): number {
    const result = this.db.prepare(`
      UPDATE wo_agent_step
      SET ended_at = last_seen_at
      WHERE ended_at IS NULL
    `).run()
    return Number(result.changes)
  }

  /**
   * Project one relevant canonical Session event into its durable step row.
   * @param sessionId - owning Session identity.
   * @param event - canonical event carrying Host event time.
   */
  projectAgentEvent(sessionId: string, event: SessionEvent): void {
    switch (event.type) {
      case 'step/start':
        this.db.prepare(`
          INSERT INTO wo_agent_step (
            session_id, turn, step, started_at, last_seen_at, ended_at
          ) VALUES (?, ?, ?, ?, ?, NULL)
          ON CONFLICT(session_id, turn, step) DO UPDATE SET
            started_at = excluded.started_at,
            last_seen_at = MAX(wo_agent_step.last_seen_at, excluded.last_seen_at),
            ended_at = NULL
        `).run(sessionId, event.data.turn, event.data.step, event.time, event.time)
        break
      case 'assistant/message':
      case 'tool/call':
      case 'tool/result':
        this.touchAgentStep(sessionId, event.data.turn, event.data.step, event.time)
        break
      case 'step/end': {
        const result = this.db.prepare(`
          UPDATE wo_agent_step
          SET ended_at = ?, last_seen_at = MAX(last_seen_at, ?)
          WHERE session_id = ? AND turn = ? AND step = ?
        `).run(event.time, event.time, sessionId, event.data.turn, event.data.step)
        if (Number(result.changes) !== 1) {
          throw new Error(`step/end has no matching step/start for ${sessionId}/${event.data.turn}/${event.data.step}`)
        }
        break
      }
      default:
        break
    }
  }

  /**
   * Conservatively close one disposed Session's still-open rows.
   * @param sessionId - disposed Session identity.
   * @returns number of rows closed.
   */
  closeOpenAgentStepsForSession(sessionId: string): number {
    const result = this.db.prepare(`
      UPDATE wo_agent_step
      SET ended_at = last_seen_at
      WHERE session_id = ? AND ended_at IS NULL
    `).run(sessionId)
    return Number(result.changes)
  }

  /**
   * Read Agent interval candidates; confirmed open rows extend only to Host query time.
   * @param from - query start.
   * @param to - query end.
   * @param now - Host query timestamp.
   * @returns ascending candidate intervals.
   */
  queryAgentIntervals(from: number, to: number, now: number): WorkInterval[] {
    return this.db.prepare(`
      SELECT started_at AS start, COALESCE(ended_at, ?) AS end
      FROM wo_agent_step
      WHERE started_at < ?
        AND COALESCE(ended_at, ?) > ?
      ORDER BY started_at, session_id, turn, step
    `).all(now, to, now, from) as unknown as IntervalRow[]
  }

  /** Release the SQLite handle. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private transitionHumanInterval(
    clientId: string,
    kind: HumanIntervalKind,
    previous: boolean,
    next: boolean,
    receivedAt: number,
  ): void {
    if (!previous && next) this.openHumanInterval(clientId, kind, receivedAt)
    else if (previous && !next) this.closeHumanInterval(clientId, kind, receivedAt)
    else if (previous) this.touchHumanInterval(clientId, kind, receivedAt)
  }

  private openHumanInterval(clientId: string, kind: HumanIntervalKind, receivedAt: number): void {
    this.db.prepare(`
      INSERT INTO wo_human_interval (
        client_id, kind, started_at, ended_at, last_seen_at
      ) VALUES (?, ?, ?, NULL, ?)
    `).run(clientId, kind, receivedAt, receivedAt)
  }

  private touchHumanInterval(clientId: string, kind: HumanIntervalKind, receivedAt: number): void {
    const result = this.db.prepare(`
      UPDATE wo_human_interval
      SET last_seen_at = MAX(last_seen_at, ?)
      WHERE client_id = ? AND kind = ? AND ended_at IS NULL
    `).run(receivedAt, clientId, kind)
    if (Number(result.changes) !== 1) {
      throw new Error(`client state has no matching open ${kind} interval for ${clientId}`)
    }
  }

  private closeHumanInterval(clientId: string, kind: HumanIntervalKind, receivedAt: number): void {
    const result = this.db.prepare(`
      UPDATE wo_human_interval
      SET ended_at = MAX(last_seen_at, ?), last_seen_at = MAX(last_seen_at, ?)
      WHERE client_id = ? AND kind = ? AND ended_at IS NULL
    `).run(receivedAt, receivedAt, clientId, kind)
    if (Number(result.changes) !== 1) {
      throw new Error(`client state has no matching open ${kind} interval for ${clientId}`)
    }
  }

  private closeHumanAtLastEvidence(clientId: string, kind: HumanIntervalKind): void {
    this.db.prepare(`
      UPDATE wo_human_interval
      SET ended_at = last_seen_at
      WHERE client_id = ? AND kind = ? AND ended_at IS NULL
    `).run(clientId, kind)
  }

  private touchAgentStep(sessionId: string, turn: number, step: number, time: number): void {
    this.db.prepare(`
      UPDATE wo_agent_step
      SET last_seen_at = MAX(last_seen_at, ?)
      WHERE session_id = ? AND turn = ? AND step = ?
    `).run(time, sessionId, turn, step)
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

function openDatabase(path: string): DatabaseSync {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
    try {
      const descriptor = openSync(actual, 'wx', 0o600)
      closeSync(descriptor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (onDisk !== 0 && onDisk !== WORK_OBSERVATORY_SCHEMA_VERSION) {
      throw new Error(
        `work observatory database at "${actual}" has schema version ${onDisk}, `
        + `incompatible with this build (${WORK_OBSERVATORY_SCHEMA_VERSION})`,
      )
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS wo_client_state (
        client_id TEXT PRIMARY KEY,
        max_seq INTEGER NOT NULL,
        visible INTEGER NOT NULL CHECK (visible IN (0, 1)),
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        last_seen_at INTEGER NOT NULL,
        stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
        CHECK (active = 0 OR visible = 1)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS wo_human_interval (
        id INTEGER PRIMARY KEY,
        client_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('visible', 'active')),
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_seen_at INTEGER NOT NULL,
        CHECK (last_seen_at >= started_at),
        CHECK (ended_at IS NULL OR ended_at >= started_at)
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS wo_human_open
      ON wo_human_interval(client_id, kind)
      WHERE ended_at IS NULL;

      CREATE INDEX IF NOT EXISTS wo_human_interval_range
      ON wo_human_interval(kind, started_at);

      CREATE TABLE IF NOT EXISTS wo_agent_step (
        session_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        step INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ended_at INTEGER,
        PRIMARY KEY(session_id, turn, step),
        CHECK (last_seen_at >= started_at),
        CHECK (ended_at IS NULL OR ended_at >= started_at)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS wo_agent_step_range
      ON wo_agent_step(started_at);
    `)
    if (onDisk === 0) db.exec(`PRAGMA user_version = ${WORK_OBSERVATORY_SCHEMA_VERSION}`)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
