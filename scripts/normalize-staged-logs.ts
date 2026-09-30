/** Normalize commit-retained command logs without staging unrelated working-tree changes. */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export function normalizeCommitLog(input: string): string {
  if (input.length === 0) return ''
  const lines = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
    .map(line => line.replace(/[ \t]+$/u, ''))
  while (lines.at(-1) === '') lines.pop()
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

function requireLog(path: string): void {
  if (!path.toLowerCase().endsWith('.log')) throw new Error(`refusing non-log path: ${path}`)
}

function git(root: string, args: readonly string[], input?: Buffer): Buffer {
  return execFileSync('git', ['-C', root, ...args], { input })
}

function normalizeFile(path: string): boolean {
  requireLog(path)
  const before = readFileSync(path, 'utf8')
  const after = normalizeCommitLog(before)
  if (after === before) return false
  writeFileSync(path, after)
  return true
}

function repositoryPath(root: string, input: string): string {
  const absolute = resolve(root, input)
  const path = relative(root, absolute)
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error(`log path is outside repository: ${input}`)
  }
  return path.replaceAll('\\', '/')
}

function stagedEntry(root: string, path: string): { mode: string; bytes: Buffer } | undefined {
  const row = git(root, ['ls-files', '--stage', '--', path]).toString('utf8').trim()
  if (row === '') return undefined
  const match = /^(\d+) [a-f0-9]+ 0\t/u.exec(row)
  if (match?.[1] === undefined) throw new Error(`unsupported staged entry: ${path}`)
  return { mode: match[1], bytes: git(root, ['show', `:${path}`]) }
}

function normalizeStagedFile(root: string, input: string): boolean {
  const path = repositoryPath(root, input)
  requireLog(path)
  const entry = stagedEntry(root, path)
  if (entry === undefined) return false
  const before = entry.bytes.toString('utf8')
  if (!Buffer.from(before).equals(entry.bytes)) throw new Error(`staged log is not UTF-8: ${path}`)
  const after = normalizeCommitLog(before)
  if (after === before) return false

  const object = git(root, ['hash-object', '-w', '--stdin'], Buffer.from(after)).toString('utf8').trim()
  git(root, ['update-index', '--add', '--cacheinfo', entry.mode, object, path])

  const workingPath = resolve(root, path)
  if (existsSync(workingPath) && readFileSync(workingPath).equals(entry.bytes)) writeFileSync(workingPath, after)
  return true
}

function main(args: readonly string[]): void {
  const staged = args[0] === '--staged'
  const paths = staged ? args.slice(1) : args
  if (paths.length === 0) return
  const root = staged ? git(process.cwd(), ['rev-parse', '--show-toplevel']).toString('utf8').trim() : process.cwd()
  let changed = 0
  for (const path of paths) {
    if (!path.toLowerCase().endsWith('.log')) continue
    if (staged ? normalizeStagedFile(root, path) : normalizeFile(path)) changed++
  }
  if (changed > 0) console.log(`normalize-staged-logs: normalized ${changed} log file(s)`)
}

if (import.meta.main) main(process.argv.slice(2))
