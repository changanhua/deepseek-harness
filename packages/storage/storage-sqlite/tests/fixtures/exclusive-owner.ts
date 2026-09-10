import { Config, SqliteStorageBackend } from '../../src/index.ts'

const path = process.argv[2]
if (path === undefined) throw new Error('exclusive owner fixture requires a database path')

const backend = new SqliteStorageBackend(new Config({
  path,
  journalMode: 'delete',
  ownership: 'exclusive',
  synchronous: 'extra',
}))

await backend.kv.open({ name: 'owner', version: 1, tables: ['records'], hasGlobal: false })
process.stdout.write('ready\n')
setInterval(() => {}, 60_000)
