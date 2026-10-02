/** Bounded candidate-only tools for a Thinking Desk Agent. @module @changanhua/dsh-tool-thinking-case */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ParameterSchemaSpec, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { planningDeltaOperationSchema } from '@changanhua/dsh-planning'
import type { ThinkingResultDraft } from '@changanhua/dsh-planning-remote/types'

export const name = 'tool-thinking-case'
export const inject = ['tools', 'thinkingCase']

export interface Config {
  timeoutMs?: number
  maxOutputBytes?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(30_000),
  maxOutputBytes: z.number().step(1).min(1).max(64 * 1024).default(64 * 1024),
})

const textOutput = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const contextParameters = {} as const

const id = { type: 'string' as const }
const schemaText = { type: 'string' as const }
const requiredId = { ...id, required: true as const }
const requiredText = { ...schemaText, required: true as const }
const resourceRef = { type: 'object' as const, additionalProperties: false, properties: {
  kind: id, id, provider: id, revision: id, label: schemaText,
} }
const stateEntry = { type: 'object' as const, additionalProperties: false, properties: {
  id: requiredId, kind: { type: 'string' as const, enum: ['objective', 'accepted', 'open'], required: true }, content: requiredText,
  sourceRefs: { type: 'array' as const, items: resourceRef },
} }
const operation = {
  oneOf: [
    { type: 'object' as const, additionalProperties: false, properties: { kind: { type: 'string' as const, const: 'add-state-entry', required: true }, entry: { ...stateEntry, required: true } } },
    { type: 'object' as const, additionalProperties: false, properties: { kind: { type: 'string' as const, const: 'update-state-entry', required: true }, entry: { ...stateEntry, required: true } } },
    { type: 'object' as const, additionalProperties: false, properties: { kind: { type: 'string' as const, const: 'remove-state-entry', required: true }, id: requiredId } },
    { type: 'object' as const, additionalProperties: false, properties: { kind: { type: 'string' as const, const: 'create-focus', required: true }, id: requiredId, title: requiredText, objective: schemaText } },
    { type: 'object' as const, additionalProperties: false, properties: { kind: { type: 'string' as const, const: 'update-focus', required: true }, id: requiredId, expectedVersion: { type: 'integer' as const, required: true }, title: schemaText, objective: schemaText, status: { type: 'string' as const, enum: ['open', 'active', 'blocked', 'done'] } } },
    { type: 'object' as const, additionalProperties: false, properties: { kind: { type: 'string' as const, const: 'add-resource-link', required: true }, id: requiredId, resource: { ...resourceRef, required: true }, role: id } },
    { type: 'object' as const, additionalProperties: false, properties: { kind: { type: 'string' as const, const: 'remove-resource-link', required: true }, id: requiredId } },
  ],
} as const
const draftParameters = {
  type: 'object' as const, additionalProperties: false,
  properties: {
    summary: requiredText,
    findings: { type: 'array' as const, items: schemaText, required: true },
    open_questions: { type: 'array' as const, items: schemaText, required: true },
    exploration_notes: { type: 'array' as const, items: { type: 'object' as const, additionalProperties: false, properties: { title: requiredText, body: schemaText } } },
    design_context: { type: 'object' as const, additionalProperties: false, properties: { title: requiredText, body: requiredText } },
    planning_delta: { type: 'object' as const, additionalProperties: false, properties: { operations: { type: 'array' as const, items: operation, required: true }, rationale: schemaText } },
  },
} as const
const submitParameters = {
  expected_result_version: { type: 'integer' as const, required: true, description: '0 for the first result, then the current result version.' },
  request_id: { type: 'string' as const, required: true, description: 'Stable request id. Keep it unchanged when retrying the same submission.' },
  draft: { ...draftParameters, required: true, description: 'Structured thinking candidate. Use expected_result_version 0 for the first submission, then increment from the stored result version.' },
} as const as ParameterSchemaSpec

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarnessError('Thinking result draft must be an object.', 'THINKING_INVALID_INPUT')
  }
  return value as Record<string, unknown>
}

function strictRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  const object = record(value)
  if (Object.keys(object).some(key => !fields.includes(key))) {
    throw new HarnessError(`Thinking result ${name} contains an unknown field.`, 'THINKING_INVALID_INPUT')
  }
  return object
}

function text(value: unknown, field: string, maxBytes: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.trim() === '' || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new HarnessError(`Thinking result ${field} must be non-empty text within ${maxBytes} bytes.`, 'THINKING_INVALID_INPUT')
  }
  return value
}

function requiredValueText(value: unknown, field: string, maxBytes: number): string {
  const result = text(value, field, maxBytes)
  if (result === undefined) throw new HarnessError(`Thinking result ${field} is required.`, 'THINKING_INVALID_INPUT')
  return result
}

