import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

export type EvidenceOutcome = 'pass' | 'partial' | 'fail'
export type CapabilityState = 'strong' | 'partial' | 'weak' | 'insufficient evidence'

export interface CurriculumUnit {
  id: string
  type: string
  path: string
  trains: string[]
  prerequisites: string[]
  evidence: string[]
  reveal_policy?: string
}

export interface Curriculum {
  version: number
  name: string
  target_level?: string
  capabilities: Record<string, { description?: string }>
  units: CurriculumUnit[]
  routing?: {
    default_path?: string[]
    rules?: string[]
  }
  assessment?: {
    no_manual_progress_file?: boolean
  }
}

export interface EvidenceRecord {
  version: number
  unit: string
  capabilities?: string[]
  recorded_at: string
  source?: {
    repository?: string
    commit?: string
  }
  attempt?: {
    prompt_or_task?: string
    prediction_before_reveal?: string
  }
  observations?: Array<{
    claim?: string
    evidence?: string
  }>
  verification?: {
    method?: string
    result?: EvidenceOutcome
  }
  evidence_items?: Record<string, EvidenceOutcome>
  assessment?: {
    strengths?: string[]
    misconceptions?: string[]
    demonstrated?: Record<string, EvidenceOutcome>
    routing?: {
      ready_for?: string[]
      revisit?: string[]
    }
  }
  artifacts?: {
    commits?: string[]
    files?: string[]
    prs?: string[]
  }
}

export interface LoadedEvidence {
  path: string
  record: EvidenceRecord
}

export interface ValidationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface UnitStatus {
  unit: CurriculumUnit
  complete: boolean
  evidenceItems: Record<string, EvidenceOutcome | 'missing'>
  attempts: number
}

export interface CapabilityStatus {
  capability: string
  state: CapabilityState
  latest?: EvidenceOutcome
  passUnits: string[]
  evidenceFiles: string[]
}

export interface NextRecommendation {
  unit: CurriculumUnit
  reason: string
  unmetEvidence: string[]
}

const SOURCE_GROUNDED_CAPABILITIES = new Set(['source_navigation', 'request_tracing'])
const CASE_INDEPENDENCE_ITEM = 'independent_design_before_reveal'

export function defaultLabRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOutcome(value: unknown): value is EvidenceOutcome {
  return value === 'pass' || value === 'partial' || value === 'fail'
}

async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8')
  // JSON_SCHEMA deliberately keeps YAML timestamps as strings. Evidence is a
  // repository protocol, not a js-yaml object graph whose scalar types may
  // depend on implicit timestamp coercion.
  return yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as T
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function listYamlFiles(dir: string): Promise<string[]> {
  if (!await fileExists(dir)) return []
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...await listYamlFiles(entryPath))
      continue
    }
    if (/\.ya?ml$/i.test(entry.name)) out.push(entryPath)
  }
  return out.sort()
}

function evidenceSortKey(item: LoadedEvidence): string {
  const timestamp = Date.parse(item.record.recorded_at)
  const timeKey = Number.isNaN(timestamp)
    ? item.record.recorded_at
    : timestamp.toString().padStart(15, '0')
  return `${timeKey}\u0000${item.path}`
}

export async function loadCurriculum(root = defaultLabRoot()): Promise<Curriculum> {
  return readYaml<Curriculum>(path.join(root, 'CURRICULUM.yaml'))
}

export async function loadEvidence(root = defaultLabRoot()): Promise<LoadedEvidence[]> {
  const evidenceDir = path.join(root, 'evidence')
  const files = await listYamlFiles(evidenceDir)
  const records: LoadedEvidence[] = []
  for (const file of files) {
    records.push({
      path: path.relative(root, file).replaceAll(path.sep, '/'),
      record: await readYaml<EvidenceRecord>(file),
    })
  }
  return records.sort((a, b) => evidenceSortKey(a).localeCompare(evidenceSortKey(b)))
}

export function deriveUnitStatuses(curriculum: Curriculum, evidence: LoadedEvidence[]): Map<string, UnitStatus> {
  const byUnit = new Map<string, LoadedEvidence[]>()
  for (const item of evidence) {
    const items = byUnit.get(item.record.unit) ?? []
    items.push(item)
    byUnit.set(item.record.unit, items)
  }

  const statuses = new Map<string, UnitStatus>()
  for (const unit of curriculum.units) {
    const latestByItem = new Map<string, EvidenceOutcome>()
    const unitEvidence = (byUnit.get(unit.id) ?? []).sort((a, b) => evidenceSortKey(a).localeCompare(evidenceSortKey(b)))
    for (const item of unitEvidence) {
      for (const [key, outcome] of Object.entries(item.record.evidence_items ?? {})) {
        if (isOutcome(outcome)) latestByItem.set(key, outcome)
      }
    }

    const evidenceItems: Record<string, EvidenceOutcome | 'missing'> = {}
    for (const requirement of unit.evidence) {
      evidenceItems[requirement] = latestByItem.get(requirement) ?? 'missing'
    }
    const complete = unit.evidence.length > 0
      && unit.evidence.every(requirement => evidenceItems[requirement] === 'pass')

    statuses.set(unit.id, {
      unit,
      complete,
      evidenceItems,
      attempts: unitEvidence.length,
    })
  }
  return statuses
}

