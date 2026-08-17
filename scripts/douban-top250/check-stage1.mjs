/**
 * Stage-one quality gate: prompt coverage and near-duplicate detection.
 *
 * Prints a deterministic report and exits 0 only when the completion ratio
 * meets `--min-done-ratio` and no prompt repeats more than `--max-duplicates`
 * times. The gate never edits the database; rerun failed movies instead.
 */

import { defaultDbPath, openDb } from './lib.mjs'

const MIN_DONE_RATIO = 0.95
const MAX_DUPLICATES = 2

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

async function main() {
  const args = process.argv.slice(2)
  const dbPath = optionValue(args, 'db', process.env.DOU_250_DB || defaultDbPath())
  const minDoneRatio = Number(optionValue(args, 'min-done-ratio', String(MIN_DONE_RATIO)))
  const maxDuplicates = Number(optionValue(args, 'max-duplicates', String(MAX_DUPLICATES)))
  const db = openDb(dbPath)
  const rows = db.prepare('SELECT title, prompt_status, prompt FROM movies ORDER BY COALESCE(rank, 9999), title').all()
  if (rows.length === 0) {
    console.error('check-stage1: no movie rows in the database; seed movies.json first')
    process.exitCode = 1
    return
  }
  const done = rows.filter(row => row.prompt_status === 'done' && typeof row.prompt === 'string' && row.prompt !== '')
  const counts = new Map()
  for (const row of done) counts.set(row.prompt, (counts.get(row.prompt) ?? 0) + 1)
  const repeated = [...counts.entries()].filter(([, count]) => count > maxDuplicates)
  const ratio = done.length / rows.length
  console.log(`check-stage1: ${rows.length} movies, ${done.length} done (${(ratio * 100).toFixed(1)}%), ${repeated.length} over-duplicated prompt groups`)
  for (const [prompt, count] of repeated.slice(0, 5)) {
    console.log(`  duplicated x${count}: ${prompt.slice(0, 120)}`)
  }
  for (const row of rows.filter(row => row.prompt_status !== 'done').slice(0, 10)) {
    console.log(`  pending/failed: ${row.title}`)
  }
  const pass = ratio >= minDoneRatio && repeated.length === 0
  console.log(pass ? 'check-stage1: PASS' : 'check-stage1: FAIL')
  process.exitCode = pass ? 0 : 1
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
