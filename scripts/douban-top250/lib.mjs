/**
 * Shared runtime for the Douban Top 250 movie-value pipeline.
 * Supports two LLM providers: http (default) or arkcli.
 * Provider selection: set DOUBAN_LLM_PROVIDER=arkcli to use arkcli.
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const scriptDir = dirname(fileURLToPath(import.meta.url))

export function parseArgs(argv) {
  let dbPath; const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--db') { dbPath = argv[++i]; if (dbPath === undefined) throw new Error('--db requires a path') }
    else if (arg.startsWith('--')) throw new Error('unknown option ' + arg)
    else positional.push(arg)
  }
  if (positional.length === 0) throw new Error('missing movie argument')
  const raw = positional.join(' ')
  const movie = raw.startsWith('{') ? parseMovie(raw) : { title: raw }
  if (movie.title.trim() === '') throw new Error('movie title must not be empty')
  return { dbPath: dbPath ?? defaultDbPath(), movie }
}

export function parseMovie(raw) {
  let value
  try { value = JSON.parse(raw) } catch (e) { throw new Error('not valid JSON: ' + String(e)) }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('must be object')
  if (typeof value.title !== 'string' || value.title.trim() === '') throw new Error('requires title')
  const m = { title: value.title.trim() }
  if (value.rank !== undefined) { if (!Number.isSafeInteger(value.rank)) throw new Error('rank int'); m.rank = value.rank }
  if (value.year !== undefined) { if (!Number.isSafeInteger(value.year)) throw new Error('year int'); m.year = value.year }
  if (value.director !== undefined) { if (typeof value.director !== 'string') throw new Error('director str'); m.director = value.director.trim() }
  return m
}

export function defaultDbPath() {
  return resolve(process.env.DSH_HOME || join(homedir(), '.dsh'), 'task-queue', 'results', 'douban-top250.db')
}

export function openDb(dbPath) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS movies (
    title TEXT PRIMARY KEY, rank INTEGER, year INTEGER, director TEXT,
    prompt_status TEXT NOT NULL DEFAULT 'pending', value_status TEXT NOT NULL DEFAULT 'pending',
    prompt TEXT, value TEXT, reason TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  return db
}

export function ensureMovie(db, movie) {
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO movies (title,rank,year,director,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(title) DO UPDATE SET rank=COALESCE(excluded.rank,movies.rank),
    year=COALESCE(excluded.year,movies.year),director=COALESCE(excluded.director,movies.director),
    updated_at=excluded.updated_at`).run(movie.title, movie.rank??null, movie.year??null, movie.director??null, now, now)
  return db.prepare('SELECT * FROM movies WHERE title = ?').get(movie.title)
}

export function movieFacts(movie) {
  const p = ['\u300a'+movie.title+'\u300b']
  if (movie.year !== undefined) p.push(movie.year+' \u5e74')
  if (movie.director) p.push('\u5bfc\u6f14 '+movie.director)
  return p.join('\uff0c')
}

function credentialFile() {
  const path = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douban-top250.env')
  try { const e = {}; for (const l of readFileSync(path,'utf8').split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if(m) e[m[1]]=m[2] }; return e } catch { return {} }
}

function dshCredential(name) {
  const path = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
  try { const t = readFileSync(path,'utf8'); for (const r of t.split('\n')) { const l = r.endsWith('\r')?r.slice(0,-1):r; const p = name+':'; if(l.startsWith(p)) return l.slice(p.length).trim() } } catch {} return undefined
}

function resolveApiKey() {
  const f = credentialFile()
  return process.env.DOUBAN_LLM_API_KEY || process.env.OPENCODE_GO_API_KEY || process.env.ARK_API_KEY || process.env.DEEPSEEK_API_KEY
    || f.DOUBAN_LLM_API_KEY || f.OPENCODE_GO_API_KEY || dshCredential('OPENCODE_GO_API_KEY') || f.ARK_API_KEY || f.DEEPSEEK_API_KEY
}

function resolveProvider() { const p=(process.env.DOUBAN_LLM_PROVIDER||'').toLowerCase().trim(); return p==='arkcli'?'arkcli':'http' }
function resolveModel() { return process.env.DOUBAN_LLM_MODEL || 'deepseek-v4-flash' }

async function callLlmHttp(messages, { json = true } = {}) {
  const baseUrl = (process.env.DOUBAN_LLM_BASE_URL || process.env.OPENCODE_BASE_URL || process.env.ARK_BASE_URL || 'https://opencode.ai/zen/go/v1').replace(/\/$/,'')
  const apiKey = resolveApiKey()
  if (!apiKey) throw new Error('no API key')
  const r = await fetch(baseUrl+'/chat/completions', { method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+apiKey},
    body: JSON.stringify({ model:resolveModel(), messages, temperature:0.7, ...(json?{response_format:{type:'json_object'}}:{}) }),
    signal: AbortSignal.timeout(120000) })
  if (!r.ok) throw new Error('HTTP '+r.status)
  const b = await r.json(); const t = b?.choices?.[0]?.message?.content
  if (typeof t!=='string'||t.length===0) throw new Error('empty response')
  return t
}

function callLlmArkcli(messages, { json = true } = {}) {
  const apiKey = resolveApiKey()
  if (!apiKey) throw new Error('no API key for arkcli')
  let sys='', usr=''
  for (const m of messages) { if(m.role==='system') sys=m.content; else if(m.role==='user') usr=m.content }
  if (!usr) throw new Error('no user message')
  const args = ['+chat', usr]
  if (sys) args.push('--instructions', sys)
  args.push('--model', resolveModel(), '--temperature', '0.7')
  if (json) args.push('--text-format', 'json_object')
  args.push('--api-key', apiKey)
  return new Promise((ok, fail) => {
    const c = spawn('npx', ['@volcengine/ark-cli', ...args], { timeout:120000, shell:process.platform==='win32', stdio:['ignore','pipe','pipe'] })
    let out='', err=''
    c.stdout.on('data',d=>{out+=d}); c.stderr.on('data',d=>{err+=d})
    c.on('close',code=>{
      if(code!==0) return fail(new Error('arkcli exited '+code+': '+err.slice(0,500)))
      try { const r=JSON.parse(out); const ct=r?.content; if(typeof ct!=='string'||ct.length===0) return fail(new Error('no content: '+out.slice(0,300))); ok(ct) }
      catch { fail(new Error('not JSON: '+out.slice(0,300))) }
    })
    c.on('error',e=>fail(new Error('spawn: '+e.message)))
  })
}

export async function callLlm(messages, opts = {}) {
  if (resolveProvider()==='arkcli') return callLlmArkcli(messages, opts)
  return callLlmHttp(messages, opts)
}

export function parseJsonObject(text) {
  try { const v=JSON.parse(text); if(typeof v!=='object'||v===null||Array.isArray(v)) throw new Error('not object'); return v }
  catch(e) { throw new Error('invalid JSON: '+String(e)) }
}

export function recordFailure(db, title, stage, error) {
  const col = stage==='prompt'?'prompt_status':'value_status'
  db.prepare('UPDATE movies SET '+col+'=\'failed\', attempts=attempts+1, error=?, updated_at=? WHERE title=?')
    .run(String(error), new Date().toISOString(), title)
}