export function deriveCapabilityStatuses(curriculum: Curriculum, evidence: LoadedEvidence[]): CapabilityStatus[] {
  const observations = new Map<string, Array<{ outcome: EvidenceOutcome; unit: string; file: string }>>()
  for (const item of evidence) {
    for (const [capability, outcome] of Object.entries(item.record.assessment?.demonstrated ?? {})) {
      if (!isOutcome(outcome)) continue
      const values = observations.get(capability) ?? []
      values.push({ outcome, unit: item.record.unit, file: item.path })
      observations.set(capability, values)
    }
  }

  return Object.keys(curriculum.capabilities).sort().map((capability): CapabilityStatus => {
    const values = observations.get(capability) ?? []
    if (values.length === 0) {
      return { capability, state: 'insufficient evidence', passUnits: [], evidenceFiles: [] }
    }
    // Guarded by the non-empty branch above; avoid optional-undefined leaking
    // into exactOptionalPropertyTypes output.
    const latest = values.at(-1)!.outcome
    const passUnits = [...new Set(values.filter(item => item.outcome === 'pass').map(item => item.unit))]
    let state: CapabilityState
    if (latest === 'fail') state = 'weak'
    else if (passUnits.length >= 2) state = 'strong'
    else if (values.some(item => item.outcome === 'pass' || item.outcome === 'partial')) state = 'partial'
    else state = 'weak'
    return {
      capability,
      state,
      latest,
      passUnits,
      evidenceFiles: [...new Set(values.map(item => item.file))],
    }
  })
}

export function recommendNext(curriculum: Curriculum, evidence: LoadedEvidence[]): NextRecommendation | undefined {
  const statuses = deriveUnitStatuses(curriculum, evidence)
  const unitById = new Map(curriculum.units.map(unit => [unit.id, unit]))
  const order = curriculum.routing?.default_path?.length
    ? curriculum.routing.default_path
    : curriculum.units.map(unit => unit.id)

  const findEarliestIncompletePrerequisite = (unit: CurriculumUnit, seen = new Set<string>()): CurriculumUnit | undefined => {
    if (seen.has(unit.id)) return undefined
    seen.add(unit.id)
    for (const prerequisite of unit.prerequisites) {
      const status = statuses.get(prerequisite)
      const prereqUnit = unitById.get(prerequisite)
      if (!status || !prereqUnit) continue
      if (!status.complete) return findEarliestIncompletePrerequisite(prereqUnit, seen) ?? prereqUnit
    }
    return undefined
  }

  for (const unitId of order) {
    const status = statuses.get(unitId)
    const unit = unitById.get(unitId)
    if (!status || !unit || status.complete) continue
    const blockedBy = findEarliestIncompletePrerequisite(unit)
    const candidate = blockedBy ?? unit
    const candidateStatus = statuses.get(candidate.id)
    if (!candidateStatus) continue
    const unmetEvidence = Object.entries(candidateStatus.evidenceItems)
      .filter(([, outcome]) => outcome !== 'pass')
      .map(([item]) => item)
    const reason = candidateStatus.attempts > 0
      ? `continue ${candidate.id}: existing evidence is incomplete or regressed`
      : blockedBy
        ? `${unit.id} is blocked by prerequisite ${candidate.id}`
        : `earliest ready unit on the default path`
    return { unit: candidate, reason, unmetEvidence }
  }
  return undefined
}

