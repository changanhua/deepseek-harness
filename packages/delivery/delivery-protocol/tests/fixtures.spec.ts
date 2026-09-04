import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  acceptanceDecisionSchema,
  codeChangeIntentSchema,
  codeChangeOutputSchema,
  codeVerifyIntentSchema,
  codeVerifyOutputSchema,
  completionClaimSchema,
  contractRevisionSchema,
  deliveryCaseSchema,
  dispatchBindingSchema,
  evidenceRefSchema,
  issuePublicationSchema,
  requirementDecisionSchema,
  resolvedCodeChangeSchema,
  resolvedCodeVerifySchema,
  resumeCapsuleContentSchema,
  verificationCheckSchema,
  verificationPlanDocumentSchema,
  verificationPlanSchema,
  verificationVerdictSchema,
  workPacketSchema,
} from '@changanhua/dsh-delivery-protocol'
import { describe, expect, it } from 'vitest'

interface SchemaLike {
  parse(value: unknown): unknown
  safeParse(value: unknown): { readonly success: boolean }
}

const fixtureRoot = join(import.meta.dirname, '..', 'fixtures')
const packageRoot = join(import.meta.dirname, '..')
const valid = JSON.parse(await readFile(join(fixtureRoot, 'valid.json'), 'utf8')) as Record<string, unknown>
const invalid = JSON.parse(await readFile(join(fixtureRoot, 'invalid.json'), 'utf8')) as {
  readonly fixtureVersion: number
  readonly cases: readonly InvalidCase[]
}

const collections: Readonly<Record<string, SchemaLike>> = {
  deliveryCases: deliveryCaseSchema,
  requirementDecisions: requirementDecisionSchema,
  contractRevisions: contractRevisionSchema,
  issuePublications: issuePublicationSchema,
  verificationPlanDocuments: verificationPlanDocumentSchema,
  verificationPlans: verificationPlanSchema,
  workPackets: workPacketSchema,
  dispatchBindings: dispatchBindingSchema,
  completionClaims: completionClaimSchema,
  verificationVerdicts: verificationVerdictSchema,
  acceptanceDecisions: acceptanceDecisionSchema,
  evidenceRefs: evidenceRefSchema,
  resumeCapsules: resumeCapsuleContentSchema,
  codeChangeIntents: codeChangeIntentSchema,
  resolvedCodeChanges: resolvedCodeChangeSchema,
  codeChangeOutputs: codeChangeOutputSchema,
  codeVerifyIntents: codeVerifyIntentSchema,
  resolvedCodeVerifies: resolvedCodeVerifySchema,
  codeVerifyOutputs: codeVerifyOutputSchema,
}

const namedSchemas: Readonly<Record<string, SchemaLike>> = {
  deliveryCase: deliveryCaseSchema,
  requirementDecision: requirementDecisionSchema,
  contractRevision: contractRevisionSchema,
  issuePublication: issuePublicationSchema,
  verificationPlanDocument: verificationPlanDocumentSchema,
  verificationPlan: verificationPlanSchema,
  workPacket: workPacketSchema,
  dispatchBinding: dispatchBindingSchema,
  completionClaim: completionClaimSchema,
  verificationVerdict: verificationVerdictSchema,
  acceptanceDecision: acceptanceDecisionSchema,
  evidenceRef: evidenceRefSchema,
  resumeCapsule: resumeCapsuleContentSchema,
  codeChangeIntent: codeChangeIntentSchema,
  codeVerifyIntent: codeVerifyIntentSchema,
  resolvedCodeVerify: resolvedCodeVerifySchema,
}

interface InvalidCase {
  readonly id: string
  readonly schema: string
  readonly from: string
  readonly operations: readonly PatchOperation[]
}

type PatchOperation =
  | { readonly op: 'add' | 'replace'; readonly path: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: string }

function segments(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`fixture JSON pointer must start with /: ${pointer}`)
  return pointer.slice(1).split('/').map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function readPointer(root: unknown, pointer: string): unknown {
  return segments(pointer).reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== 'object') throw new Error(`fixture pointer ${pointer} crosses a scalar`)
    return (value as Record<string, unknown>)[segment]
  }, root)
}

