import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  VerificationPlanDocumentError,
  parseVerificationPlanDocument,
  resolveVerificationPlan,
  verificationPlanDocumentSchema,
  verificationPlanSchema,
} from '@changanhua/dsh-delivery-protocol'
import { describe, expect, it } from 'vitest'

const fixtures = JSON.parse(
  await readFile(join(import.meta.dirname, '..', 'fixtures', 'valid.json'), 'utf8'),
) as {
  readonly verificationPlanDocuments: readonly unknown[]
  readonly verificationPlans: readonly unknown[]
}
const planDocument = verificationPlanDocumentSchema.parse(fixtures.verificationPlanDocuments[0])
const plan = verificationPlanSchema.parse(fixtures.verificationPlans[0])
const check = plan.checks[0]!
const encoder = new TextEncoder()

function document(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

describe('Git-blob verification-plan document', () => {
  it('parses the strict document and constructs its canonical resolved plan', () => {
    const parsed = parseVerificationPlanDocument(document(planDocument))
    expect(parsed).toEqual(planDocument)
    expect(resolveVerificationPlan(parsed.checks, plan.provenance)).toEqual(plan)
  })

  it.each([
    {
      name: 'UTF-8 BOM',
      bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
      code: 'utf8-bom',
    },
    { name: 'invalid UTF-8', bytes: new Uint8Array([0xff]), code: 'invalid-utf8' },
    { name: 'invalid JSON', bytes: encoder.encode('{'), code: 'invalid-json' },
    {
      name: 'extra top-level key',
      bytes: document({ format: 'delivery-verification-plan@1', checks: [check], command: 'pnpm test' }),
      code: 'invalid-document',
    },
    {
      name: 'empty checks',
      bytes: document({ format: 'delivery-verification-plan@1', checks: [] }),
      code: 'invalid-document',
    },
    {
      name: 'duplicate check ids',
      bytes: document({ format: 'delivery-verification-plan@1', checks: [check, check] }),
      code: 'invalid-document',
    },
    {
      name: 'env split-string shell command',
      bytes: document({
        format: 'delivery-verification-plan@1',
        checks: [{ ...check, argv: ['env', '-S', 'pnpm test'] }],
      }),
      code: 'invalid-document',
    },
    {
      name: 'env-prefixed shell command',
      bytes: document({
        format: 'delivery-verification-plan@1',
        checks: [{ ...check, argv: ['env', 'CI=1', 'bash', '-c', 'pnpm test'] }],
      }),
      code: 'invalid-document',
    },
  ] as const)('rejects $name with stable code $code', ({ bytes, code }) => {
    expect(() => parseVerificationPlanDocument(bytes)).toThrow(
      expect.objectContaining<Partial<VerificationPlanDocumentError>>({ code }),
    )
  })
})
