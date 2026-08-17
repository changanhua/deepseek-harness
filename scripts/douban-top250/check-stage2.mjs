/**
 * Stage-two quality gate: value/reason coverage plus a deterministic sample
 * for human review. Exits 0 only when coverage meets `--min-done-ratio`.
 */

import { defaultDbPath, openDb } from './lib.mjs'

const MIN_DONE_RATIO = 0.95
const SAMPLE_COUNT = 10

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

async function main() {
  const args = process.argv.slice(2)
  const db = openDb(optionValue(args, 'db', process.env.DOU_250_DB || defaultDbPath()))
  const minDoneRatio = Number(optionValue(args, 'min-done-ratio', String(MIN_DONE_RATIO)))
  const rows = db.prepare(`
    SELECT title, rank, year, director, value_status, value, reason, error
    FROM movies ORDER BY COALESCE(rank, 9999), title
  `).all()
  if (rows.length === 0) {
    console.error('check-stage2: no movie rows in the database; seed movies.json first')
    process.exitCode = 1
    return
  }
  const done = rows.filter(row => row.value_status === 'done' && row.value !== null && row.reason !== null)
  const ratio = done.length / rows.length
  console.log(`check-stage2: ${rows.length} movies, ${done.length} done (${(ratio * 100).toFixed(1)}%)`)
  const stride = Math.max(1, Math.floor(rows.length / SAMPLE_COUNT))
  console.log('sample for human review:')
  for (let i = 0; i < rows.length; i += stride) {
    const row = rows[i]
    console.log(`  ${row.title}${row.year !== null ? ` (${row.year})` : ''}: ${(row.value ?? '<missing>').slice(0, 120)}`)
  }
  for (const row of rows.filter(row => row.value_status !== 'done').slice(0, 10)) {
    console.log(`  pending/failed: ${row.title} — ${row.error ?? ''}`)
  }
  const pass = ratio >= minDoneRatio
  console.log(pass ? 'check-stage2: PASS' : 'check-stage2: FAIL')
  process.exitCode = pass ? 0 : 1
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
