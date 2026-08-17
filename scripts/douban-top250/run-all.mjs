/**
 * Single-session batch runner with internal concurrency.
 *
 * Reads movies.json, skips already-done movies, runs stage1 and stage2
 * with a configurable concurrency pool. Reports progress after each movie.
 *
 * Usage: node run-all.mjs [--db <path>] [--concurrency N] [--limit N] [--offset N] [--stage1-only] [--stage2-only]
 *
 * Environment:
 *   DOUBAN_LLM_PROVIDER=arkcli  -> use arkcli +chat
 *   (unset)                     -> use HTTP chat completions
 */

import { callLlm, ensureMovie, movieFacts, openDb, parseArgs, parseJsonObject, recordFailure, scriptDir } from './lib.mjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function pool(tasks, concurrency) {
  const results = []
  const executing = new Set()
  let index = 0

  function next() {
    if (index >= tasks.length) return undefined
    const i = index++
    const task = tasks[i]
    const p = task()
      .then(result => { executing.delete(p); return { ok: true, index: i, result } })
      .catch(error => { executing.delete(p); return { ok: false, index: i, error } })
    executing.add(p)
    results.push(p)
    return p
  }

  // Fill initial pool
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) next()

  // Drain and refill
  while (executing.size > 0) {
    await Promise.race(executing)
    while (executing.size < concurrency && index < tasks.length) next()
  }

  return Promise.all(results)
}

// ---------------------------------------------------------------------------
// Stage 1: generate analysis plugin
// ---------------------------------------------------------------------------

const STAGE1_SYSTEM = [
  '\u4f60\u662f\u4e00\u540d\u201c\u53d9\u4e8b\u673a\u5236\u8bca\u65ad\u5e08\u201d\u3002',
  '\u6211\u6b63\u5728\u5efa\u7acb\u4e00\u4e2a\u5305\u542b\u5927\u91cf\u7ecf\u5178\u7535\u5f71\u7684\u521b\u4f5c\u673a\u5236\u6570\u636e\u5e93\u3002',
  '\u63a5\u4e0b\u6765\u6211\u4f1a\u7ed9\u4f60\u4e00\u90e8\u7535\u5f71\u3002',
  '\u4f60\u7684\u4efb\u52a1\u4e0d\u662f\u76f4\u63a5\u5199\u5f71\u8bc4\uff0c\u4e5f\u4e0d\u662f\u5168\u9762\u5206\u6790\u8fd9\u90e8\u7535\u5f71\uff0c\u800c\u662f\uff1a\u5224\u65ad\u8fd9\u90e8\u7535\u5f71\u6700\u503c\u5f97\u5206\u6790\u7684\u72ec\u7279\u4e4b\u5904\uff0c\u5e76\u4e3a\u5b83\u8bbe\u8ba1\u4e00\u5957\u4e13\u5c5e\u5206\u6790\u65b9\u6848\u3002',
].join(' ')

