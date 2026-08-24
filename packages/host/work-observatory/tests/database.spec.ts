import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WORK_OBSERVATORY_SCHEMA_VERSION,
  WorkObservatoryDatabase,
} from '../src/database.ts'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('WorkObservatoryDatabase', () => {
  it('stamps a fresh independent database and preserves rows across reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-work-observatory-'))
    tempDirectories.push(directory)
    const path = join(directory, 'observatory.sqlite')

    const first = new WorkObservatoryDatabase(path)
    first.acceptClientObservation({
      clientId: 'client-1',
      seq: 0,
      visible: true,
      active: false,
      clientObservedAt: 1,
    }, 1_000)
    first.close()

    const second = new WorkObservatoryDatabase(path)
    expect(second.queryHumanIntervals('visible', 0, 5_000)).toEqual([{ start: 1_000, end: 1_000 }])
    second.close()

    const inspection = new DatabaseSync(path)
    expect(inspection.prepare('PRAGMA user_version').get()).toEqual({
      user_version: WORK_OBSERVATORY_SCHEMA_VERSION,
    })
    inspection.close()
  })

  it('rejects an unknown schema version without rebuilding the file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-work-observatory-'))
    tempDirectories.push(directory)
    const path = join(directory, 'observatory.sqlite')
    const incompatible = new DatabaseSync(path)
    incompatible.exec(`PRAGMA user_version = ${WORK_OBSERVATORY_SCHEMA_VERSION + 1}`)
    incompatible.exec('CREATE TABLE preserved (value TEXT)')
    incompatible.close()

    expect(() => new WorkObservatoryDatabase(path)).toThrow(/schema version/i)

    const inspection = new DatabaseSync(path)
    expect(inspection.prepare("SELECT name FROM sqlite_master WHERE name = 'preserved'").get())
      .toEqual({ name: 'preserved' })
    inspection.close()
  })
})
