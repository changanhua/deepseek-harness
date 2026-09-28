/** Execution-free public contract for bounded candidate selection. */
import { parameterSchemaSpecToJsonSchema, valueSchemaSpecToJsonSchema, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

export const CHOOSE_CANDIDATE_NAME = 'choose_candidate'
export const CHOOSE_CANDIDATE_DESCRIPTION = 'Select one eligible candidate for a bounded goal, or abstain when the evidence is insufficient. Disabled candidates are never selectable.'
export const CHOOSE_CANDIDATE_PARAMETERS = {
  goal: { type: 'string', required: true }, facts: { type: 'string', required: true }, constraints: { type: 'array', items: { type: 'string' } },
  candidates: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, description: { type: 'string', required: true }, disabled: { type: 'boolean' } } } },
} as const satisfies ParameterSchemaSpec
export const CHOOSE_CANDIDATE_OUTPUT = { type: 'object', additionalProperties: false, properties: {
  status: { type: 'string', required: true, enum: ['selected', 'abstain'] }, candidateId: { type: 'string' }, reason: { type: 'string' }, provider: { type: 'string', required: true }, model: { type: 'string', required: true }, usage: { oneOf: [{ type: 'object', additionalProperties: true, properties: {} }, { type: 'null' }], required: true }, elapsedMs: { type: 'number', required: true },
} } as const satisfies ValueSchemaSpec
/** Return MCP-ready schemas without importing execution/provider code. */
export function describe(config: unknown) {
  if (config !== undefined && (config === null || typeof config !== 'object' || Array.isArray(config))) throw new TypeError('choice declaration config must be an object')
  return {
    name: CHOOSE_CANDIDATE_NAME, description: CHOOSE_CANDIDATE_DESCRIPTION,
    parameters: parameterSchemaSpecToJsonSchema(CHOOSE_CANDIDATE_PARAMETERS),
    outputSchema: valueSchemaSpecToJsonSchema(CHOOSE_CANDIDATE_OUTPUT),
  }
}
