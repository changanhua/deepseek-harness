import { z } from 'zod'
import Schema from '@deepseek-ai/schemastery'

const id = z.string().min(1).max(256)
const reference = z.object({ id, version: id, digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
const artifact = z.object({ id, source: id, digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()

/** Host configuration is the authority for file roots, approved contents, credential permission and capacity. */
export const configSchema = z.object({
  maxAdmissions: z.number().int().positive(),
  maxLedgerBytes: z.number().int().min(1024),
  sources: z.array(z.object({
    workspaceId: id.nullable(), root: z.string().min(1), planFile: z.string().min(1), suiteFile: z.string().min(1),
    mode: z.enum(['keyless', 'live']),
    approvedPlan: reference, maxFileBytes: z.number().int().positive(), maxCells: z.number().int().positive(),
    credentialGrant: z.object({ reference, credentialRefs: z.array(id).min(1) }).strict().nullable(),
    requiredTools: z.array(artifact), requiredSkills: z.array(artifact),
  }).strict()).min(1),
}).strict()

/** Resolved, explicit local source configuration. */
export type Config = z.infer<typeof configSchema>

const referenceConfig = Schema.object({ id: Schema.string().required(), version: Schema.string().required(),
  digest: Schema.string().required() })
const artifactConfig = Schema.object({ id: Schema.string().required(), source: Schema.string().required(),
  digest: Schema.string().required() })
/** Loader configuration shape; strict cross-field and file checks remain with the source owner. */
export const Config: Schema<Config> = Schema.object({
  maxAdmissions: Schema.number().step(1).min(1).required(), maxLedgerBytes: Schema.number().step(1).min(1024).required(),
  sources: Schema.array(Schema.object({
    workspaceId: Schema.union([Schema.string(), Schema.const(null)]).default(null), root: Schema.string().required(),
    planFile: Schema.string().required(), suiteFile: Schema.string().required(), mode: Schema.union(['keyless', 'live']).required(),
    approvedPlan: referenceConfig.required(), maxFileBytes: Schema.number().step(1).min(1).required(),
    maxCells: Schema.number().step(1).min(1).required(),
    credentialGrant: Schema.union([Schema.const(null), Schema.object({ reference: referenceConfig.required(),
      credentialRefs: Schema.array(Schema.string()).required() })]).default(null),
    requiredTools: Schema.array(artifactConfig).required(), requiredSkills: Schema.array(artifactConfig).required(),
  })).required(),
})