function texts(value: unknown, field: string, maxItems: number, maxBytes: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new HarnessError(`Thinking result ${field} must contain at most ${maxItems} text entries.`, 'THINKING_INVALID_INPUT')
  }
  return value.map((entry, index) => requiredValueText(entry, `${field}[${index}]`, maxBytes))
}

function parseDraft(value: unknown): ThinkingResultDraft {
  const draft = strictRecord(value, ['summary', 'findings', 'open_questions', 'exploration_notes', 'design_context', 'planning_delta'], 'draft')
  const summary = requiredValueText(draft.summary, 'summary', 8192)
  const findings = texts(draft.findings, 'findings', 32, 8192)
  const openQuestions = texts(draft.open_questions, 'open_questions', 32, 8192)
  const explorationNotes = draft.exploration_notes === undefined ? undefined : (() => {
    if (!Array.isArray(draft.exploration_notes) || draft.exploration_notes.length > 32) {
      throw new HarnessError('Thinking result exploration_notes must contain at most 32 notes.', 'THINKING_INVALID_INPUT')
    }
    return draft.exploration_notes.map((note, index) => {
      const item = strictRecord(note, ['title', 'body'], `exploration_notes[${index}]`)
      return {
        title: requiredValueText(item.title, `exploration_notes[${index}].title`, 2048),
        ...(item.body === undefined
          ? {}
          : { body: requiredValueText(item.body, `exploration_notes[${index}].body`, 8192) }),
      }
    })
  })()
  const designContext = draft.design_context === undefined ? undefined : (() => {
    const item = strictRecord(draft.design_context, ['title', 'body'], 'design_context')
    return {
      title: requiredValueText(item.title, 'design_context.title', 2048),
      body: requiredValueText(item.body, 'design_context.body', 8192),
    }
  })()
  const planningDelta = draft.planning_delta === undefined ? undefined : (() => {
    const item = strictRecord(draft.planning_delta, ['operations', 'rationale'], 'planning_delta')
    if (!Array.isArray(item.operations) || item.operations.length === 0 || item.operations.length > 100) {
      throw new HarnessError('Thinking result planning_delta.operations must contain 1 through 100 operations.', 'THINKING_INVALID_INPUT')
    }
    const operations = item.operations.map((operation) => {
      const parsed = planningDeltaOperationSchema.safeParse(operation)
      if (!parsed.success) throw new HarnessError('Thinking result planning_delta contains an invalid Planning operation.', 'THINKING_INVALID_INPUT')
      return parsed.data
    })
    return {
      operations,
      ...(item.rationale === undefined
        ? {}
        : { rationale: requiredValueText(item.rationale, 'planning_delta.rationale', 8192) }),
    }
  })()
  return { summary, findings, openQuestions, ...(explorationNotes === undefined ? {} : { explorationNotes }),
    ...(designContext === undefined ? {} : { designContext }), ...(planningDelta === undefined ? {} : { planningDelta }) }
}

function agentOf(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new HarnessError('Thinking tools require an Agent-bound caller.', 'THINKING_MISSING_AGENT')
  return exec.agent
}

function render(value: unknown, maxBytes: number): string {
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new HarnessError('Thinking tool result exceeds its output limit.', 'THINKING_OUTPUT_LIMIT')
  return serialized
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = Config(config) as Required<Config>
  ctx.tools.register(defineTool({
    name: 'thinking_context', description: 'Read the bounded, frozen context for this active Thinking Desk run.',
    parameters: contextParameters, output: textOutput, timeoutMs: resolved.timeoutMs,
    execute: async (_args, exec) => {
      exec.signal.throwIfAborted()
      return render(await ctx.thinkingCase.context(agentOf(exec), exec.signal), resolved.maxOutputBytes)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'thinking_submit_result', description: 'Save one versioned structured Thinking Desk candidate for human review. This never changes Planning.',
    parameters: submitParameters, output: textOutput, timeoutMs: resolved.timeoutMs,
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const input = args as unknown as { expected_result_version: number; request_id: string; draft: unknown }
      if (input.expected_result_version < 0 || input.request_id.trim() === '' || Buffer.byteLength(input.request_id, 'utf8') > 256) {
        throw new HarnessError('Provide a non-negative result version and a request id within 256 bytes.', 'THINKING_INVALID_INPUT')
      }
      return render(await ctx.thinkingCase.submit(agentOf(exec), {
        expectedResultVersion: input.expected_result_version,
        requestId: input.request_id,
        draft: parseDraft(input.draft),
      }, exec.signal), resolved.maxOutputBytes)
    },
  }))
}
