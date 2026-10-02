import { createHash } from 'node:crypto'
import { z } from 'zod'

export const nonBlank = z.string().min(1).refine(value => value.trim().length > 0, 'must not be blank')
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)
export const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
export const referenceSchema = z.object({ id: nonBlank, version: nonBlank, digest: digestSchema }).strict()
export const artifactSchema = z.object({ id: nonBlank, source: nonBlank, digest: digestSchema }).strict()

export function uniqueBy<T>(values: T[], key: (value: T) => string, ctx: z.RefinementCtx): void {
  if (new Set(values.map(key)).size !== values.length) {
    ctx.addIssue({ code: 'custom', message: 'duplicate identity' })
  }
}

export const artifactSetSchema = z.array(artifactSchema)
  .superRefine((items, ctx) => { uniqueBy(items, item => item.id, ctx) })
  .transform(items => items.sort(compareIdentity))

export const referenceSetSchema = z.array(referenceSchema)
  .superRefine((items, ctx) => { uniqueBy(items, item => item.id, ctx) })
  .transform(items => items.sort(compareIdentity))

export function compareIdentity(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : 1
}

function canonical(value: z.infer<ReturnType<typeof z.json>>): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : 1)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Encode JSON with sorted object keys and unchanged array order.
 *
 * Parse contracts first to normalize only their explicitly unordered sets.
 * This checks JSON representation, not the authority or truth of its contents.
 * @param input JSON-compatible value; undefined and non-finite numbers are rejected.
 * @returns Deterministic JSON without whitespace.
 * @throws {z.ZodError} When input is not JSON-compatible.
 */
export function serializeEvalContract(input: unknown): string {
  return canonical(z.json().parse(input))
}

/**
 * Hash canonical JSON for an Eval content reference; does not authenticate its producer.
 * @param input Parsed contract or JSON value; arrays retain order.
 * @returns Lowercase SHA-256 of UTF-8 canonical JSON.
 * @throws {z.ZodError} When input is not JSON-compatible.
 */
export function evalContractDigest(input: unknown): string {
  return createHash('sha256').update(serializeEvalContract(input)).digest('hex')
}

export function sameValue(left: unknown, right: unknown): boolean {
  return serializeEvalContract(left) === serializeEvalContract(right)
}

export function contentReference(value: { id: string; version: string }): z.infer<typeof referenceSchema> {
  return { id: value.id, version: value.version, digest: evalContractDigest(value) }
}
