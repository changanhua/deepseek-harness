/**
 * validate-adp 测试：self-adp 必须通过；6 条新版 placement 检查必须拒绝违规设计。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { load as loadYaml } from 'js-yaml'
import { validateAdp, loadSchema, checkPlacementRules, checkKernelRules, type AdpLike } from './validate-adp.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SELF_ADP = loadYaml(
  readFileSync(join(__dirname, '..', '..', '.agents', 'dsh-intelligence', 'self-adp.yaml'), 'utf8'),
)
const ADP_SCHEMA = loadSchema('architecture-decision-packet.schema.json')

function base(): AdpLike {
  return JSON.parse(JSON.stringify(SELF_ADP)) as AdpLike
}

describe('validate-adp schema', () => {
  it('accepts the self-adp (repo-tool, none, zero parallel runtime)', () => {
    const result = validateAdp(SELF_ADP, ADP_SCHEMA)
    expect(result.schemaErrors).toEqual([])
    expect(result.findings.filter(f => f.severity === 'error')).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('rejects an ADP missing dsh_placement', () => {
    const adp = base()
    delete adp.dsh_placement
    const result = validateAdp(adp, ADP_SCHEMA)
    expect(result.schemaErrors.length).toBeGreaterThan(0)
    expect(result.ok).toBe(false)
  })

  it('rejects an ADP with a non-empty redefines', () => {
    const adp = base()
    adp.dsh_placement.dsh_concepts.redefines = ['Session']
    const result = validateAdp(adp, ADP_SCHEMA)
    expect(result.findings.some(f => f.ruleId === 'placement.redefined-dsh-concept')).toBe(true)
    expect(result.ok).toBe(false)
  })
})

describe('placement checks', () => {
  it('rejects parallel-runtime (Cognitive Kernel umbrella)', () => {
    const adp = base()
    adp.dsh_placement.implementation_kind = 'domain-component'
    adp.state = [
      {
        name: 'thinking-workspace',
        authoritative_owner: 'Cognitive Kernel',
        source_of_truth: 'kernel-store',
        durability: 'domain-store',
        mutation_serialization: 'kernel-single-writer',
        replay: '',
        restart_recovery: '',
        cancellation: '',
        terminal_states: [],
      },
    ]
    const findings = checkPlacementRules(adp)
    expect(findings.some(f => f.ruleId === 'placement.parallel-runtime' && f.severity === 'error')).toBe(true)
  })

  it('rejects unjustified public service (no consumer / no evolution evidence)', () => {
    const adp = base()
    adp.dsh_placement.implementation_kind = 'new-seam'
    adp.capability = {
      service_definition: { package: 'examples/thinking', service_key: 'ctx.thinking', vocabulary: [] },
      providers: ['ThinkingProvider'],
      consumers: ['ThinkingConsumer'],
      existing_extension_points: [],
    }
    // justification 留空
    const findings = checkPlacementRules(adp)
    expect(findings.some(f => f.ruleId === 'placement.unjustified-public-service' && f.severity === 'error')).toBe(true)
  })

  it('rejects event-domain-collapse (model-visible projection without replayable SessionEvent)', () => {
    const adp = base()
    adp.dsh_placement.event_mapping.model_visible_projection = ['thinking-summary']
    adp.model_visibility = { inputs: ['summary'], session_event_or_projection: [], replay: '', compaction: '' }
    const findings = checkPlacementRules(adp)
    expect(findings.some(f => f.ruleId === 'placement.event-domain-collapse' && f.severity === 'error')).toBe(true)
  })

  it('rejects visual-branch-fork (UI-only fork without durable history divergence)', () => {
    const adp = base()
    adp.model_visibility = { inputs: [], session_event_or_projection: ['session fork view'], replay: '', compaction: '' }
    const findings = checkPlacementRules(adp)
    expect(findings.some(f => f.ruleId === 'placement.visual-branch-fork' && f.severity === 'error')).toBe(true)
  })

  it('rejects settings-domain-data (domain records stored in Settings)', () => {
    const adp = base()
    adp.state = [
      {
        name: 'task-record',
        authoritative_owner: 'task-domain',
        source_of_truth: 'settings-namespace',
        durability: 'domain-store',
        mutation_serialization: 'single-writer',
        replay: 'replay',
        restart_recovery: 'recovery',
        cancellation: 'cancel',
        terminal_states: ['done'],
      },
    ]
    adp.configuration = { owner: 'ctx.settings', schema_ref: 'settings/schema', precedence: [], resolve_point: 'boot', hot_update_semantics: '', secrets: [] }
    const findings = checkPlacementRules(adp)
    expect(findings.some(f => f.ruleId === 'placement.settings-domain-data' && f.severity === 'error')).toBe(true)
  })
})

describe('kernel checks', () => {
  it('requires invention proof when mode=invent', () => {
    const adp = base()
    adp.decision = { selected_alternative: 'new', mode: 'invent', invention_proof: {} }
    const findings = checkKernelRules(adp)
    expect(findings.some(f => f.ruleId === 'invention.proof' && f.severity === 'error')).toBe(true)
  })

  it('requires capability triple for a new seam', () => {
    const adp = base()
    adp.dsh_placement.implementation_kind = 'new-seam'
    adp.capability = { service_definition: null, providers: [], consumers: [], existing_extension_points: [] }
    const findings = checkKernelRules(adp)
    expect(findings.some(f => f.ruleId === 'seam.service-definition')).toBe(true)
    expect(findings.some(f => f.ruleId === 'seam.provider')).toBe(true)
    expect(findings.some(f => f.ruleId === 'seam.consumer')).toBe(true)
  })
})