export async function validateLab(root = defaultLabRoot()): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  let curriculum: Curriculum
  try {
    curriculum = await loadCurriculum(root)
  } catch (error) {
    return [{ severity: 'error', code: 'curriculum-load', message: String(error), path: 'CURRICULUM.yaml' }]
  }

  if (!isObject(curriculum) || !Array.isArray(curriculum.units) || !isObject(curriculum.capabilities)) {
    return [{ severity: 'error', code: 'curriculum-shape', message: 'CURRICULUM.yaml must define capabilities and units.' }]
  }

  const unitById = new Map<string, CurriculumUnit>()
  for (const unit of curriculum.units) {
    if (unitById.has(unit.id)) {
      issues.push({ severity: 'error', code: 'duplicate-unit', message: `duplicate unit id: ${unit.id}` })
      continue
    }
    unitById.set(unit.id, unit)
    if (!await fileExists(path.join(root, unit.path))) {
      issues.push({ severity: 'error', code: 'missing-unit-path', message: `${unit.id} references missing path ${unit.path}`, path: unit.path })
    }
    for (const capability of unit.trains) {
      if (!(capability in curriculum.capabilities)) {
        issues.push({ severity: 'error', code: 'unknown-capability', message: `${unit.id} trains unknown capability ${capability}` })
      }
    }
  }

  for (const unit of curriculum.units) {
    for (const prerequisite of unit.prerequisites) {
      if (!unitById.has(prerequisite)) {
        issues.push({ severity: 'error', code: 'unknown-prerequisite', message: `${unit.id} references unknown prerequisite ${prerequisite}` })
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (unitId: string, chain: string[]): void => {
    if (visited.has(unitId)) return
    if (visiting.has(unitId)) {
      issues.push({ severity: 'error', code: 'prerequisite-cycle', message: `prerequisite cycle: ${[...chain, unitId].join(' -> ')}` })
      return
    }
    visiting.add(unitId)
    const unit = unitById.get(unitId)
    for (const prerequisite of unit?.prerequisites ?? []) visit(prerequisite, [...chain, unitId])
    visiting.delete(unitId)
    visited.add(unitId)
  }
  for (const unit of curriculum.units) visit(unit.id, [])

  for (const routedId of curriculum.routing?.default_path ?? []) {
    if (!unitById.has(routedId)) {
      issues.push({ severity: 'error', code: 'unknown-routed-unit', message: `routing.default_path references unknown unit ${routedId}` })
    }
  }

  if (curriculum.assessment?.no_manual_progress_file === true) {
    const rootEntries = await readdir(root, { withFileTypes: true })
    for (const entry of rootEntries) {
      if (entry.isFile() && /^progress\.(?:md|ya?ml|json)$/i.test(entry.name)) {
        issues.push({ severity: 'error', code: 'manual-progress-store', message: `manual progress store is forbidden: ${entry.name}`, path: entry.name })
      }
    }
  }

  let evidence: LoadedEvidence[] = []
  try {
    evidence = await loadEvidence(root)
  } catch (error) {
    issues.push({ severity: 'error', code: 'evidence-load', message: String(error), path: 'evidence/' })
    return issues
  }

  const earlierIndependentPass = new Set<string>()
  for (const item of evidence) {
    const { record } = item
    const unit = unitById.get(record.unit)
    if (!unit) {
      issues.push({ severity: 'error', code: 'evidence-unknown-unit', message: `${item.path} references unknown unit ${record.unit}`, path: item.path })
      continue
    }
    if (record.version !== 1) {
      issues.push({ severity: 'error', code: 'evidence-version', message: `${item.path} must use evidence version 1`, path: item.path })
    }
    if (!record.recorded_at || Number.isNaN(Date.parse(record.recorded_at))) {
      issues.push({ severity: 'error', code: 'evidence-recorded-at', message: `${item.path} needs an ISO-compatible recorded_at`, path: item.path })
    }
    if (!isObject(record.evidence_items)) {
      issues.push({ severity: 'error', code: 'evidence-items-missing', message: `${item.path} must define evidence_items`, path: item.path })
    } else {
      for (const [key, outcome] of Object.entries(record.evidence_items)) {
        if (!unit.evidence.includes(key)) {
          issues.push({ severity: 'error', code: 'unknown-evidence-item', message: `${item.path} records unknown evidence item ${key} for ${unit.id}`, path: item.path })
        }
        if (!isOutcome(outcome)) {
          issues.push({ severity: 'error', code: 'invalid-evidence-outcome', message: `${item.path} has invalid outcome for ${key}`, path: item.path })
        }
      }
    }

    for (const capability of record.capabilities ?? []) {
      if (!(capability in curriculum.capabilities)) {
        issues.push({ severity: 'error', code: 'evidence-unknown-capability', message: `${item.path} references unknown capability ${capability}`, path: item.path })
      }
    }
    for (const [capability, outcome] of Object.entries(record.assessment?.demonstrated ?? {})) {
      if (!(capability in curriculum.capabilities)) {
        issues.push({ severity: 'error', code: 'demonstrated-unknown-capability', message: `${item.path} assesses unknown capability ${capability}`, path: item.path })
      }
      if (!isOutcome(outcome)) {
        issues.push({ severity: 'error', code: 'invalid-demonstrated-outcome', message: `${item.path} has invalid demonstrated outcome for ${capability}`, path: item.path })
      }
    }

    if (unit.trains.some(capability => SOURCE_GROUNDED_CAPABILITIES.has(capability))) {
      const commit = record.source?.commit?.trim()
      const repository = record.source?.repository?.trim()
      if (!repository || !commit || commit.includes('<') || commit.length < 7) {
        issues.push({ severity: 'error', code: 'source-pin-required', message: `${item.path} is source-grounded and must pin source.repository + source.commit`, path: item.path })
      }
    }

    if (unit.reveal_policy === 'reconstruct_before_reading_existing_design') {
      const items = record.evidence_items ?? {}
      const revealsDependentWork = Object.entries(items).some(([key, outcome]) => key !== CASE_INDEPENDENCE_ITEM && outcome !== 'fail')
      if (revealsDependentWork && !earlierIndependentPass.has(unit.id)) {
        issues.push({
          severity: 'error',
          code: 'case-revealed-too-early',
          message: `${item.path} records post-reveal case work before an earlier ${CASE_INDEPENDENCE_ITEM}=pass record`,
          path: item.path,
        })
      }
      if (items[CASE_INDEPENDENCE_ITEM] === 'pass') earlierIndependentPass.add(unit.id)
    }
  }

  return issues
}
