/**
 * skillManagement domain contract: session-addressed read-only skill
 * management projection. The same registry discovery that produces call
 * winners also surfaces every candidate, shadow edges, diagnostics and
 * provider-declared origins, so a management view can show why one skill won
 * and what was skipped.
 *
 * Like skills, the session's header cwd resolves host-side and lookup never
 * creates or resumes an Agent; the live agent only selects a realm-mounted
 * registry when a composition provides one.
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Opaque entry identifier stable within one mounted registry generation; not a host path. */
export type SkillEntryId = Branded<'SkillEntryId'>

/** Opaque root identifier for diagnostics grouping; not a host path. */
export type SkillRootId = Branded<'SkillRootId'>

/** Skill row for management display (provider/source vocabulary stays host-side). */
export interface SkillManagementSummary {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  /** Discovery source that produced this candidate. */
  readonly source: string
  /** Provider that owns this skill body. */
  readonly provider: string
  /** Resource-base kind when the provider declares one. */
  readonly resourceKind?: string
}

/** Direct shadow edge: the winning entry this one lost to, and why. */
export interface SkillShadow {
  readonly by: SkillEntryId
  readonly reason: 'within-layer' | 'cross-layer'
}

/** Provider-declared operations for one entry; P0 carries declarations only, no UI buttons. */
export interface SkillManagementActions {
  readonly edit: boolean
  readonly remove: boolean
  readonly setInvocation: boolean
}

/** Provider-declared origin discriminated map; the registry never infers `kind`. */
export interface SkillManagementOrigin {
  readonly kind: string
  readonly provider: string
  readonly layerLabel: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** One candidate in the management projection. */
export interface SkillManagementEntry {
  readonly id: SkillEntryId
  readonly summary: SkillManagementSummary
  readonly selected: boolean
  readonly shadow?: SkillShadow
  readonly origin: SkillManagementOrigin
  readonly actions: SkillManagementActions
}

/** Diagnostic from one discovery stage; `stage` names where it was observed, not blame. */
export interface SkillDiagnostic {
  readonly code: string
  readonly severity: 'warning' | 'error'
  readonly stage: 'provider-discovery' | 'registry-validation'
  readonly message: string
  readonly provider?: string
  readonly rootId?: SkillRootId
  readonly location?: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** Full management snapshot for one session's viewing scope. */
export interface SkillManagementSnapshot {
  readonly sessionId: SessionId
  readonly fidelity: 'live' | 'standing'
  readonly complete: boolean
  readonly entries: readonly SkillManagementEntry[]
  readonly diagnostics: readonly SkillDiagnostic[]
}

/**
 * SkillManagement-domain unary methods. P0 is a single read-only snapshot;
 * root management and editing are P1/P2 and add their own verbs.
 */
export interface SkillManagementApi {
  /** Projects every candidate, shadow edges and diagnostics for the session's scope. */
  snapshot(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<SkillManagementSnapshot>>
}
