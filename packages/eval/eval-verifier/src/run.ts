import { open } from 'node:fs/promises'
import { verifySnapshot } from './verify.ts'
import type { GateVerifierReport } from '@changanhua/dsh-eval-gates'

/** Host-owned paths passed through a frozen one-shot Profile patch. */
export interface VerifierFileConfig {
  /** Host-created frozen verifier input path. */
  readonly inputFile: string
  /** Exclusive output path created once by the verifier. */
  readonly outputFile: string
  /** Maximum complete input bytes before parsing. */
  readonly maxInputBytes: number
  /** Maximum complete report bytes including runtime identity. */
  readonly maxOutputBytes: number }

/**
 * Read one Host-created snapshot and create one verifier report. The plugin never loads code from the snapshot's task workspace.
 * @param config Frozen file handles by path; the Host owns directory containment and process custody.
 * @param runtime Actual Profile lifecycle identity; omission leaves the pure checker's identity unbound.
 */
export async function runVerifierFiles(config: VerifierFileConfig, runtime?: GateVerifierReport['runtime']): Promise<void> {
  if (!Number.isSafeInteger(config.maxInputBytes) || config.maxInputBytes < 1
    || !Number.isSafeInteger(config.maxOutputBytes) || config.maxOutputBytes < 1) throw new Error('eval-verifier-bounds')
  const input = await open(config.inputFile, 'r')
  let source: string
  try {
    const stat = await input.stat()
    if (stat.size > config.maxInputBytes) throw new Error('eval-verifier-input-capacity')
    source = await input.readFile({ encoding: 'utf8' })
    if (Buffer.byteLength(source) > config.maxInputBytes) throw new Error('eval-verifier-input-capacity')
  } finally { await input.close() }
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { parsed = null }
  const report = verifySnapshot(parsed)
  const rendered = JSON.stringify(runtime ? { ...report, runtime } : report)
  if (Buffer.byteLength(rendered) > config.maxOutputBytes) throw new Error('eval-verifier-output-capacity')
  let output
  try { output = await open(config.outputFile, 'wx') } catch { throw new Error('eval-verifier-output-refused') }
  try { await output.writeFile(rendered) } finally { await output.close() }
}
