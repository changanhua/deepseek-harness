/**
 * validate-adp.ts — Architecture Decision Packet 机器校验
 *
 * 两层校验，先于语义 Review，不能用说明文字豁免（docs/dsh-post-training-system-design.md §B9）：
 *  1. schema 校验（轻量 JSON Schema 子集，零新依赖）
 *  2. 确定性硬检查：8 条既有 + 新版 6 条 placement.*（拒绝平行运行时、滥造 public Service、
 *     事件域混淆、伪 Session fork、Settings 越权、DSH 概念重定义）
 *
 * 本脚本自身是 repo-tool（见 .agents/dsh-intelligence/self-adp.yaml）：
 * 只读写仓库产物，不注册 Cordis Service，不拥有 Agent/Session/Tool/LLM/事件域。
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = join(__dirname, '..', '..', '.agents', 'dsh-intelligence', 'schemas')

// ---------------------------------------------------------------------------
// 1. 轻量 JSON Schema 校验（支持本项目 schema 用到的子集）
// ---------------------------------------------------------------------------

export interface SchemaError {
  path: string
  message: string
}

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'number': return typeof value === 'number'
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return true
  }
}

/**
 * 校验 `value` 是否符合 JSON Schema 子集。返回错误列表（空 = 通过）。
 * 支持：type(单/多)、const、enum、pattern、minimum、required/properties、items、format(date-time)。
 */
