/**
 * Sync the local SQLite truth store into the Feishu Miaoda app database.
 *
 * Reads every `movies` row and upserts it into the remote `movies` table in
 * batches of 50 through `lark-cli apps +db-execute`. The script is idempotent:
 * `ON CONFLICT (title)` updates in place, so rerunning only refreshes rows.
 *
 * Usage: node sync-to-feishu.mjs [--db <path>] [--app-id <id>] [--environment dev|online] [--dry-run]
 */

import { spawnSync } from 'node:child_process'
import { defaultDbPath, openDb } from './lib.mjs'

const DEFAULT_APP_ID = 'app_17c82usaxjd'
const BATCH_SIZE = 50

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

function pgText(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function pgInteger(value) {
  return value === null || value === undefined ? 'NULL' : String(Number(value))
}

function rowSql(row) {
  return [
    pgText(row.title),
    pgInteger(row.rank),
    pgInteger(row.year),
    pgText(row.director),
    pgText(row.prompt_status),
    pgText(row.value_status),
    pgText(row.prompt),
    pgText(row.value),
    pgText(row.reason),
    pgInteger(row.attempts),
    pgText(row.error),
    pgText(row.created_at),
    pgText(row.updated_at),
  ].join(', ')
}

function upsertSql(batch) {
  const values = batch.map(row => `(${rowSql(row)})`).join(',\n  ')
  return `
INSERT INTO movies (
  title, rank, year, director, prompt_status, value_status,
  prompt, value, reason, attempts, error, created_at, updated_at
) VALUES
  ${values}
ON CONFLICT (title) DO UPDATE SET
  rank = EXCLUDED.rank,
  year = EXCLUDED.year,
  director = EXCLUDED.director,
  prompt_status = EXCLUDED.prompt_status,
  value_status = EXCLUDED.value_status,
  prompt = EXCLUDED.prompt,
  value = EXCLUDED.value,
  reason = EXCLUDED.reason,
  attempts = EXCLUDED.attempts,
  error = EXCLUDED.error,
  updated_at = EXCLUDED.updated_at,
  _updated_at = CURRENT_TIMESTAMP
`.trim()
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const db = openDb(optionValue(args, 'db', process.env.DOU_250_DB || defaultDbPath()))
  const appId = optionValue(args, 'app-id', process.env.DOUBAN_APP_ID || DEFAULT_APP_ID)
  const environment = optionValue(args, 'environment', 'online')
  const rows = db.prepare(`
    SELECT title, rank, year, director, prompt_status, value_status,
           prompt, value, reason, attempts, error, created_at, updated_at
    FROM movies ORDER BY COALESCE(rank, 9999), title
  `).all()
  if (rows.length === 0) {
    console.error('sync-to-feishu: no local movie rows to sync')
    process.exitCode = 1
    return
  }
  const batches = []
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE))
  console.log(`sync-to-feishu: ${rows.length} rows in ${batches.length} batch(es) -> ${appId} (${environment})`)
  for (const [index, batch] of batches.entries()) {
    const sql = upsertSql(batch)
    if (dryRun) {
      console.log(`--- dry-run batch ${index + 1}/${batches.length} ---`)
      console.log(sql)
      continue
    }
    // On Windows the lark-cli shim is a .cmd wrapper, so a shell hop is
    // required; every argument is a fixed literal except the script-owned
    // app id / environment, and the SQL payload travels through stdin.
    const run = spawnSync(
      'lark-cli',
      ['apps', '+db-execute', '--app-id', appId, '--environment', environment, '--sql', '-', '--yes', '--format', 'json'],
      { input: sql, encoding: 'utf8', shell: process.platform === 'win32' },
    )
    if (run.status !== 0) {
      throw new Error(`sync-to-feishu: batch ${index + 1} failed: ${run.stderr || run.stdout || String(run.error ?? '')}`)
    }
    const result = JSON.parse(run.stdout)
    if (result?.ok !== true) {
      throw new Error(`sync-to-feishu: batch ${index + 1} failed: ${JSON.stringify(result)}`)
    }
    console.log(`sync-to-feishu: batch ${index + 1}/${batches.length} synced ${batch.length} row(s)`)
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
