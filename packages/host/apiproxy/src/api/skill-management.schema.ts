/**
 * skillManagement domain zod schemas (names derived from the map key:
 * skillManagementSnapshotRequestSchema / skillManagementSnapshotValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type {
  SkillDiagnostic, SkillManagementActions, SkillManagementEntry, SkillManagementOrigin,
  SkillManagementSummary, SkillShadow,
} from './skill-management.ts'

const skillInvocationSchema = z.object({
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
})

/** SkillManagementSummary row of skillManagement.snapshot. */
export const skillManagementSummarySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional(),
  invocation: skillInvocationSchema,
  source: z.string(),
  provider: z.string(),
  resourceKind: z.string().optional(),
}) as unknown as z.ZodType<Wire<SkillManagementSummary>>

/** SkillShadow row of a shadowed entry. */
export const skillShadowSchema = z.object({
  by: z.string(),
  reason: z.enum(['within-layer', 'cross-layer']),
}) as unknown as z.ZodType<Wire<SkillShadow>>

/** SkillManagementActions declarations (P0 informational only). */
export const skillManagementActionsSchema = z.object({
  edit: z.boolean(),
  remove: z.boolean(),
  setInvocation: z.boolean(),
}) as unknown as z.ZodType<Wire<SkillManagementActions>>

/** SkillManagementOrigin discriminated map. */
export const skillManagementOriginSchema = z.object({
  kind: z.string(),
  provider: z.string(),
  layerLabel: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
}) as unknown as z.ZodType<Wire<SkillManagementOrigin>>

/** SkillManagementEntry row of skillManagement.snapshot. */
export const skillManagementEntrySchema = z.object({
  id: z.string(),
  summary: skillManagementSummarySchema,
  selected: z.boolean(),
  shadow: skillShadowSchema.optional(),
  origin: skillManagementOriginSchema,
  actions: skillManagementActionsSchema,
}) as unknown as z.ZodType<Wire<SkillManagementEntry>>

/** SkillDiagnostic row of skillManagement.snapshot. */
export const skillDiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(['warning', 'error']),
  stage: z.enum(['provider-discovery', 'registry-validation']),
  message: z.string(),
  provider: z.string().optional(),
  rootId: z.string().optional(),
  location: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}) as unknown as z.ZodType<Wire<SkillDiagnostic>>

/** skillManagement.snapshot response value (the snapshot itself). */
export const skillManagementSnapshotValueSchema = z.object({
  sessionId: sessionIdSchema,
  fidelity: z.enum(['live', 'standing']),
  complete: z.boolean(),
  entries: z.array(skillManagementEntrySchema),
  diagnostics: z.array(skillDiagnosticSchema),
}) as unknown as z.ZodType<Wire<ResponseValue<'skillManagement.snapshot'>>>

/** skillManagement.snapshot request payload. */
export const skillManagementSnapshotRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skillManagement.snapshot'>>>
