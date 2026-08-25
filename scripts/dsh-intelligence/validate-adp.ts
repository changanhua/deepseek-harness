/**
 * validate-adp.ts — Architecture Decision Packet 机器校验
 *
 * 两层校验，先于语义 Review，不能用说明文字豁免：
 *  1. schema 校验（本仓库 schema 使用到的 JSON Schema 子集）
 *  2. 确定性硬检查：Kernel + DSH placement + Evidence 绑定
 *
 * 本脚本自身是 repo-tool（见 .agents/dsh-intelligence/self-adp.yaml）。
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = join(__dirname, '..', '..', '.agents', 'dsh-intelligence', 'schemas')
const EVIDENCE_ID_RE = /^evidence:/
const FULL_SHA_RE = /^[0-9a-f]{40}$/

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

/** 校验 `value` 是否符合本项目 schema 用到的 JSON Schema 子集。 */
export function validateSchema(value: unknown, schema: unknown, path = '$'): SchemaError[] {
  const errors: SchemaError[] = []
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return errors
  const s = schema as Record<string, unknown>

  if (typeof s.const !== 'undefined') {
    if (value !== s.const) errors.push({ path, message: `expected const ${JSON.stringify(s.const)}` })
    return errors
  }

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type as string[] : [s.type as string]
    if (!types.some(type => typeMatches(value, type))) {
      errors.push({ path, message: `expected type ${types.join('|')}` })
      return errors
    }
  }

  if (typeof value === 'string') {
    if (Array.isArray(s.enum) && !s.enum.includes(value)) {
      errors.push({ path, message: `value ${JSON.stringify(value)} not in enum` })
    }
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(value)) {
      errors.push({ path, message: `value ${JSON.stringify(value)} does not match ${s.pattern}` })
    }
    if (typeof s.minLength === 'number' && value.length < s.minLength) {
      errors.push({ path, message: `string shorter than minLength ${s.minLength}` })
    }
    if (s.format === 'date-time' && !DATE_TIME_RE.test(value)) {
      errors.push({ path, message: `value ${JSON.stringify(value)} is not a valid date-time` })
    }
  }

  if (typeof value === 'number' && typeof s.minimum === 'number' && value < s.minimum) {
    errors.push({ path, message: `value ${value} below minimum ${s.minimum}` })
  }

  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) {
      errors.push({ path, message: `array shorter than minItems ${s.minItems}` })
    }
    if (s.items !== undefined) {
      value.forEach((item, index) => {
        errors.push(...validateSchema(item, s.items, `${path}[${index}]`))
      })
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if (Array.isArray(s.required)) {
      for (const key of s.required as string[]) {
        if (!(key in obj)) errors.push({ path: `${path}.${key}`, message: `missing required property ${key}` })
      }
    }
    if (s.properties !== undefined && typeof s.properties === 'object') {
      for (const [key, subSchema] of Object.entries(s.properties as Record<string, unknown>)) {
        if (key in obj) errors.push(...validateSchema(obj[key], subSchema, `${path}.${key}`))
      }
    }
  }

  return errors
}

export type Severity = 'error' | 'warning'

export interface Finding {
  ruleId: string
  severity: Severity
  message: string
  path?: string
}

export interface DshPlacement {
  implementation_kind?: string
  domain_owner?: string
  seam_disposition?: string
  existing_runtime_owners?: Record<string, string>
  dsh_concepts?: { references?: string[]; redefines?: string[] }
  event_mapping?: {
    domain_mutations?: string[]
    model_visible_projection?: string[]
    live_execution_signals?: string[]
  }
  public_service_justification?: {
    current_consumers?: string[]
    independent_role_evolution?: string[]
  }
}