const STAGE1_BODY = (movie) => `\u7535\u5f71\uff1a\n\n\u300a${movie.title}\u300b\n\u5bfc\u6f14\uff1a${movie.director || '\u672a\u77e5'}\n\u5e74\u4efd\uff1a${movie.year || '\u672a\u77e5'}\n\u5267\u60c5\u8d44\u6599\uff1a\uff08\u6682\u7f3a\uff0c\u53ef\u7701\u7565\uff09\n\n---\n\n## \u4e00\u3001\u5148\u56de\u7b54\uff1a\u8fd9\u90e8\u7535\u5f71\u201c\u771f\u6b63\u5389\u5bb3\u5728\u54ea\u91cc\u201d\n\n\u4e0d\u8981\u6309\u7167\u6444\u5f71\u3001\u8868\u6f14\u3001\u5267\u60c5\u3001\u4e3b\u9898\u8fd9\u79cd\u4f20\u7edf\u5f71\u8bc4\u76ee\u5f55\u5e73\u5747\u5206\u914d\u7bc7\u5e45\u3002\n\n\u8bf7\u627e\u51fa\uff1a\n\n1. \u8fd9\u90e8\u7535\u5f71\u6700\u6838\u5fc3\u7684 1 \u4e2a\u521b\u4f5c\u5f15\u64ce\n2. \u6700\u503c\u5f97\u62c6\u89e3\u7684 3-6 \u4e2a\u7279\u6b8a\u673a\u5236\n3. \u54ea\u4e9b\u666e\u901a\u5206\u6790\u7ef4\u5ea6\u5bf9\u8fd9\u90e8\u7535\u5f71\u4ef7\u503c\u8f83\u4f4e\n4. \u5982\u679c\u53ea\u80fd\u7814\u7a76\u8fd9\u90e8\u7535\u5f71\u7684\u4e00\u4e2a\u95ee\u9898\uff0c\u6700\u5e94\u8be5\u7814\u7a76\u4ec0\u4e48\n\n---\n\n## \u4e8c\u3001\u5bfb\u627e\u201c\u5f02\u5e38\u70b9\u201d\n\n\u56de\u7b54\uff1a\n\n### 1. \u5b83\u8fdd\u53cd\u4e86\u54ea\u4e9b\u901a\u5e38\u7684\u521b\u4f5c\u5e38\u8bc6\uff0c\u5374\u4ecd\u7136\u6210\u529f\uff1f\n\n### 2. \u5b83\u6709\u54ea\u4e9b\u4e1c\u897f\u770b\u8d77\u6765\u4e0d\u5e94\u8be5\u597d\u770b\uff0c\u4f46\u5b9e\u9645\u975e\u5e38\u597d\u770b\uff1f\n\n### 3. \u5982\u679c\u666e\u901a\u521b\u4f5c\u8005\u6a21\u4eff\u5b83\uff0c\u6700\u5bb9\u6613\u5b66\u9519\u4ec0\u4e48\uff1f\n\n### 4. \u54ea\u4e9b\u7279\u5f81\u53ea\u662f\u8868\u9762\u98ce\u683c\uff0c\u54ea\u4e9b\u624d\u662f\u771f\u6b63\u4ea7\u751f\u6548\u679c\u7684\u5e95\u5c42\u673a\u5236\uff1f\n\n---\n\n## \u4e09\u3001\u63d0\u51fa 8-15 \u4e2a\u201c\u9ad8\u4fe1\u606f\u91cf\u95ee\u9898\u201d\n\n\u8fd9\u4e9b\u95ee\u9898\u5fc5\u987b\u9488\u5bf9\u8fd9\u90e8\u7535\u5f71\u672c\u8eab\u3002\n\n\u907f\u514d\uff1a\n\n\u201c\u4eba\u7269\u5851\u9020\u600e\u4e48\u6837\uff1f\u201d\n\u201c\u6444\u5f71\u6709\u4ec0\u4e48\u7279\u70b9\uff1f\u201d\n\u201c\u4e3b\u9898\u662f\u4ec0\u4e48\uff1f\u201d\n\n\u8fd9\u79cd\u4efb\u4f55\u7535\u5f71\u90fd\u80fd\u95ee\u7684\u95ee\u9898\u3002\n\n---\n\n## \u56db\u3001\u751f\u6210\u300c\u4e13\u5c5e\u5206\u6790\u63d2\u4ef6\u300d\n\n\u6700\u540e\u8f93\u51fa\uff1a\n\n### A. \u6838\u5fc3\u7814\u7a76\u95ee\u9898\n\n1-3 \u4e2a\u3002\n\n### B. \u4e13\u5c5e\u5206\u6790\u7ef4\u5ea6\n\n3-6 \u4e2a\u3002\n\n\u6bcf\u4e2a\u7ef4\u5ea6\u5199\u6e05\uff1a\n\n* \u5206\u6790\u4ec0\u4e48\n* \u4e3a\u4ec0\u4e48\u91cd\u8981\n* \u5e94\u8be5\u5bfb\u627e\u54ea\u4e9b\u7535\u5f71\u8bc1\u636e\n* \u6700\u7ec8\u5e0c\u671b\u62bd\u8c61\u51fa\u4ec0\u4e48\u521b\u4f5c\u89c4\u5f8b\n\n### C. \u5206\u6790\u6ce8\u610f\u4e8b\u9879\n\n\u6307\u51fa\u5206\u6790\u8fd9\u90e8\u7535\u5f71\u6700\u5bb9\u6613\u4ea7\u751f\u7684\u8bef\u5224\u3002\n\n---\n\n\u4e0d\u8981\u6b63\u5f0f\u5206\u6790\u7535\u5f71\u3002\n\n\u4f60\u7684\u4ea7\u7269\u5c06\u4f5c\u4e3a\u4e0b\u4e00\u9636\u6bb5\u5206\u6790\u6a21\u578b\u7684\u201c\u7535\u5f71\u4e13\u5c5e\u5206\u6790\u63d2\u4ef6\u201d\u3002\n\n\u8bf7\u4e25\u683c\u8f93\u51fa JSON\uff1a{"plugin":"<\u5b8c\u6574\u7684\u4e13\u5c5e\u5206\u6790\u63d2\u4ef6\u6587\u672c\uff0c\u5305\u542b A.\u6838\u5fc3\u7814\u7a76\u95ee\u9898 / B.\u4e13\u5c5e\u5206\u6790\u7ef4\u5ea6 / C.\u5206\u6790\u6ce8\u610f\u4e8b\u9879>"}`

