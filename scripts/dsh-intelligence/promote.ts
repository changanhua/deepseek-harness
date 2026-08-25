/**
 * promote.ts — 显式授权晋升 candidate → Pattern/Anti-pattern/Case
 *
 * 只有 validated/current 记录参与正常检索；Case/Pattern 均低于 Contract。
 * 晋升要求（docs/dsh-post-training-system-design.md §B5/B10）：
 *  - Pattern：至少两个独立 verified Case，或一个权威 Contract + 一个真实 verified Case；
 *             明确适用/禁用条件；所有 source refs 当前有效。不能只因一次成功而晋升。
 *  - 模型只能 propose（propose-candidate.ts），promotion 必须显式授权。
 *
 * 本脚本是 repo-tool（见 .agents/dsh-intelligence/self-adp.yaml）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml, dump as dumpYaml } from 'js-yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
interface CandidateRecord {
  id?: string
  status?: string
  provenance?: Record<string, unknown> & { artifact_kind?: string }
  review?: { approved_by?: string | null } | Record<string, unknown>
}


const KIND_DIR: Record<string, string> = {
  pattern: 'patterns',
  'anti-pattern': 'anti-patterns',
  case: 'cases',
}

export function promoteCandidate(candidateFile: string, approvedBy: string, opts: { root?: string } = {}): string {
  const root = opts.root ?? ROOT
  const abs = resolve(root, candidateFile)
  if (!existsSync(abs)) throw new Error(`candidate not found: ${abs}`)
  const record = loadYaml(readFileSync(abs, 'utf8')) as CandidateRecord
  const kind = (record.provenance?.artifact_kind ?? (record.id ?? '').split('-')[0]) as string
  const dirName = KIND_DIR[kind]
  if (!dirName) throw new Error(`unknown candidate kind from id: ${record.id}`)
  if (!record.review?.approved_by && !approvedBy) {
    throw new Error('promotion requires explicit authorization (--approver <who>)')
  }
  const destDir = join(root, '.agents', 'dsh-intelligence', 'knowledge', dirName)
  mkdirSync(destDir, { recursive: true })
  record.status = kind === 'case' ? 'verified' : 'validated'
  record.provenance = { ...(record.provenance ?? {}), lifecycle: 'validated', promoted_by: approvedBy, promoted_at: new Date().toISOString() }
  record.review = { ...(record.review ?? {}), approved_by: approvedBy, approved_at: new Date().toISOString() }
  writeFileSync(abs, `${dumpYaml(record)}\n`, 'utf8')
  const dest = join(destDir, join(relativeBase(candidateFile)))
  renameSync(abs, dest)
  return dest
}

function relativeBase(candidateFile: string): string {
  const name = candidateFile.split(/[\\/]/).pop() ?? 'candidate.yaml'
  return name
}

function main(): void {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--'))
  const approver = args.find(a => a.startsWith('--approver='))?.split('=')[1] ?? ''
  if (!file) {
    console.error('usage: promote.ts <candidate-file> --approver <who>')
    process.exit(2)
  }
  try {
    const dest = promoteCandidate(file, approver)
    console.log(`promoted -> ${dest}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isMain) {
  main()
}
