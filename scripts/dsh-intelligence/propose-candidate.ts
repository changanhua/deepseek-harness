/** propose-candidate.ts — 从 Run 产物生成 knowledge candidate（只 propose，不 promote）。 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dump as dumpYaml, load as loadYaml } from 'js-yaml'

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
    ? JSON.parse(readFileSync(verificationFile, 'utf8')) as Record<string, unknown>
    : {}

  const record: Record<string, unknown> = {
    schema_version: 1,
    id: `${kind}-${runId}`,
    title: adp.task?.desired_outcomes?.[0] ?? runId,
    status: 'candidate',
    provenance: {
      origin: 'model-generated',
      artifact_kind: kind,
      lifecycle: 'candidate',
      run_id: runId,
    },
    source_adp: adp.id ?? `adp:${runId}`,
    reason,
    verification: {
      blocked_findings: verification['blocked_findings'] ?? [],
      runtime_observations: verification['runtime_observations'] ?? [],
    },
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
  const runId = args.find(arg => !arg.startsWith('--'))
  const kindValue = args.find(arg => arg.startsWith('--kind='))?.split('=')[1]
  const kind = kindValue === 'pattern' || kindValue === 'anti-pattern' || kindValue === 'case' ? kindValue : undefined
  const reason = args.find(arg => arg.startsWith('--reason='))?.split('=')[1] ?? 'explicit user request'
  if (!runId || !kind) {
    console.error('usage: propose-candidate.ts <run-id> --kind=pattern|anti-pattern|case [--reason=...]')
    process.exit(2)
  }
  const { file } = proposeCandidate(runId, kind, reason)
  console.log(`candidate written: ${file}`)
}

const isMain = process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isMain) main()
