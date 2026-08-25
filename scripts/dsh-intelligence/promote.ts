/**
 * promote.ts — 显式授权晋升 candidate → Pattern / Anti-pattern / Case
 *
 * 授权只是必要条件，不是充分条件。Promotion 还必须满足该知识类型的证据门槛；
 * 模型只能 propose，不能通过一个 approver 字符串绕过证据治理。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dump as dumpYaml, load as loadYaml } from 'js-yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface VerificationRecord {
  blocked_findings?: unknown[]
  runtime_observations?: unknown[]
  verification_refs?: string[]
}

interface CandidateRecord {
  id?: string
  status?: string
  source_adp?: string
  applies_when?: string[]
  does_not_apply_when?: string[]
  evidence_cases?: string[]
  source_contract_refs?: string[]
  evidence_refs?: string[]
  safe_alternatives?: string[]
  false_positive_conditions?: string[]
  verification?: VerificationRecord
  provenance?: Record<string, unknown> & { artifact_kind?: string }
  review?: { approved_by?: string | null } & Record<string, unknown>
}

interface CaseRecord {
  id?: string
  status?: string
}

const KIND_DIR: Record<string, string> = {
  pattern: 'patterns',
  'anti-pattern': 'anti-patterns',
  case: 'cases',
}

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function readVerifiedCases(root: string): Map<string, CaseRecord> {
  const casesDir = join(root, '.agents', 'dsh-intelligence', 'knowledge', 'cases')
  const cases = new Map<string, CaseRecord>()
  if (!existsSync(casesDir)) return cases
  for (const file of readdirSync(casesDir).filter(name => name.endsWith('.yaml'))) {
    const record = loadYaml(readFileSync(join(casesDir, file), 'utf8')) as CaseRecord
    if (!['verified', 'golden', 'current'].includes(record.status ?? '')) continue
    cases.set(file, record)
    if (record.id) cases.set(record.id, record)
  }
  return cases
}

function assertPatternPrerequisites(record: CandidateRecord, root: string): void {
  if (!nonEmptyArray(record.applies_when) || !nonEmptyArray(record.does_not_apply_when)) {
    throw new Error('pattern promotion requires non-empty applies_when and does_not_apply_when')
  }
  const verifiedCases = readVerifiedCases(root)
  const caseRefs = record.evidence_cases ?? []
  const verifiedCount = caseRefs.filter(ref => verifiedCases.has(ref)).length
  const contractCount = record.source_contract_refs?.length ?? 0
  if (!(verifiedCount >= 2 || (verifiedCount >= 1 && contractCount >= 1))) {
    throw new Error('pattern promotion requires >=2 verified cases, or >=1 current contract ref + >=1 verified case')
  }
}

function assertAntiPatternPrerequisites(record: CandidateRecord): void {
  if (!nonEmptyArray(record.evidence_refs)) throw new Error('anti-pattern promotion requires evidence_refs')
  if (!nonEmptyArray(record.safe_alternatives)) throw new Error('anti-pattern promotion requires safe_alternatives')
  if (!nonEmptyArray(record.false_positive_conditions)) throw new Error('anti-pattern promotion requires false_positive_conditions')
}

function assertCasePrerequisites(record: CandidateRecord): void {
  if (typeof record.source_adp !== 'string' || record.source_adp.trim() === '') {
    throw new Error('case promotion requires source_adp')
  }
  const verification = record.verification ?? {}
  if (!nonEmptyArray(verification.blocked_findings)
      && !nonEmptyArray(verification.runtime_observations)
      && !nonEmptyArray(verification.verification_refs)) {
    throw new Error('case promotion requires verification evidence')
  }
}

function relativeBase(candidateFile: string): string {
  return candidateFile.split(/[\\/]/).pop() ?? 'candidate.yaml'
}

export function promoteCandidate(candidateFile: string, approvedBy: string, opts: { root?: string } = {}): string {
  const root = opts.root ?? ROOT
  const abs = resolve(root, candidateFile)
  if (!existsSync(abs)) throw new Error(`candidate not found: ${abs}`)
  if (approvedBy.trim() === '') throw new Error('promotion requires explicit authorization (--approver <who>)')

  const record = loadYaml(readFileSync(abs, 'utf8')) as CandidateRecord
  if (record.status !== 'candidate' && record.provenance?.lifecycle !== 'candidate') {
    throw new Error('promotion source must be a candidate')
  }

  const kind = record.provenance?.artifact_kind
  if (typeof kind !== 'string') throw new Error(`unknown candidate kind: ${String(kind)}`)
  const dirName = KIND_DIR[kind]
  if (!dirName) throw new Error(`unknown candidate kind: ${kind}`)

  if (kind === 'pattern') assertPatternPrerequisites(record, root)
  else if (kind === 'anti-pattern') assertAntiPatternPrerequisites(record)
  else assertCasePrerequisites(record)

  const destDir = join(root, '.agents', 'dsh-intelligence', 'knowledge', dirName)
  mkdirSync(destDir, { recursive: true })
  record.status = kind === 'case' ? 'verified' : 'validated'
  record.provenance = {
    ...(record.provenance ?? {}),
    lifecycle: kind === 'case' ? 'verified' : 'validated',
    promoted_by: approvedBy,
    promoted_at: new Date().toISOString(),
  }
  record.review = { ...(record.review ?? {}), approved_by: approvedBy, approved_at: new Date().toISOString() }

  writeFileSync(abs, `${dumpYaml(record)}\n`, 'utf8')
  const dest = join(destDir, relativeBase(candidateFile))
  renameSync(abs, dest)
  return dest
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index >= 0) return args[index + 1]
  const equal = args.find(arg => arg.startsWith(`${flag}=`))
  return equal?.slice(flag.length + 1)
}

function main(): void {
  const args = process.argv.slice(2)
  const file = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--approver')
  const approver = argValue(args, '--approver') ?? ''
  if (!file) {
    console.error('usage: promote.ts <candidate-file> --approver <who>')
    process.exit(2)
  }
  try {
    console.log(`promoted -> ${promoteCandidate(file, approver)}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

const isMain = process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isMain) main()
