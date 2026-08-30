/** validate-adp：协议闭环、negative controls 与 valid counterexamples。 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load as loadYaml } from 'js-yaml'
import { buildSnapshot } from './snapshot.ts'
import {
  checkKernelRules,
  checkPlacementRules,
  loadSchema,
  validateAdp,
  validateAdpWithEvidence,
  type AdpLike,
} from './validate-adp.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SELF_ADP = loadYaml(readFileSync(join(__dirname, '..', '..', '.agents', 'dsh-intelligence', 'self-adp.yaml'), 'utf8'))
const ADP_SCHEMA = loadSchema('architecture-decision-packet.schema.json')
const EVIDENCE_SCHEMA = loadSchema('evidence-capsule.schema.json')

function base(): AdpLike {
  return JSON.parse(JSON.stringify(SELF_ADP)) as AdpLike
}

function hasError(adp: AdpLike, ruleId: string): boolean {
  return checkPlacementRules(adp).some(finding => finding.ruleId === ruleId && finding.severity === 'error')
}

describe('validate-adp schema and Evidence binding', () => {
  it('accepts the self-adp', () => {
    const result = validateAdp(SELF_ADP, ADP_SCHEMA)
    expect(result.schemaErrors).toEqual([])
    expect(result.findings.filter(finding => finding.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects an ADP missing dsh_placement', () => {
    const adp = base()
    delete adp.dsh_placement
    expect(validateAdp(adp, ADP_SCHEMA).ok).toBe(false)
  })

  it('binds snapshot output directly into an ADP and passes end-to-end', () => {
    const evidence = buildSnapshot()
    const adp = base()
    adp.evidence = { capsule_id: evidence.id, required_refs: ['docs/architecture.md'], unresolved_facts: [] }
    const result = validateAdpWithEvidence(adp, evidence, ADP_SCHEMA, EVIDENCE_SCHEMA)
    expect(result.ok).toBe(true)
    expect(result.findings.filter(finding => finding.severity === 'error')).toEqual([])
  })

  it('rejects a mismatched Evidence Capsule ID', () => {
    const evidence = buildSnapshot()
    const adp = base()
    adp.evidence = { capsule_id: 'evidence:not-the-snapshot', required_refs: ['docs/architecture.md'] }
    const result = validateAdpWithEvidence(adp, evidence, ADP_SCHEMA, EVIDENCE_SCHEMA)
    expect(result.findings.some(finding => finding.ruleId === 'evidence.binding')).toBe(true)
    expect(result.ok).toBe(false)
  })
})

describe('placement checks: invalid + valid counterexamples', () => {
  it('rejects redefined DSH concepts and accepts references-only use', () => {
    const invalid = base()
    invalid.dsh_placement!.dsh_concepts!.redefines = ['Session']
    expect(hasError(invalid, 'placement.redefined-dsh-concept')).toBe(true)

    const valid = base()
    valid.dsh_placement!.dsh_concepts!.references = ['Session']
    valid.dsh_placement!.dsh_concepts!.redefines = []
    expect(hasError(valid, 'placement.redefined-dsh-concept')).toBe(false)
  })

  it('rejects a Cognitive Kernel umbrella and accepts a workspace domain owner', () => {
    const invalid = base()
    invalid.dsh_placement!.implementation_kind = 'domain-component'
    invalid.state = [{ name: 'thinking-workspace', authoritative_owner: 'Cognitive Kernel', durability: 'domain-store' }]
    expect(hasError(invalid, 'placement.parallel-runtime')).toBe(true)

    const valid = base()
    valid.dsh_placement!.implementation_kind = 'domain-component'
    valid.state = [{ name: 'thinking-workspace', authoritative_owner: 'thinking-workspace-domain', durability: 'domain-store' }]
    expect(hasError(valid, 'placement.parallel-runtime')).toBe(false)
  })

  it('rejects an unjustified public Service and accepts explicit current consumer/evolution evidence', () => {
    const invalid = base()
    invalid.dsh_placement!.implementation_kind = 'new-seam'
    invalid.capability = {
      service_definition: { service_key: 'ctx.thinking' }, providers: ['ThinkingProvider'], consumers: ['ThinkingConsumer'], existing_extension_points: [],
    }
    expect(hasError(invalid, 'placement.unjustified-public-service')).toBe(true)

    const valid = base()
    valid.dsh_placement!.implementation_kind = 'new-seam'
    valid.dsh_placement!.public_service_justification = {
      current_consumers: ['tool-thinking'], independent_role_evolution: ['local and remote providers must swap independently'],
    }
    valid.capability = {
      service_definition: { service_key: 'ctx.thinking' }, providers: ['local', 'remote'], consumers: ['tool-thinking'], existing_extension_points: [],
    }
    expect(hasError(valid, 'placement.unjustified-public-service')).toBe(false)
  })

  it('requires compose to name existing extension points', () => {
    const invalid = base()
    invalid.dsh_placement!.seam_disposition = 'compose'
    invalid.capability = { service_definition: null, providers: [], consumers: [], existing_extension_points: [] }
    expect(hasError(invalid, 'placement.compose-without-existing-seams')).toBe(true)

    const valid = base()
    valid.dsh_placement!.seam_disposition = 'compose'
    valid.capability = { service_definition: null, providers: [], consumers: [], existing_extension_points: ['ctx.sessions', 'ctx.tools'] }
    expect(hasError(valid, 'placement.compose-without-existing-seams')).toBe(false)
  })

  it('rejects model-visible projection without replayable history and accepts a session projection', () => {
    const invalid = base()
    invalid.dsh_placement!.event_mapping!.model_visible_projection = ['thinking-summary']
    invalid.model_visibility = { inputs: ['summary'], session_event_or_projection: [], replay: '', compaction: '' }
    expect(hasError(invalid, 'placement.event-domain-collapse')).toBe(true)

    const valid = base()
    valid.dsh_placement!.event_mapping!.model_visible_projection = ['thinking-summary']
    valid.model_visibility = { inputs: ['summary'], session_event_or_projection: ['workspace/context-projected'], replay: 'derive from SessionEvent', compaction: 'normal' }
    expect(hasError(valid, 'placement.event-domain-collapse')).toBe(false)
  })

  it('rejects a UI-only Session fork and accepts a durable history divergence', () => {
    const invalid = base()
    invalid.model_visibility = { inputs: [], session_event_or_projection: ['session fork view'], replay: '', compaction: '' }
    expect(hasError(invalid, 'placement.visual-branch-fork')).toBe(true)

    const valid = base()
    valid.model_visibility = { inputs: [], session_event_or_projection: ['session fork'], replay: 'fork replay', compaction: 'normal' }
    valid.state = [{ name: 'history-divergence', authoritative_owner: 'ctx.sessions', durability: 'session-log' }]
    expect(hasError(valid, 'placement.visual-branch-fork')).toBe(false)
  })

  it('rejects Settings as domain state source of truth but allows Settings for tunables', () => {
    const invalid = base()
    invalid.state = [{ name: 'task-record', authoritative_owner: 'task-domain', source_of_truth: 'ctx.settings namespace', durability: 'domain-store' }]
    expect(hasError(invalid, 'placement.settings-domain-data')).toBe(true)

    const valid = base()
    valid.state = [{ name: 'task-record', authoritative_owner: 'task-domain', source_of_truth: 'task-domain-store', durability: 'domain-store' }]
    valid.configuration = { owner: 'ctx.settings', purpose: 'user-configurable concurrency only' }
    expect(hasError(valid, 'placement.settings-domain-data')).toBe(false)
  })
})

describe('kernel checks', () => {
  it('rejects an incomplete invention proof and accepts the complete array/string form', () => {
    const invalid = base()
    invalid.decision = { selected_alternative: 'new', mode: 'invent', invention_proof: {} }
    expect(checkKernelRules(invalid).some(finding => finding.ruleId === 'invention.proof' && finding.severity === 'error')).toBe(true)

    const valid = base()
    valid.decision = {
      selected_alternative: 'new',
      mode: 'invent',
      invention_proof: {
        inspected_existing_seams: ['ctx.jobs', 'ctx.workflowEngine'],
        rejected_adaptations: ['jobs is process-local'],
        missing_capability: 'durable cross-session execution queue',
        why_composition_is_insufficient: 'existing owners do not provide durable queue mutation semantics',
        approval_ref: 'review:123',
      },
    }
    expect(checkKernelRules(valid).some(finding => finding.ruleId === 'invention.proof' && finding.severity === 'error')).toBe(false)
  })

  it('requires capability triple for a new seam', () => {
    const adp = base()
    adp.dsh_placement!.implementation_kind = 'new-seam'
    adp.capability = { service_definition: null, providers: [], consumers: [], existing_extension_points: [] }
    const findings = checkKernelRules(adp)
    expect(findings.some(finding => finding.ruleId === 'seam.service-definition')).toBe(true)
    expect(findings.some(finding => finding.ruleId === 'seam.provider')).toBe(true)
    expect(findings.some(finding => finding.ruleId === 'seam.consumer')).toBe(true)
  })
})