function applyOperations(source: unknown, operations: readonly PatchOperation[]): unknown {
  const target = structuredClone(source)
  for (const operation of operations) {
    const path = segments(operation.path)
    const key = path.pop()
    if (key === undefined) throw new Error('fixture patch cannot replace the document root')
    let parent: unknown = target
    for (const segment of path) {
      if (parent === null || typeof parent !== 'object') throw new Error(`fixture patch ${operation.path} crosses a scalar`)
      parent = (parent as Record<string, unknown>)[segment]
    }
    if (parent === null || typeof parent !== 'object') throw new Error(`fixture patch ${operation.path} has no object parent`)
    if (Array.isArray(parent)) {
      const index = Number(key)
      if (!Number.isInteger(index)) throw new Error(`fixture patch array key is not an integer: ${key}`)
      if (operation.op === 'remove') parent.splice(index, 1)
      else if (operation.op === 'add') parent.splice(index, 0, operation.value)
      else parent[index] = operation.value
    } else if (operation.op === 'remove') {
      Reflect.deleteProperty(parent, key)
    } else {
      ;(parent as Record<string, unknown>)[key] = operation.value
    }
  }
  return target
}

describe('protocol golden fixtures', () => {
  it('keeps Queue declaration merging and prepared values outside Protocol', async () => {
    const source = (await Promise.all([
      'brand.ts',
      'canonical.ts',
      'github.ts',
      'index.ts',
      'invariant.ts',
      'schemas.ts',
      'semantics.ts',
      'types.ts',
      'verification-plan.ts',
    ].map(file => readFile(join(packageRoot, 'src', file), 'utf8')))).join('\n')
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>
      readonly exports?: Record<string, unknown>
    }
    expect(source).not.toContain("declare module '@changanhua/dsh-task-queue'")
    expect(source).not.toContain('PreparedCodeChange')
    expect(manifest.dependencies?.['@changanhua/dsh-task-queue']).toBeUndefined()
    expect(manifest.exports?.['./src/*']).toBeUndefined()
  })

  it('round-trips every valid durable and WorkKind DTO through its package schema', () => {
    expect(valid.fixtureVersion).toBe(1)
    const fixtureIds = valid.fixtureIds as Record<string, string>
    expect(Object.keys(fixtureIds).every(id => /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(id))).toBe(true)
    expect(new Set(Object.values(fixtureIds)).size).toBe(Object.values(fixtureIds).length)
    for (const pointer of Object.values(fixtureIds)) expect(readPointer(valid, pointer)).toBeDefined()
    for (const [collection, schema] of Object.entries(collections)) {
      const records = valid[collection]
      expect(Array.isArray(records), `missing fixture collection ${collection}`).toBe(true)
      for (const record of records as readonly unknown[]) {
        const parsed = schema.parse(record)
        expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
      }
    }
  })

  it.each(invalid.cases)('rejects invalid golden $id', (fixture) => {
    const schema = namedSchemas[fixture.schema]
    if (schema === undefined) throw new Error(`unknown invalid-fixture schema ${fixture.schema}`)
    const candidate = applyOperations(readPointer(valid, fixture.from), fixture.operations)
    expect(schema.safeParse(candidate).success).toBe(false)
  })

  it('allows fixed argv that names a script file without a shell command string', () => {
    const check = structuredClone((valid.verificationPlans as Array<{ checks: unknown[] }>)[0]?.checks[0]) as Record<string, unknown>
    check.argv = ['/bin/sh', 'scripts/verify.sh', '--focused']
    expect(verificationCheckSchema.parse(check).argv).toEqual(['/bin/sh', 'scripts/verify.sh', '--focused'])
  })

  it.each([
    { argv: ['/bin/bash', '-lc', 'pnpm test'] },
    { argv: ['/usr/bin/env', 'CI=1', 'sh', '-c', 'pnpm test'] },
    { argv: ['/usr/bin/env', '-C', '/tmp', 'bash', '-lc', 'pnpm test'] },
    { argv: ['pwsh.exe', '-Command', 'pnpm test'] },
    { argv: ['powershell', '-Enc', 'cABuAHAAbQAgAHQAZQBzAHQA'] },
    { argv: ['cmd.exe', '/C', 'pnpm test'] },
  ])('rejects shell command-string argv $argv', ({ argv }) => {
    const check = structuredClone((valid.verificationPlans as Array<{ checks: unknown[] }>)[0]?.checks[0]) as Record<string, unknown>
    check.argv = argv
    expect(verificationCheckSchema.safeParse(check).success).toBe(false)
  })
})
