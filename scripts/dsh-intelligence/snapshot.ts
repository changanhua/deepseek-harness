/**
 * snapshot.ts — Evidence Capsule Builder 的静态部分（Phase 0）
 *
 * 只做 Target Lock 与静态事实采集：repo、revision、branch/dirty scope、merge base、
 * generated catalog digests。不把“可注册”写成“正在运行”。
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import { loadSchema, validateEvidence } from './validate-adp.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function git(args: string[], cwd = ROOT): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function fileSha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 文件直接 hash；目录按相对路径排序后对 path + file digest 做递归确定性 hash。 */
export function artifactSha256(target: string): string {
  if (!existsSync(target)) return ''
  if (!statSync(target).isDirectory()) return fileSha256(target)

  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  walk(target)

  const digest = createHash('sha256')
  for (const file of files) {
    digest.update(relative(target, file).replace(/\\/g, '/'))
    digest.update('\0')
    digest.update(fileSha256(file))
    digest.update('\n')
  }
  return digest.digest('hex')
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

export interface EvidenceCapsule {
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
  unavailable: Array<{ fact: string; reason: 'not-mounted' | 'no-live-instance' | 'unsupported' | 'not-requested' }>
  conflicts: unknown[]
}

export interface SnapshotOptions {
  profile?: string
  hostScope?: string
}

/** 采集当前 checkout 的静态证据。 */
export function buildSnapshot(root = ROOT, options: SnapshotOptions = {}): EvidenceCapsule {
  let repository = ''
  try { repository = git(['remote', 'get-url', 'origin'], root) } catch { /* 无 origin 时留空 */ }
  const revision = git(['rev-parse', 'HEAD'], root)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root)
  const dirty = git(['status', '--porcelain'], root).split('\n').filter(line => line.trim() !== '')

  let upstreamBase = ''
  for (const ref of ['upstream/master', 'origin/master']) {
    try {
      upstreamBase = git(['merge-base', 'HEAD', ref], root)
      break
    } catch { /* try next */ }
  }

  let generatedCatalogs: GeneratedCatalog[] = []
  const indexFile = join(root, '.agents', 'dsh-intelligence', 'contract-index', 'generated-sources.yaml')
  if (existsSync(indexFile)) {
    const index = loadYaml(readFileSync(indexFile, 'utf8')) as GeneratedSourcesIndex
    generatedCatalogs = (index.generated ?? []).map(definition => ({
      kind: definition.kind,
      path: definition.path,
      digest: artifactSha256(join(root, definition.path)),
      source_ref: definition.generator,
    }))
  }

  const unavailable: EvidenceCapsule['unavailable'] = [
    { fact: 'live runtime / cordis mounts', reason: 'not-requested' },
  ]
  if (!options.profile) unavailable.push({ fact: 'profile', reason: 'not-requested' })
  if (!options.hostScope) unavailable.push({ fact: 'host scope', reason: 'not-requested' })

  return {
    schema_version: 1,
    id: `evidence:${revision.slice(0, 12)}`,
    created_at: new Date().toISOString(),
    target_snapshot: {
      repository,
      revision,
      branch,
      upstream_base: upstreamBase,
      dirty_paths: dirty,
      profile: options.profile ?? '',
      host_scope: options.hostScope ?? '',
    },
    static_manifest: {
      dump_config_ref: '',
      generated_catalogs: generatedCatalogs,
      exact_source_refs: [],
    },
    runtime_observations: [],
    unavailable,
    conflicts: [],
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index >= 0) return args[index + 1]
  const equal = args.find(arg => arg.startsWith(`${flag}=`))
  return equal?.slice(flag.length + 1)
}

function main(): void {
  const args = process.argv.slice(2)
  const outFile = argValue(args, '--out')
  const options: SnapshotOptions = {}
  const profile = argValue(args, '--profile')
  const hostScope = argValue(args, '--host-scope')
  if (profile) options.profile = profile
  if (hostScope) options.hostScope = hostScope
  const snapshot = buildSnapshot(ROOT, options)

  const schema = loadSchema('evidence-capsule.schema.json')
  const check = validateEvidence(snapshot, schema)
  for (const error of check.errors) console.error(`[schema] ${error.path}: ${error.message}`)

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

const isMain = process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isMain) main()
