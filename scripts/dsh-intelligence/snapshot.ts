/**
 * snapshot.ts — Evidence Capsule Builder 的静态部分（Phase 0）
 *
 * 只做 Target Lock 与静态事实采集：repo、revision、branch/dirty scope、merge base、
 * generated catalog digests。不做架构判断，不把“可注册”写成“正在运行”。
 * runtime adapters（--dump-config / runtime_inspect / cordis_inspect_*）Phase 0 暂不接入，
 * 以 unavailable 记录，不得用 Case 或配置推断运行状态。
 *
 * 本脚本是 repo-tool（见 .agents/dsh-intelligence/self-adp.yaml）：不注册 Cordis Service。
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import { loadSchema, validateEvidence } from './validate-adp.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function git(args: string[], cwd = ROOT): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function sha256(file: string): string {
  try {
    if (!existsSync(file) || statSync(file).isDirectory()) return ''
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch {
    return ''
  }
}

interface GeneratedCatalogDef {
  kind: string
  path: string
  generator: string
}

interface GeneratedSourcesIndex {
  generated?: GeneratedCatalogDef[]
}

interface GeneratedCatalog {
  kind: string
  path: string
  digest: string
  source_ref: string
}

interface TargetSnapshot {
  repository: string
  revision: string
  branch: string
  upstream_base: string
  dirty_paths: string[]
  profile: string
  host_scope: string
}

interface EvidenceCapsule {
  schema_version: number
  id: string
  created_at: string
  target_snapshot: TargetSnapshot
  static_manifest: {
    dump_config_ref: string
    generated_catalogs: GeneratedCatalog[]
    exact_source_refs: string[]
  }
  runtime_observations: unknown[]
  unavailable: Array<{ fact: string; reason: string }>
  conflicts: unknown[]
}

/** 采集当前 checkout 的静态证据。 */
export function buildSnapshot(root = ROOT): EvidenceCapsule {
  let repository = ''
  try { repository = git(['remote', 'get-url', 'origin'], root) } catch { /* 无 origin 时留空 */ }
  const revision = git(['rev-parse', 'HEAD'], root)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root)
  const dirty = git(['status', '--porcelain'], root).split('\n').filter(l => l.trim() !== '')

  let upstreamBase = ''
  for (const ref of ['upstream/master', 'origin/master']) {
    try { upstreamBase = git(['merge-base', 'HEAD', ref], root); break } catch { /* try next */ }
  }

  let generatedCatalogs: GeneratedCatalog[] = []
  const indexFile = join(root, '.agents', 'dsh-intelligence', 'contract-index', 'generated-sources.yaml')
  if (existsSync(indexFile)) {
    const index = loadYaml(readFileSync(indexFile, 'utf8')) as GeneratedSourcesIndex
    generatedCatalogs = (index.generated ?? []).map((g: GeneratedCatalogDef) => ({
      kind: g.kind,
      path: g.path,
      digest: sha256(join(root, g.path)),
      source_ref: g.generator,
    }))
  }

  return {
    schema_version: 1,
    id: `evidence-${revision.slice(0, 12)}`,
    created_at: new Date().toISOString(),
    target_snapshot: {
      repository,
      revision,
      branch,
      upstream_base: upstreamBase,
      dirty_paths: dirty,
      profile: '',
      host_scope: '',
    },
    static_manifest: {
      dump_config_ref: '',
      generated_catalogs: generatedCatalogs,
      exact_source_refs: [],
    },
    runtime_observations: [],
    unavailable: [
      { fact: 'profile / live runtime / cordis mounts', reason: 'not-requested' },
    ],
    conflicts: [],
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const outFile = outIndex >= 0 ? args[outIndex + 1] : undefined
  const snapshot = buildSnapshot()

  // 生成后立即用 evidence-capsule schema 自校验
  const schema = loadSchema('evidence-capsule.schema.json')
  const check = validateEvidence(snapshot, schema)
  for (const e of check.errors) console.error(`[schema] ${e.path}: ${e.message}`)

  if (outFile) {
    const abs = resolve(ROOT, outFile)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    console.log(`written ${abs} (schema ${check.ok ? 'PASS' : 'FAIL'})`)
  } else {
    console.log(JSON.stringify(snapshot, null, 2))
  }
  process.exit(check.ok ? 0 : 1)
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isMain) {
  main()
}
