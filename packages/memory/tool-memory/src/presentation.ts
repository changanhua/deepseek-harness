/** Complete UTF-8 bounds for model-visible memory results. @module @changanhua/dsh-tool-memory/presentation */
import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Render a result only when its complete content block fits the deployment limit.
 * @param value - The service result, including provenance and status metadata.
 * @param maxBytes - UTF-8 byte limit including the text-block wrapper.
 * @returns JSON text; oversized results reject without returning partial claims.
 */
export function renderMemoryResult(value: unknown, maxBytes: number): string {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(JSON.stringify([{ type: 'text', text }]), 'utf8') > maxBytes) {
    throw new HarnessError('Memory result exceeds the output limit; narrow the query.', 'MEMORY_OUTPUT_LIMIT')
  }
  return text
}