export function validateSchema(value: unknown, schema: unknown, path = '$'): SchemaError[] {
  const errors: SchemaError[] = []
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return errors
  const s = schema as Record<string, unknown>

  if (typeof s.const !== 'undefined') {
    if (value !== s.const) errors.push({ path, message: `expected const ${JSON.stringify(s.const)}` })
    return errors
  }

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string]
    if (!types.some(t => typeMatches(value, t))) {
      errors.push({ path, message: `expected type ${types.join('|')}` })
      return errors
    }
  }

  if (typeof value === 'string') {
    if (typeof s.enum !== 'undefined') {
      const en = s.enum as unknown[]
      if (!en.includes(value)) errors.push({ path, message: `value ${JSON.stringify(value)} not in enum` })
    }
    if (typeof s.pattern === 'string') {
      const re = new RegExp(s.pattern)
      if (!re.test(value)) errors.push({ path, message: `value ${JSON.stringify(value)} does not match ${s.pattern}` })
    }
    if (s.format === 'date-time' && !DATE_TIME_RE.test(value)) {
      errors.push({ path, message: `value ${JSON.stringify(value)} is not a valid date-time` })
    }
  }

  if (typeof value === 'number' && typeof s.minimum === 'number' && value < s.minimum) {
    errors.push({ path, message: `value ${value} below minimum ${s.minimum}` })
  }

  if (Array.isArray(value) && s.items !== undefined) {
    value.forEach((item, i) => {
      errors.push(...validateSchema(item, s.items, `${path}[${i}]`))
    })
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if (Array.isArray(s.required)) {
      for (const key of s.required as string[]) {
        if (!(key in obj)) errors.push({ path: `${path}.${key}`, message: `missing required property ${key}` })
      }
    }
    if (s.properties !== undefined && typeof s.properties === 'object') {
      for (const [key, sub] of Object.entries(s.properties as Record<string, unknown>)) {
        if (key in obj) errors.push(...validateSchema(obj[key], sub, `${path}.${key}`))
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// 2. 确定性硬检查
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning'

export interface Finding {
  ruleId: string
  severity: Severity
  message: string
  path?: string
}

/** ADP 结构的宽松类型化视图（对应 architecture-decision-packet.schema.json）。 */
export interface DshPlacement {
  implementation_kind?: string
  domain_owner?: string
  seam_disposition?: string
  existing_runtime_owners?: Record<string, string>
  dsh_concepts?: { references?: string[]; redefines?: string[] }
  event_mapping?: { domain_mutations?: string[]; model_visible_projection?: string[]; live_execution_signals?: string[] }
  public_service_justification?: { current_consumers?: string[]; independent_role_evolution?: string[] }
}

export interface StateRecord {
  name?: string
  authoritative_owner?: string
  durability?: string
  restart_recovery?: string
  replay?: string
  cancellation?: string
}

export interface AdpLike {
  id?: string
  revision?: number
  task?: {
    raw_requirement_ref?: string
    desired_outcomes?: string[]
    non_goals?: string[]
    scope?: string[]
    risk_tier?: string
    classifications?: string[]
  }
  evidence?: { capsule_id?: string; required_refs?: string[]; unresolved_facts?: string[] }
  dsh_placement?: DshPlacement
  alternatives?: Array<{ id?: string; mode?: string; satisfies?: string[]; violates?: string[]; evidence_refs?: string[] }>
  decision?: { selected_alternative?: string; mode?: string; invention_proof?: Record<string, unknown> }
  capability?: {
    service_definition?: Record<string, unknown> | null
    providers?: string[]
    consumers?: string[]
    existing_extension_points?: string[]
  } | null
  state?: StateRecord[]
  lifecycle?: Record<string, unknown>
  boundaries?: Record<string, unknown>
  configuration?: Record<string, unknown> & { owner?: string }
  model_visibility?: { inputs?: string[]; session_event_or_projection?: string[]; replay?: string; compaction?: string }
  observability?: Record<string, unknown>
  proof_obligations?: Array<{
    id?: string
    rule_ids?: string[]
    statement?: string
    evidence_refs?: string[]
    falsification?: string
    verification_refs?: string[]
  }>
  verification?: Record<string, unknown>
  open_questions?: string[]
}

function firstNonEmpty(values: unknown[]): string {
  for (const v of values) if (typeof v === 'string' && v.trim() !== '') return v.trim()
  return ''
}

/** 8 条既有高频硬检查（Phase 0；docs/dsh-post-training-system-design.md §13）。 */
export function checkKernelRules(adp: AdpLike): Finding[] {
  const findings: Finding[] = []
  const kind = adp?.dsh_placement?.implementation_kind
  const isNewSeam = kind === 'new-seam'
  const isDomainComponent = kind === 'domain-component'
  const needsCapability = isNewSeam
  const hasDurableState = Array.isArray(adp?.state) && adp.state.some((s: StateRecord) =>
    s?.durability === 'domain-store' || s?.durability === 'external')

  // 证据 pin（C01）
  const capsuleId = adp?.evidence?.capsule_id
  if (typeof capsuleId !== 'string' || !capsuleId.startsWith('evidence:')) {
    findings.push({ ruleId: 'evidence.pin', severity: 'error', path: 'evidence.capsule_id', message: 'Evidence Capsule ID 未锁定（须以 evidence: 开头）' })
  }
  const refs = adp?.evidence?.required_refs
  if (!Array.isArray(refs) || refs.length === 0) {
    findings.push({ ruleId: 'evidence.source-refs', severity: 'error', path: 'evidence.required_refs', message: '缺少当前 revision 的来源指针' })
  }

  // seam 三角色（C03）——仅 new-seam 强制
  if (needsCapability) {
    const cap = adp?.capability
    const sd = cap?.service_definition
    const providers = cap?.providers
    const consumers = cap?.consumers
    if (!sd || !sd.service_key) findings.push({ ruleId: 'seam.service-definition', severity: 'error', path: 'capability.service_definition', message: 'new-seam 必须有 Service Definition（package/service_key/vocabulary）' })
    if (!Array.isArray(providers) || providers.length === 0) findings.push({ ruleId: 'seam.provider', severity: 'error', path: 'capability.providers', message: 'new-seam 必须声明 Service Provider' })
    if (!Array.isArray(consumers) || consumers.length === 0) findings.push({ ruleId: 'seam.consumer', severity: 'error', path: 'capability.consumers', message: 'new-seam 必须声明当前 Consumer' })
  }

  // 唯一 owner（C04）
  if (Array.isArray(adp?.state)) {
    const seen = new Map<string, string>()
    for (const s of adp.state) {
      if (!s?.name) continue
      const owner = typeof s.authoritative_owner === 'string' ? s.authoritative_owner : ''
      if (owner === '') findings.push({ ruleId: 'state.owner', severity: 'error', path: `state.${s.name}`, message: '状态缺少 authoritative owner' })
      if (seen.has(s.name) && seen.get(s.name) !== owner) {
        findings.push({ ruleId: 'state.owner-conflict', severity: 'error', path: `state.${s.name}`, message: `同名状态 owner 冲突：${seen.get(s.name)} vs ${owner}` })
      }
      seen.set(s.name, owner)
    }
  }

  // effect/dispose（C05）——需要生命周期的实现形态
  if (isNewSeam || isDomainComponent) {
    const lc = adp?.lifecycle ?? {}
    for (const key of ['register', 'activate', 'dispose_to_quiescence']) {
      if (firstNonEmpty([lc[key]]) === '') findings.push({ ruleId: 'lifecycle.effect', severity: 'error', path: `lifecycle.${key}`, message: `生命周期必须说明 ${key}` })
    }
  }

  // durable recovery/replay（C07）
  if (hasDurableState) {
    for (const s of adp.state) {
      if (s.durability !== 'domain-store' && s.durability !== 'external') continue
      for (const key of ['restart_recovery', 'replay', 'cancellation']) {
        if (firstNonEmpty([s[key]]) === '') findings.push({ ruleId: 'durable.recovery', severity: 'error', path: `state.${s.name}.${key}`, message: `durable state 必须说明 ${key}` })
      }
    }
  }

  // model-visible log（C06）
  const mvInputs = adp?.model_visibility?.inputs
  if (Array.isArray(mvInputs) && mvInputs.length > 0) {
    const projection = adp?.model_visibility?.session_event_or_projection
    if (!Array.isArray(projection) || projection.length === 0) {
      findings.push({ ruleId: 'model-visible.session-log', severity: 'error', path: 'model_visibility.session_event_or_projection', message: '进入模型请求的内容必须可由 session log 重建' })
    }
  }

  // configuration owner（C08）
  if (typeof adp?.configuration?.owner !== 'string' || adp.configuration.owner === '') {
    findings.push({ ruleId: 'configuration.owner', severity: 'error', path: 'configuration.owner', message: '配置必须声明 owner' })
  }

  // invention proof（C10）
  if (adp?.decision?.mode === 'invent') {
    const proof = adp?.decision?.invention_proof ?? {}
    for (const key of ['inspected_existing_seams', 'rejected_adaptations', 'missing_capability', 'why_composition_is_insufficient', 'approval_ref']) {
      if (firstNonEmpty([proof[key]]) === '') findings.push({ ruleId: 'invention.proof', severity: 'error', path: `decision.invention_proof.${key}`, message: `invent 必须提供 ${key}` })
    }
  }

  return findings
}

/** 新版 6 条 DSH placement 确定性检查（docs/dsh-post-training-system-design.md §B9）。 */
export function checkPlacementRules(adp: AdpLike): Finding[] {
  const findings: Finding[] = []
  const p = adp?.dsh_placement
  if (!p) {
    findings.push({ ruleId: 'placement.missing', severity: 'error', path: 'dsh_placement', message: '缺少 dsh_placement 一节（先决定 DSH 落点）' })
    return findings
  }

  // placement.redefined-dsh-concept：redefines 非空直接拒绝
  const redefines = p?.dsh_concepts?.redefines
  if (Array.isArray(redefines) && redefines.length > 0) {
    findings.push({
      ruleId: 'placement.redefined-dsh-concept', severity: 'error', path: 'dsh_placement.dsh_concepts.redefines',
      message: `重定义 DSH 核心概念：${redefines.join(', ')}；删除平行身份，通过引用/组合/现有 Consumer 接入 DSH`,
    })
  }

  // placement.parallel-runtime：领域抽象重新拥有 Agent/Session/Tool/LLM 生命周期
  const forbiddenOwners = new Set(['agent', 'session', 'tool', 'toolregistry', 'llm', 'sessioneventdomain'])
  const signals: string[] = [
    ...(p?.event_mapping?.domain_mutations ?? []),
    ...(p?.event_mapping?.live_execution_signals ?? []),
  ]
  const parallelSignal = signals.find(sig => forbiddenOwners.has(sig.toLowerCase().replace(/[^a-z]/g, '')))
  const ownedByKernel = Array.isArray(adp?.state) && adp.state.some((s: StateRecord) => {
    const o = (s?.authoritative_owner ?? '').toLowerCase()
    const normalized = o.replace(/[\s_]+/g, '-')
    return normalized.includes('cognitive-kernel') || normalized.includes('agent-runtime') || forbiddenOwners.has(o.replace(/[^a-z]/g, ''))
  })
  if (parallelSignal || ownedByKernel) {
    findings.push({
      ruleId: 'placement.parallel-runtime', severity: 'error', path: 'dsh_placement.event_mapping',
      message: '领域抽象重新拥有或重定义 DSH 运行时生命周期；只引用 ctx.agents/ctx.sessions/ctx.tools/ctx.llm 等现有 owner',
    })
  }

  // placement.unjustified-public-service：新 public Service 无当前 Consumer / 独立演化证据
  const cap = adp?.capability
  if (cap && typeof cap.service_definition === 'object' && cap.service_definition !== null) {
    const justification = p?.public_service_justification
    const consumers = Array.isArray(cap.consumers) ? cap.consumers : []
    const currentConsumers = Array.isArray(justification?.current_consumers) ? justification.current_consumers : []
    const roleEvolution = Array.isArray(justification?.independent_role_evolution) ? justification.independent_role_evolution : []
    if (currentConsumers.length === 0 || roleEvolution.length === 0) {
      findings.push({
        ruleId: 'placement.unjustified-public-service', severity: 'error', path: 'dsh_placement.public_service_justification',
        message: 'public Service 必须给出当前 Consumer 与角色独立演化证据；否则改私有 capability closure',
      })
    } else if (consumers.length <= 1) {
      findings.push({
        ruleId: 'placement.unjustified-public-service', severity: 'warning', path: 'capability.consumers',
        message: '仅一个内部调用方，若无可替换需求可保留为私有 capability closure',
      })
    }
  }

  // placement.event-domain-collapse：领域 mutation 被映射为通用 DSH event；或 model-visible projection 无可回放 SessionEvent
  const mvProjection = p?.event_mapping?.model_visible_projection ?? []
  const sessionProjection = adp?.model_visibility?.session_event_or_projection ?? []
  if (Array.isArray(mvProjection) && mvProjection.length > 0 && sessionProjection.length === 0) {
    findings.push({
      ruleId: 'placement.event-domain-collapse', severity: 'error', path: 'dsh_placement.event_mapping.model_visible_projection',
      message: 'model-visible projection 必须有可回放的 SessionEvent；分开 domain mutation 与 live capability event',
    })
  }
  const domainMutations = p?.event_mapping?.domain_mutations ?? []
  if (Array.isArray(domainMutations) && domainMutations.some((m: string) => /session.?event/i.test(m))) {
    findings.push({
      ruleId: 'placement.event-domain-collapse', severity: 'error', path: 'dsh_placement.event_mapping.domain_mutations',
      message: '普通领域 mutation 不得映射为通用 DSH event（SessionEvent）',
    })
  }

  // placement.visual-branch-fork：仅 UI 分支展示就声明 Session fork，无 durable history divergence
  const forkClaims = [
    ...(adp?.model_visibility?.session_event_or_projection ?? []),
    ...(adp?.model_visibility?.inputs ?? []),
  ].filter((v: string) => typeof v === 'string' && /\bsession\s*fork\b/i.test(v))
  if (forkClaims.length > 0) {
    const hasHistoryDivergence = Array.isArray(adp?.state) && adp.state.some((s: StateRecord) =>
      s?.durability === 'session-log' && /\bdivergence\b/i.test(JSON.stringify(s)))
    if (!hasHistoryDivergence) {
      findings.push({
        ruleId: 'placement.visual-branch-fork', severity: 'error', path: 'model_visibility',
        message: '声明 Session fork 但没有 durable history divergence；UI 分支应使用领域分支引用',
      })
    }
  }

  // placement.settings-domain-data：领域记录/workspace graph/运行结果存进 Settings
  const cfgText = JSON.stringify(adp?.configuration ?? {})
  const hasDomainState = Array.isArray(adp?.state) && adp.state.length > 0
  if (hasDomainState && /settings/i.test(cfgText)) {
    findings.push({
      ruleId: 'placement.settings-domain-data', severity: 'error', path: 'configuration',
      message: '领域记录/运行结果不得存入 Settings；Settings 只保存用户可调部署参数',
    })
  }

  return findings
}

// ---------------------------------------------------------------------------
// 3. 组合校验
// ---------------------------------------------------------------------------

export interface ValidateResult {
  ok: boolean
  schemaErrors: SchemaError[]
  findings: Finding[]
}

/** 读取并解析 YAML/JSON 文件。 */
export function loadAdpFile(file: string): AdpLike {
  const raw = readFileSync(file, 'utf8')
  return loadYaml(raw)
}

/** 读取 schema 文件。 */
export function loadSchema(name: string): unknown {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8'))
}

export function validateAdp(adp: unknown, schema: unknown): ValidateResult {
  const schemaErrors = validateSchema(adp, schema)
  const findings: Finding[] = []
  if (schemaErrors.length === 0) {
    findings.push(...checkKernelRules(adp as AdpLike))
    findings.push(...checkPlacementRules(adp as AdpLike))
  }
  const hasError = (f: Finding) => f.severity === 'error'
  const ok = schemaErrors.length === 0 && findings.filter(hasError).length === 0
  return { ok, schemaErrors, findings }
}

/** 校验 Evidence Capsule（docs/dsh-post-training-system-design.md §4）。 */
export interface EvidenceValidation {
  ok: boolean
  errors: SchemaError[]
}

export function validateEvidence(evidence: unknown, schema: unknown): EvidenceValidation {
  const errors = validateSchema(evidence, schema)
  return { ok: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// CLI：node scripts/dsh-intelligence/validate-adp.ts <adp.yaml>
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2)
  const evidenceIdx = args.indexOf('--evidence')
  if (evidenceIdx >= 0) {
    const file = args[evidenceIdx + 1]
    if (!file) {
      console.error('usage: validate-adp.ts --evidence <evidence.json>')
      process.exit(2)
    }
    const evidence = loadAdpFile(file)
    const schema = loadSchema('evidence-capsule.schema.json')
    const result = validateEvidence(evidence, schema)
    for (const e of result.errors) console.error(`[schema] ${e.path}: ${e.message}`)
    console.log(result.ok ? 'PASS' : 'FAIL')
    process.exit(result.ok ? 0 : 1)
  }

  const file = args[0]
  if (!file) {
    console.error('usage: validate-adp.ts <adp.yaml> | --evidence <evidence.json>')
    process.exit(2)
  }
  const adp = loadAdpFile(file)
  const schema = loadSchema('architecture-decision-packet.schema.json')
  const result = validateAdp(adp, schema)
  for (const e of result.schemaErrors) console.error(`[schema] ${e.path}: ${e.message}`)
  for (const f of result.findings) console.error(`[${f.ruleId}] ${f.severity}: ${f.message}${f.path ? ` (${f.path})` : ''}`)
  console.log(result.ok ? 'PASS' : 'FAIL')
  process.exit(result.ok ? 0 : 1)
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isMain) {
  main()
}
