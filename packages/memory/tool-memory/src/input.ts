/** Model-facing schemas and strict snake-case input admission. @module @changanhua/dsh-tool-memory/input */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { memoryProposalSchema } from '@changanhua/dsh-memory'
import type { MemoryProposal, MemorySearchRequest } from '@changanhua/dsh-memory'

/** Public search arguments contain no selectable project or authority. */
export const searchParameters = {
  query: { type: 'string', required: true, description: 'Words describing relevant project decisions, facts, preferences, or methods.' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags that every returned memory must have.' },
  limit: { type: 'integer', description: 'Requested result count, bounded by the configured maximum.' },
} as const

/** One caller-project identity; unavailable and foreign ids are indistinguishable. */
export const readParameters = {
  id: { type: 'string', required: true, description: 'Memory id returned by memory_search or memory_propose.' },
} as const

/** Candidate admission; the provider captures source hashes and humans decide acceptance. */
export const proposalParameters = {
  topic_key: { type: 'string', required: true, description: 'Stable project topic, such as validation.command; reuse it for related claims.' },
  kind: { type: 'string', enum: ['fact', 'decision', 'preference', 'method'], required: true, description: 'Type of reusable claim.' },
  title: { type: 'string', required: true, description: 'Short descriptive title.' },
  statement: { type: 'string', required: true, description: 'One reusable claim, at most 2000 Unicode characters.' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Optional retrieval tags.' },
  conditions: { type: 'string', description: 'When this claim applies; explanatory text, not executable policy.' },
  sources: {
    type: 'array', required: true, description: 'One to five source locators; never supply a hash or a verification claim.',
    items: {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', enum: ['file', 'session-event'], required: true, description: 'A project file or a persisted Session event.' },
        path: { type: 'string', description: 'Project-relative file path; required only for file sources.' },
        line: { type: 'integer', description: 'Optional positive file line number for navigation.' },
        session_id: { type: 'string', description: 'Same-project Session id; required only for session-event sources.' },
        seq: { type: 'integer', description: 'Non-negative persisted event sequence; required only for session-event sources.' },
      },
    },
  },
  memory_id: { type: 'string', description: 'Existing memory id when proposing a revision; also supply expected_version.' },
  expected_version: { type: 'integer', description: 'Observed recordVersion when proposing a revision; also supply memory_id.' },
  idempotency_key: { type: 'string', required: true, description: 'Stable key for this logical proposal; keep it unchanged when retrying.' },
} as const

function objectInput(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) {
    throw new HarnessError('Memory input contains unsupported fields.', 'MEMORY_INVALID_INPUT')
  }
  return value as Record<string, unknown>
}

/**
 * Validate a lexical query before sending it to the service.
 * @param value - Untrusted model arguments with no project or authority overrides.
 * @returns An admitted lexical search request; malformed or extra fields throw.
 */
export function parseSearch(value: unknown): MemorySearchRequest {
  const input = objectInput(value, ['query', 'tags', 'limit'])
  if (typeof input.query !== 'string' || input.query.trim().length === 0 || input.query.length > 1000
    || input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string'))
    || input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1)) {
    throw new HarnessError('Provide a non-empty memory query and valid optional tags and limit.', 'MEMORY_INVALID_INPUT')
  }
  return {
    query: input.query,
    ...input.tags === undefined ? {} : { tags: input.tags as string[] },
    ...input.limit === undefined ? {} : { limit: input.limit },
  }
}

/**
 * Validate one opaque memory identity without accepting a project override.
 * @param value - Untrusted model arguments containing only an id.
 * @returns The admitted opaque memory identity; malformed or extra fields throw.
 */
export function parseRead(value: unknown): string {
  const input = objectInput(value, ['id'])
  if (typeof input.id !== 'string' || input.id.length === 0 || input.id.length > 256) {
    throw new HarnessError('Provide a memory id.', 'MEMORY_INVALID_INPUT')
  }
  return input.id
}

/**
 * Map only admitted fields, then let the domain schema enforce claim and locator limits.
 * @param value - Untrusted snake-case proposal arguments, without provider hashes or human decisions.
 * @returns A validated domain proposal mapped to the service contract.
 */
export function parseProposal(value: unknown): MemoryProposal {
  const input = objectInput(value, Object.keys(proposalParameters))
  if (!Array.isArray(input.sources)) throw new HarnessError('Provide memory source locators.', 'MEMORY_INVALID_INPUT')
  const sources = input.sources.map((value: unknown) => {
    const source = objectInput(value, ['kind', 'path', 'line', 'session_id', 'seq'])
    if (source.kind === 'file') {
      objectInput(value, ['kind', 'path', 'line'])
      return { kind: source.kind, path: source.path, ...source.line === undefined ? {} : { line: source.line } }
    }
    objectInput(value, ['kind', 'session_id', 'seq'])
    return { kind: source.kind, sessionId: source.session_id, seq: source.seq }
  })
  const mapped: Record<string, unknown> = {
    topicKey: input.topic_key, kind: input.kind, title: input.title, statement: input.statement,
    sources, idempotencyKey: input.idempotency_key,
  }
  for (const [wire, field] of [
    ['tags', 'tags'], ['conditions', 'conditions'], ['memory_id', 'memoryId'], ['expected_version', 'expectedVersion'],
  ] as const) {
    if (Object.hasOwn(input, wire)) mapped[field] = input[wire]
  }
  const parsed = memoryProposalSchema.safeParse(mapped)
  if (!parsed.success) throw new HarnessError('Memory candidate or source locators are invalid.', 'MEMORY_INVALID_INPUT')
  return parsed.data
}
