/**
 * Deterministic acceptance view over the durable database.
 * Usage: node run-report.mjs [--db <path>]
 */

import { defaultDbPath, openDb } from './lib.mjs'

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

const db = openDb(optionValue(process.argv.slice(2), 'db', process.env.DOU_250_DB || defaultDbPath()))
const rows = db.prepare(`
  SELECT rank, title, year, director, prompt_status, value_status, attempts, value, reason, error
  FROM movies ORDER BY COALESCE(rank, 9999), title
`).all()
console.log(`rank\ttitle\tyear\tdirector\tprompt\tvalue\tattempts`)
for (const row of rows) {
  console.log(`${row.rank ?? ''}\t${row.title}\t${row.year ?? ''}\t${row.director ?? ''}\t${row.prompt_status}\t${row.value_status}\t${row.attempts}`)
}
console.log(`\nvalue preview:`)
for (const row of rows.filter(row => row.value_status === 'done')) {
  console.log(`- ${row.title}: ${row.value}`)
}
