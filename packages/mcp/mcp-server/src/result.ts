/** Bounded MCP result materialization shared by execution logging and HTTP replies. */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Non-secret correlation fields attached to each completed external call. */
export interface InvocationReceipt {
  readonly sessionId: string
  readonly callId: string
  readonly preset: string
  readonly elapsedMs: number
}

/** Measure the complete tool result, including text, structured value and metadata. */
export function resultBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8') }

/** Produce a bounded failure even when a provider's diagnostic is unexpectedly large. */
export function failureResult(code: string, message: string, limit: number, receipt?: InvocationReceipt): CallToolResult {
  let text = `${code}: ${message}`
  const make = (): CallToolResult => ({ isError: true, content: [{ type: 'text', text }], _meta: { code, ...(receipt === undefined ? {} : { dsh: receipt }) } })
  while (resultBytes(make()) > limit && text.length > 0) text = text.slice(0, Math.floor(text.length / 2))
  const result = make()
  if (resultBytes(result) > limit) return { isError: true, content: [{ type: 'text', text: 'RESULT_TOO_LARGE' }] }
  return result
}

/** Convert a native result without duplicating an oversized value into the durable audit. */
export function invocationResult(outcome: ToolExecutionResult, receipt: InvocationReceipt, limit: number): CallToolResult {
  if (outcome.isError) return failureResult(outcome.error.info?.code ?? 'TOOL_FAILED', outcome.error.message, limit, receipt)
  if (outcome.concludesTurn === true || (outcome.additionalContexts?.length ?? 0) > 0) {
    return failureResult('UNSUPPORTED_EXECUTION_SEMANTICS', 'External calls cannot apply turn completion or additional model contexts', limit, receipt)
  }
  if (outcome.content.some(block => block.type !== 'text')) return failureResult('UNSUPPORTED_CONTENT', 'This endpoint supports JSON and text results', limit, receipt)
  const result: CallToolResult = {
    content: outcome.content.map(block => ({ type: 'text' as const, text: block.type === 'text' ? block.text : '' })),
    structuredContent: { value: outcome.value },
    _meta: { dsh: receipt },
  }
  return resultBytes(result) > limit
    ? failureResult('RESULT_TOO_LARGE', 'The complete MCP result exceeds its byte limit', limit, receipt)
    : result
}