// ---------------------------------------------------------------------------
// Stage 2: execute analysis plugin
// ---------------------------------------------------------------------------

const STAGE2_SYSTEM = [
  '\u4f60\u662f\u4e00\u540d\u8d44\u6df1\u7535\u5f71\u5206\u6790\u6a21\u578b\u3002',
  '\u4e0b\u9762\u4f1a\u7ed9\u4f60\u4e00\u90e8\u7535\u5f71\u53ca\u5176\u201c\u4e13\u5c5e\u5206\u6790\u63d2\u4ef6\u201d\u3002',
  '\u8bf7\u4e25\u683c\u9075\u7167\u63d2\u4ef6\u7684\u8981\u6c42\u4e0e\u7ef4\u5ea6\u8fdb\u884c\u5206\u6790\uff0c\u6309\u4f60\u81ea\u5df1\u7684\u5224\u65ad\u4ea7\u51fa\u5c3d\u53ef\u80fd\u5b8c\u6574\u3001\u6df1\u5165\u7684\u7ed3\u679c\u3002',
  '\u4e0d\u8981\u53d7\u4efb\u4f55\u957f\u5ea6\u6216\u5b57\u6570\u9650\u5236\u7684\u6697\u793a\u5f71\u54cd\uff1a\u63d2\u4ef6\u8981\u6c42\u5206\u6790\u591a\u5c11\u3001\u5199\u591a\u957f\uff0c\u5c31\u5199\u591a\u957f\u3002',
  '\u6700\u540e\u8f93\u51fa JSON\uff0c\u5b57\u6bb5\u4e3a value\uff08\u4e00\u53e5\u8bdd\u63d0\u70bc\u8fd9\u90e8\u7535\u5f71\u4e0d\u53ef\u66ff\u4ee3\u7684\u4ef7\u503c\uff09\u548c reason\uff08\u5b8c\u6574\u7684\u5206\u6790\u6b63\u6587\uff0c\u53ef\u76f4\u63a5\u4f5c\u4e3a\u8be5\u7247\u7684\u6df1\u5ea6\u5206\u6790\u5c55\u793a\uff09\u3002',
].join(' ')

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseCliArgs(argv) {
  let dbPath, concurrency = 3, limit = 10, offset = 0, stage1Only = false, stage2Only = false
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--db') { dbPath = argv[++i] }
    else if (a === '--concurrency') { concurrency = Number(argv[++i]) || 3 }
    else if (a === '--limit') { limit = Number(argv[++i]) || 10 }
    else if (a === '--offset') { offset = Number(argv[++i]) || 0 }
    else if (a === '--stage1-only') { stage1Only = true }
    else if (a === '--stage2-only') { stage2Only = true }
    else if (!a.startsWith('-')) { positional.push(a) }
  }
  return { dbPath, concurrency, limit, offset, stage1Only, stage2Only }
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2))
  const dbPath = opts.dbPath || resolve(process.env.DSH_HOME || require('os').homedir(), '.dsh', 'task-queue', 'results', 'douban-top250.db')
  const db = openDb(dbPath)

  // Load movies
  const allMovies = JSON.parse(readFileSync(resolve(scriptDir, 'movies.json'), 'utf8'))
  const movies = allMovies.slice(opts.offset, opts.offset + opts.limit)
  console.log(`\n=== Douban Top 250 Batch Runner ===`)
  console.log(`DB: ${dbPath}`)
  console.log(`Concurrency: ${opts.concurrency}`)
  console.log(`Movies: ${movies.length} (offset=${opts.offset}, limit=${opts.limit})`)
  console.log(`Stage: ${opts.stage1Only ? 'stage1 only' : opts.stage2Only ? 'stage2 only' : 'stage1 + stage2'}`)
  console.log()

  // --- Stage 1 ---
  if (!opts.stage2Only) {
    console.log('--- Stage 1: generating analysis plugins ---')
    const stage1Tasks = movies.filter(m => {
      const row = db.prepare('SELECT prompt_status FROM movies WHERE title = ?').get(m.title)
      return !row || row.prompt_status !== 'done'
    })
    console.log(`To process: ${stage1Tasks.length} / ${movies.length}`)

    if (stage1Tasks.length > 0) {
      const results = await pool(stage1Tasks.map(m => async () => {
        const row = ensureMovie(db, m)
        if (row?.prompt_status === 'done') return { title: m.title, status: 'skip' }
        try {
          const text = await callLlm([
            { role: 'system', content: STAGE1_SYSTEM },
            { role: 'user', content: STAGE1_BODY(m) },
          ])
          const plugin = parseJsonObject(text).plugin
          if (typeof plugin !== 'string' || plugin.trim() === '') throw new Error('empty plugin')
          const now = new Date().toISOString()
          db.prepare("UPDATE movies SET prompt=?, prompt_status='done', error=NULL, updated_at=? WHERE title=?")
            .run(plugin.trim(), now, m.title)
          return { title: m.title, status: 'ok', len: plugin.length }
        } catch (error) {
          recordFailure(db, m.title, 'prompt', error)
          return { title: m.title, status: 'failed', error: error.message?.slice(0, 100) }
        }
      }), opts.concurrency)

      const ok = results.filter(r => r.ok).map(r => r.result)
      const done = ok.filter(r => r.status === 'ok')
      const skipped = ok.filter(r => r.status === 'skip')
      const failed = ok.filter(r => r.status === 'failed')
      console.log(`Stage 1 done: ${done.length} new, ${skipped.length} skipped, ${failed.length} failed`)
      for (const f of failed) console.log(`  FAILED: ${f.title} - ${f.error}`)
    }
    console.log()
  }

  // --- Stage 2 ---
  if (!opts.stage1Only) {
    console.log('--- Stage 2: executing analysis plugins ---')
    const stage2Tasks = movies.filter(m => {
      const row = db.prepare('SELECT value_status, prompt_status FROM movies WHERE title = ?').get(m.title)
      return row && row.prompt_status === 'done' && row.value_status !== 'done'
    })
    console.log(`To process: ${stage2Tasks.length} / ${movies.length}`)

    if (stage2Tasks.length > 0) {
      const results = await pool(stage2Tasks.map(m => async () => {
        const row = ensureMovie(db, m)
        if (row?.value_status === 'done') return { title: m.title, status: 'skip' }
        if (!row?.prompt || row.prompt === '') return { title: m.title, status: 'no-plugin' }
        try {
          const text = await callLlm([
            { role: 'system', content: row.prompt },
            { role: 'user', content: `\u7535\u5f71\uff1a\u300a${m.title}\u300b${m.year ? `\uff08${m.year} \u5e74\uff09` : ''}${m.director ? `\uff0c\u5bfc\u6f14 ${m.director}` : ''}` },
          ])
          const parsed = parseJsonObject(text)
          if (typeof parsed.value !== 'string' || parsed.value.trim() === '') throw new Error('empty value')
          if (typeof parsed.reason !== 'string' || parsed.reason.trim() === '') throw new Error('empty reason')
          const now = new Date().toISOString()
          db.prepare("UPDATE movies SET value=?, reason=?, value_status='done', error=NULL, updated_at=? WHERE title=?")
            .run(parsed.value.trim(), parsed.reason.trim(), now, m.title)
          return { title: m.title, status: 'ok', reasonLen: parsed.reason.length }
        } catch (error) {
          recordFailure(db, m.title, 'value', error)
          return { title: m.title, status: 'failed', error: error.message?.slice(0, 100) }
        }
      }), opts.concurrency)

      const ok = results.filter(r => r.ok).map(r => r.result)
      const done = ok.filter(r => r.status === 'ok')
      const failed = ok.filter(r => r.status === 'failed')
      const noPlugin = ok.filter(r => r.status === 'no-plugin')
      console.log(`Stage 2 done: ${done.length} new, ${failed.length} failed, ${noPlugin.length} no-plugin`)
      for (const f of failed) console.log(`  FAILED: ${f.title} - ${f.error}`)
      for (const n of noPlugin) console.log(`  NO PLUGIN: ${n.title}`)
    }
    console.log()
  }

  // --- Summary ---
  const total = db.prepare('SELECT COUNT(*) as c FROM movies WHERE rank BETWEEN ? AND ?').get(movies[0]?.rank ?? 0, movies[movies.length - 1]?.rank ?? 9999)
  const pDone = db.prepare("SELECT COUNT(*) as c FROM movies WHERE prompt_status='done' AND rank BETWEEN ? AND ?").get(movies[0]?.rank ?? 0, movies[movies.length - 1]?.rank ?? 9999)
  const vDone = db.prepare("SELECT COUNT(*) as c FROM movies WHERE value_status='done' AND rank BETWEEN ? AND ?").get(movies[0]?.rank ?? 0, movies[movies.length - 1]?.rank ?? 9999)
  console.log(`=== Summary ===`)
  console.log(`Movies in range: ${total?.c ?? 0}`)
  console.log(`Stage 1 done: ${pDone?.c ?? 0}`)
  console.log(`Stage 2 done: ${vDone?.c ?? 0}`)
  console.log()
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
