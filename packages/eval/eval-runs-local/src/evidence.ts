import { createHash } from 'node:crypto'
import { z } from 'zod'
import { evalContractDigest, parseResolvedExecutionManifest } from '@changanhua/dsh-eval'
import type { IsolatedCellBinding } from '@changanhua/dsh-eval-isolated'
import { EvalRunError } from '@changanhua/dsh-eval-runs'

export const referenceSchema = z.object({ id: z.string().min(1), version: z.literal('1'), digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
export const materialSchema = z.object({ reference: referenceSchema, kind: z.enum(['observer', 'workspace', 'execution']),
  executionId: z.string().min(1), role: z.enum(['subject', 'grader']), content: z.string() }).strict()
export const bundleSchema = z.object({ id: z.string().min(1), digest: z.string().regex(/^[a-f0-9]{64}$/u),
  materials: z.array(materialSchema).min(1) }).strict()
export type EvidenceTuple = IsolatedCellBinding & { readonly attemptId: string; readonly attempt: number }
const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex')

/**
 * Verify the producer's complete transfer and every material's exact cell/Attempt ownership before acknowledgement.
 * @param input Private bundle from the Host-owned execution callback.
 * @param tuple Actual Queue Attempt and approved cell binding, never reconstructed from the bundle.
 * @param maxBytes Bound for the complete transferred representation.
 * @returns Validated private bundle; authenticity still depends on the Host callback's provenance.
 */
export function validateBundle(input: unknown, tuple: EvidenceTuple, maxBytes: number,
  expectedPlan?: { readonly id: string; readonly version: string; readonly digest: string }): z.infer<typeof bundleSchema> {
  try {
    if (Buffer.byteLength(JSON.stringify(input)) > maxBytes) throw new EvalRunError('capacity')
    const bundle = bundleSchema.parse(input)
    if (bundle.digest !== digest({ id: bundle.id, materials: bundle.materials })) throw new Error('bundle digest')
    const ids = new Set<string>()
    let manifests = 0
    for (const material of bundle.materials) {
      if (ids.has(material.reference.id)) throw new Error('duplicate material')
      ids.add(material.reference.id)
      if (material.reference.digest !== digest({ kind: material.kind, executionId: material.executionId,
        role: material.role, content: material.content })) throw new Error('material digest')
      const content: unknown = JSON.parse(material.content)
      if (!content || typeof content !== 'object' || !('tuple' in content)
        || evalContractDigest(content.tuple) !== evalContractDigest(tuple)) throw new Error('material ownership')
      if (!('manifest' in content)) continue
      if (material.kind !== 'execution' || material.role !== 'subject' || ++manifests > 1) throw new Error('manifest ownership')
      if (content.manifest === null) continue
      const manifest = parseResolvedExecutionManifest(content.manifest)
      if (expectedPlan && evalContractDigest(manifest.planRef) !== evalContractDigest(expectedPlan)) throw new Error('manifest plan')
      if (manifest.runId !== tuple.runId || manifest.cell.caseId !== tuple.caseId || manifest.cell.routeId !== tuple.routeId
        || manifest.cell.repeatIndex !== tuple.repeatIndex || manifest.cell.attempt !== tuple.attempt
        || manifest.subject.executionId !== material.executionId) throw new Error('manifest tuple')
      for (const [role, identity] of [['subject', manifest.subject], ['grader', manifest.grader]] as const) {
        if (!identity) continue
        for (const [kind, reference] of [['observer', identity.observerRef], ['execution', identity.evidenceRef],
          ['workspace', identity.repository.workspaceLeaseRef]] as const) {
          const found = bundle.materials.find(row => row.reference.id === reference.id)
          if (!found || found.role !== role || found.kind !== kind || found.executionId !== identity.executionId
            || evalContractDigest(found.reference) !== evalContractDigest(reference)) throw new Error('dangling reference')
        }
      }
    }
    if (manifests !== 1) throw new Error('missing manifest observation')
    return bundle
  } catch (error) {
    if (error instanceof EvalRunError) throw error
    throw new EvalRunError('invalid-evidence')
  }
}
