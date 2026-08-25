/**
 * propose-candidate.ts — 从 Run 产物生成 knowledge candidate（只 propose，不 promote）
 *
 * 只有以下事件生成 candidate（docs/dsh-post-training-system-design.md §B10）：
 *  blocking finding 被修复、真实运行失败揭示新机制、同类 finding 重复出现、
 *  Pattern 适用条件变化，或用户明确要求沉淀。普通成功任务不自动提炼。
 * 模型可以 propose，不能自行 promote；promotion 由 promote.ts 显式授权。
 *
 * 本脚本是 repo-tool（见 .agents/dsh-intelligence/self-adp.yaml）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml, dump as dumpYaml } from 'js-yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface RunAdp {
  id?: string
  task?: { desired_outcomes?: string[] }
}

export type CandidateKind = 'pattern' | 'anti-pattern' | 'case'

export function proposeCandidate(
  runId: string,
  kind: CandidateKind,
  reason: string,
  opts: { root?: string } = {},
): { file: string; record: Record<string, unknown> } {
  const root = opts.root ?? ROOT
  const runsDir = join(root, '.dsh-intelligence', 'runs')
  const adpFile = join(runsDir, runId, 'adp.yaml')
  const verificationFile = join(runsDir, runId, 'verification.json')
  if (!existsSync(adpFile)) throw new Error(`run artifact missing: ${adpFile}`)

  const adp = loadYaml(readFileSync(adpFile, 'utf8')) as RunAdp
  const verification = existsSync(verificationFile)
    ? JSON.parse(readFileSync(verificationFile, 'utf8'))
    : {}

  const record: Record<string, unknown> = {
    schema_version: 1,
    id: `${kind}-${runId}`,
    title: (adp.task?.desired_outcomes?.[0] ?? runId) as string,
    status: 'candidate',
    provenance: {
      origin: 'model-generated',
      artifact_kind: kind,
      lifecycle: 'candidate',
      run_id: runId,
    },
    source_adp: adp.id ?? `adp:${runId}`,
    reason,
    verification: { blocked_findings: verification.blocked_findings ?? [], runtime_observations: verification.runtime_observations ?? [] },
    review: { approved_by: null, approved_at: null },
  }

  const candidatesDir = join(root, '.agents', 'dsh-intelligence', 'knowledge', 'candidates')
  mkdirSync(candidatesDir, { recursive: true })
  const file = join(candidatesDir, `${runId}-${kind}.yaml`)
  writeFileSync(file, `${dumpYaml(record)}\n`, 'utf8')
  return { file, record }
}

function main(): void {
  const args = process.argv.slice(2)
  const runId = args.find(a => !a.startsWith('--'))
  const kind = args.find(a => a.startsWith('--kind='))?.split('=')[1] as CandidateKind | undefined
  const reason = args.find(a => a.startsWith('--reason='))?.split('=')[1] ?? 'explicit user request'
  if (!runId || !kind) {
    console.error('usage: propose-candidate.ts <run-id> --kind=pattern|anti-pattern|case [--reason=...]')
    process.exit(2)
  }
  const { file } = proposeCandidate(runId, kind, reason)
  console.log(`candidate written: ${file}`)
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isMain) {
  main()
}