export interface StateRecord {
  name?: string
  authoritative_owner?: string
  source_of_truth?: string
  durability?: string
  mutation_serialization?: string
  restart_recovery?: string
  replay?: string
  cancellation?: string
  terminal_states?: string[]
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
  decision?: {
    selected_alternative?: string
    mode?: string
    invention_proof?: Record<string, unknown>
  }
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
  model_visibility?: {
    inputs?: string[]
    session_event_or_projection?: string[]
    replay?: string
    compaction?: string
  }
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

export interface EvidenceCapsuleLike {
  id?: string
  target_snapshot?: {
    repository?: string
    revision?: string
    branch?: string
    profile?: string
    host_scope?: string
  }
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Kernel 高频硬检查。 */
export function checkKernelRules(adp: AdpLike): Finding[] {
  const findings: Finding[] = []
  const kind = adp.dsh_placement?.implementation_kind
  const isNewSeam = kind === 'new-seam'
  const isDomainComponent = kind === 'domain-component'
  const hasDurableState = Array.isArray(adp.state) && adp.state.some(state =>
    ['session-log', 'domain-store', 'external'].includes(state.durability ?? ''))

  const capsuleId = adp.evidence?.capsule_id
  if (!nonEmptyString(capsuleId) || !EVIDENCE_ID_RE.test(capsuleId ?? '')) {
    findings.push({
      ruleId: 'evidence.pin', severity: 'error', path: 'evidence.capsule_id',
      message: 'Evidence Capsule ID 未锁定（须以 evidence: 开头）',
    })
  }
  if (!nonEmptyArray(adp.evidence?.required_refs)) {
    findings.push({
      ruleId: 'evidence.source-refs', severity: 'error', path: 'evidence.required_refs',
      message: '缺少当前 revision 的来源指针',
    })
  }

  if (isNewSeam) {
    const cap = adp.capability
    const serviceDefinition = cap?.service_definition
    if (!serviceDefinition || !nonEmptyString(serviceDefinition['service_key'])) {
      findings.push({
        ruleId: 'seam.service-definition', severity: 'error', path: 'capability.service_definition',
        message: 'new-seam 必须有 Service Definition（package/service_key/vocabulary）',
      })
    }
    if (!nonEmptyArray(cap?.providers)) {
      findings.push({ ruleId: 'seam.provider', severity: 'error', path: 'capability.providers', message: 'new-seam 必须声明 Service Provider' })
    }
    if (!nonEmptyArray(cap?.consumers)) {
      findings.push({ ruleId: 'seam.consumer', severity: 'error', path: 'capability.consumers', message: 'new-seam 必须声明当前 Consumer' })
    }
  }

  if (Array.isArray(adp.state)) {
    const seen = new Map<string, string>()
    for (const state of adp.state) {
      if (!nonEmptyString(state.name)) continue
      const name = state.name as string
      const owner = nonEmptyString(state.authoritative_owner) ? state.authoritative_owner as string : ''
      if (owner === '') {
        findings.push({ ruleId: 'state.owner', severity: 'error', path: `state.${name}`, message: '状态缺少 authoritative owner' })
      }
      if (seen.has(name) && seen.get(name) !== owner) {
        findings.push({
          ruleId: 'state.owner-conflict', severity: 'error', path: `state.${name}`,
          message: `同名状态 owner 冲突：${seen.get(name)} vs ${owner}`,
        })
      }
      seen.set(name, owner)
    }
  }

  if (isNewSeam || isDomainComponent) {
    const lifecycle = adp.lifecycle ?? {}
    for (const key of ['register', 'activate', 'dispose_to_quiescence']) {
      if (!nonEmptyString(lifecycle[key])) {
        findings.push({ ruleId: 'lifecycle.effect', severity: 'error', path: `lifecycle.${key}`, message: `生命周期必须说明 ${key}` })
      }
    }
  }

  if (hasDurableState && Array.isArray(adp.state)) {
    for (const state of adp.state) {
      if (!['session-log', 'domain-store', 'external'].includes(state.durability ?? '')) continue
      for (const key of ['restart_recovery', 'replay', 'cancellation'] as const) {
        if (!nonEmptyString(state[key])) {
          findings.push({
            ruleId: 'durable.recovery', severity: 'error', path: `state.${state.name ?? 'unknown'}.${key}`,
            message: `durable state 必须说明 ${key}`,
          })
        }
      }
    }
  }

  if (nonEmptyArray(adp.model_visibility?.inputs) && !nonEmptyArray(adp.model_visibility?.session_event_or_projection)) {
    findings.push({
      ruleId: 'model-visible.session-log', severity: 'error', path: 'model_visibility.session_event_or_projection',
      message: '进入模型请求的内容必须可由 session log 重建',
    })
  }

  if (!nonEmptyString(adp.configuration?.owner)) {
    findings.push({ ruleId: 'configuration.owner', severity: 'error', path: 'configuration.owner', message: '配置必须声明 owner' })
  }

  if (adp.decision?.mode === 'invent') {
    const proof = adp.decision.invention_proof ?? {}
    for (const key of ['inspected_existing_seams', 'rejected_adaptations']) {
      if (!nonEmptyArray(proof[key])) {
        findings.push({ ruleId: 'invention.proof', severity: 'error', path: `decision.invention_proof.${key}`, message: `invent 必须提供非空 ${key}` })
      }
    }
    for (const key of ['missing_capability', 'why_composition_is_insufficient', 'approval_ref']) {
      if (!nonEmptyString(proof[key])) {
        findings.push({ ruleId: 'invention.proof', severity: 'error', path: `decision.invention_proof.${key}`, message: `invent 必须提供 ${key}` })
      }
    }
  }

  return findings
}

/** DSH placement 确定性检查。 */
export function checkPlacementRules(adp: AdpLike): Finding[] {
  const findings: Finding[] = []
  const placement = adp.dsh_placement
  if (!placement) {
    findings.push({ ruleId: 'placement.missing', severity: 'error', path: 'dsh_placement', message: '缺少 dsh_placement 一节（先决定 DSH 落点）' })
    return findings
  }

  if (nonEmptyArray(placement.dsh_concepts?.redefines)) {
    findings.push({
      ruleId: 'placement.redefined-dsh-concept', severity: 'error', path: 'dsh_placement.dsh_concepts.redefines',
      message: `重定义 DSH 核心概念：${placement.dsh_concepts?.redefines?.join(', ')}；删除平行身份，通过引用/组合/现有 Consumer 接入 DSH`,
    })
  }

  const forbiddenOwners = new Set(['agent', 'session', 'tool', 'toolregistry', 'llm', 'sessioneventdomain'])
  const signals = [
    ...(placement.event_mapping?.domain_mutations ?? []),
    ...(placement.event_mapping?.live_execution_signals ?? []),
  ]
  const parallelSignal = signals.find(signal => forbiddenOwners.has(normalized(signal)))
  const ownedByUmbrella = Array.isArray(adp.state) && adp.state.some(state => {
    const owner = normalized(state.authoritative_owner ?? '')
    return owner.includes('cognitivekernel') || owner.includes('agentruntime') || forbiddenOwners.has(owner)
  })
  if (parallelSignal || ownedByUmbrella) {
    findings.push({
      ruleId: 'placement.parallel-runtime', severity: 'error', path: 'dsh_placement.event_mapping',
      message: '领域抽象重新拥有或重定义 DSH 运行时生命周期；只引用 ctx.agents/ctx.sessions/ctx.tools/ctx.llm 等现有 owner',
    })
  }

  const capability = adp.capability
  if (capability?.service_definition) {
    const justification = placement.public_service_justification
    const currentConsumers = justification?.current_consumers ?? []
    const roleEvolution = justification?.independent_role_evolution ?? []
    if (!nonEmptyArray(currentConsumers) || !nonEmptyArray(roleEvolution)) {
      findings.push({
        ruleId: 'placement.unjustified-public-service', severity: 'error', path: 'dsh_placement.public_service_justification',
        message: 'public Service 必须给出当前 Consumer 与角色独立演化证据；否则改私有 capability closure',
      })
    } else if ((capability.consumers ?? []).length <= 1) {
      findings.push({
        ruleId: 'placement.unjustified-public-service', severity: 'warning', path: 'capability.consumers',
        message: '仅一个内部调用方，若无可替换需求可保留为私有 capability closure',
      })
    }
  }

  if (placement.seam_disposition === 'compose') {
    if (!nonEmptyArray(capability?.existing_extension_points)) {
      findings.push({
        ruleId: 'placement.compose-without-existing-seams', severity: 'error', path: 'capability.existing_extension_points',
        message: 'compose 必须列出实际复用的现有 extension points / seams；否则无法证明是组合而非隐式 invention',
      })
    }
  }

  const modelVisibleProjection = placement.event_mapping?.model_visible_projection ?? []
  const sessionProjection = adp.model_visibility?.session_event_or_projection ?? []
  if (nonEmptyArray(modelVisibleProjection) && !nonEmptyArray(sessionProjection)) {
    findings.push({
      ruleId: 'placement.event-domain-collapse', severity: 'error', path: 'dsh_placement.event_mapping.model_visible_projection',
      message: 'model-visible projection 必须有可回放的 SessionEvent；分开 domain mutation 与 live capability event',
    })
  }
  if ((placement.event_mapping?.domain_mutations ?? []).some(mutation => /session.?event/i.test(mutation))) {
    findings.push({
      ruleId: 'placement.event-domain-collapse', severity: 'error', path: 'dsh_placement.event_mapping.domain_mutations',
      message: '普通领域 mutation 不得映射为通用 DSH SessionEvent',
    })
  }

  const forkClaims = [
    ...(adp.model_visibility?.session_event_or_projection ?? []),
    ...(adp.model_visibility?.inputs ?? []),
  ].filter(value => /\bsession\s*fork\b/i.test(value))
  if (forkClaims.length > 0) {
    const hasHistoryDivergence = Array.isArray(adp.state) && adp.state.some(state =>
      state.durability === 'session-log' && /\bdivergence\b/i.test(JSON.stringify(state)))
    if (!hasHistoryDivergence) {
      findings.push({
        ruleId: 'placement.visual-branch-fork', severity: 'error', path: 'model_visibility',
        message: '声明 Session fork 但没有 durable history divergence；UI 分支应使用领域分支引用',
      })
    }
  }

  if (Array.isArray(adp.state)) {
    const settingsOwnedState = adp.state.find(state => {
      const source = `${state.source_of_truth ?? ''} ${state.authoritative_owner ?? ''}`
      return /(^|[^a-z])(?:ctx\.)?settings([^a-z]|$)/i.test(source)
    })
    if (settingsOwnedState) {
      findings.push({
        ruleId: 'placement.settings-domain-data', severity: 'error', path: `state.${settingsOwnedState.name ?? 'unknown'}`,
        message: '领域记录/运行结果不得由 Settings 作为 source of truth；Settings 只保存用户可调参数',
      })
    }
  }

  return findings
}

export interface ValidateResult {
  ok: boolean
  schemaErrors: SchemaError[]
  findings: Finding[]
}

export interface EvidenceValidation {
  ok: boolean
  errors: SchemaError[]
}

/** 读取并解析 YAML/JSON 文件。 */
export function loadAdpFile(file: string): unknown {
  return loadYaml(readFileSync(file, 'utf8'))
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
  return {
    ok: schemaErrors.length === 0 && findings.every(finding => finding.severity !== 'error'),
    schemaErrors,
    findings,
  }
}

export function validateEvidence(evidence: unknown, schema: unknown): EvidenceValidation {
  const errors = validateSchema(evidence, schema)
  return { ok: errors.length === 0, errors }
}

/** 把 Evidence Capsule 与消费它的 ADP 作为一个协议整体校验。 */
export function validateAdpWithEvidence(
  adp: unknown,
  evidence: unknown,
  adpSchema: unknown,
  evidenceSchema: unknown,
): ValidateResult {
  const result = validateAdp(adp, adpSchema)
  const evidenceCheck = validateEvidence(evidence, evidenceSchema)
  const schemaErrors = [
    ...result.schemaErrors,
    ...evidenceCheck.errors.map(error => ({ path: `evidence-file${error.path.slice(1)}`, message: error.message })),
  ]
  const findings = [...result.findings]

  if (evidenceCheck.ok && adp !== null && typeof adp === 'object' && evidence !== null && typeof evidence === 'object') {
    const adpView = adp as AdpLike
    const evidenceView = evidence as EvidenceCapsuleLike
    if (adpView.evidence?.capsule_id !== evidenceView.id) {
      findings.push({
        ruleId: 'evidence.binding', severity: 'error', path: 'evidence.capsule_id',
        message: `ADP 引用 ${adpView.evidence?.capsule_id ?? '<missing>'}，但提供的 Evidence Capsule 是 ${evidenceView.id ?? '<missing>'}`,
      })
    }
    const revision = evidenceView.target_snapshot?.revision ?? ''
    if (!FULL_SHA_RE.test(revision)) {
      findings.push({ ruleId: 'evidence.revision', severity: 'error', path: 'target_snapshot.revision', message: 'Evidence revision 必须是完整 40 位 Git SHA' })
    } else if (evidenceView.id !== `evidence:${revision.slice(0, 12)}`) {
      findings.push({
        ruleId: 'evidence.identity', severity: 'error', path: 'id',
        message: 'Evidence ID 必须由 target revision 前 12 位确定性派生',
      })
    }
    if (adpView.dsh_placement?.implementation_kind !== 'repo-tool' && !nonEmptyString(evidenceView.target_snapshot?.profile)) {
      findings.push({
        ruleId: 'evidence.profile', severity: 'error', path: 'target_snapshot.profile',
        message: '非 repo-tool 设计必须锁定目标 profile；未锁定时不得进入设计',
      })
    }
  }

  return {
    ok: schemaErrors.length === 0 && findings.every(finding => finding.severity !== 'error'),
    schemaErrors,
    findings,
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index >= 0) return args[index + 1]
  const equal = args.find(arg => arg.startsWith(`${flag}=`))
  return equal?.slice(flag.length + 1)
}

function printResult(result: ValidateResult): void {
  for (const error of result.schemaErrors) console.error(`[schema] ${error.path}: ${error.message}`)
  for (const finding of result.findings) {
    console.error(`[${finding.ruleId}] ${finding.severity}: ${finding.message}${finding.path ? ` (${finding.path})` : ''}`)
  }
  console.log(result.ok ? 'PASS' : 'FAIL')
}

function main(): void {
  const args = process.argv.slice(2)
  const evidenceFile = argValue(args, '--evidence')
  const positional = args.filter((arg, index) => {
    if (arg === '--evidence') return false
    if (index > 0 && args[index - 1] === '--evidence') return false
    return !arg.startsWith('--evidence=')
  })
  const adpFile = positional[0]

  if (!adpFile && evidenceFile) {
    const evidence = loadAdpFile(evidenceFile)
    const result = validateEvidence(evidence, loadSchema('evidence-capsule.schema.json'))
    for (const error of result.errors) console.error(`[schema] ${error.path}: ${error.message}`)
    console.log(result.ok ? 'PASS' : 'FAIL')
    process.exit(result.ok ? 0 : 1)
  }

  if (!adpFile) {
    console.error('usage: validate-adp.ts <adp.yaml> [--evidence <evidence.json>] | --evidence <evidence.json>')
    process.exit(2)
  }

  const adp = loadAdpFile(adpFile)
  const adpSchema = loadSchema('architecture-decision-packet.schema.json')
  const result = evidenceFile
    ? validateAdpWithEvidence(adp, loadAdpFile(evidenceFile), adpSchema, loadSchema('evidence-capsule.schema.json'))
    : validateAdp(adp, adpSchema)
  printResult(result)
  process.exit(result.ok ? 0 : 1)
}

const isMain = process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isMain) main()
