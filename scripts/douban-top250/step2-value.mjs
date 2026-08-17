/**
 * Stage two: execute the movie's bespoke "analysis plugin".
 *
 * The stage-one plugin (stored in `prompt`) is used verbatim as the system
 * role — no additional persona, instruction, length or format is imposed.
 * The user message carries only the movie facts. The model therefore runs
 * exactly what the plugin prescribes and may output as long a full analysis
 * as it wants.
 *
 * The script stores the complete model output as `reason`. `value` is derived
 * deterministically from the first sentence so the page can still show a
 * concise lead; the derivation does not touch the model's own wording.
 *
 * Idempotent: a `done` value is kept, so retries never repeat LLM work.
 *
 * Usage: node step2-value.mjs [--db <path>] '<movie-json>' | '<title>'
 */

import { callLlm, ensureMovie, openDb, parseArgs, recordFailure } from './lib.mjs'

function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const match = clean.match(/^(.+?[。！？!?])(?:\s|$)/)
  return match ? match[1] : clean.slice(0, 120)
}

async function main() {
  const { dbPath, movie } = parseArgs(process.argv.slice(2))
  const db = openDb(dbPath)
  const row = ensureMovie(db, movie)
  if (row?.value_status === 'done' && typeof row.value === 'string' && row.value !== '') {
    console.log(`skip: value already done for "${movie.title}"`)
    return
  }
  if (typeof row?.prompt !== 'string' || row.prompt === '') {
    const error = new Error(`douban-top250: no analysis plugin for "${movie.title}"; run step1-prompt.mjs first`)
    recordFailure(db, movie.title, 'value', error)
    throw error
  }
  try {
    // The plugin is the system prompt; the user message is only the movie.
    const text = await callLlm([
      { role: 'system', content: row.prompt },
      { role: 'user', content: `电影：《${movie.title}》${movie.year !== undefined ? `（${movie.year} 年）` : ''}${movie.director !== undefined && movie.director !== '' ? `，导演 ${movie.director}` : ''}` },
    ], { json: false })
    const reason = text.trim()
    if (reason === '') {
      throw new Error(`douban-top250: stage two returned empty analysis for "${movie.title}"`)
    }
    const value = firstSentence(reason)
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE movies SET value = ?, reason = ?, value_status = 'done', error = NULL, updated_at = ?
      WHERE title = ?
    `).run(value, reason, now, movie.title)
    console.log(`stored full analysis for "${movie.title}" (${reason.length} chars)`)
  } catch (error) {
    recordFailure(db, movie.title, 'value', error)
    throw error
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
