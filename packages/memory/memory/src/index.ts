/** Project-scoped, source-backed memory Service Definition. @module @changanhua/dsh-memory */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  MemoryDecisionRequest, MemoryInspectionRequest, MemoryMutation, MemoryProposal,
  MemoryReadResult, MemoryInspectedRecord, MemorySearchRequest, MemorySearchResult,
} from './types.ts'

export * from './types.ts'
export * from './schema.ts'
export { MemoryError } from './errors.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectMemory: ProjectMemory
  }
}

/** Providers own durable records and reauthorize every call against the Agent's Workspace. */
export abstract class ProjectMemory extends Service {
  constructor(ctx: Context) { super(ctx, 'projectMemory') }

  /**
   * Search accepted claims after source, deadline and conflict checks.
   * @param agent - Real initiating Agent; never a caller-provided workspace id.
   * @param request - Bounded lexical query.
   * @param signal - Cooperative cancellation.
   * @returns usable claims and withheld counts within this project only.
   */
  abstract search(agent: Agent, request: MemorySearchRequest, signal?: AbortSignal): Promise<MemorySearchResult>

  /**
   * Read one currently usable revision; unavailable bodies remain withheld.
   * @param agent - Initiating Agent.
   * @param id - Memory id in the caller's project.
   * @param signal - Cooperative cancellation.
   * @returns a checked revision or an unavailable result; inaccessible ids reject identically to unknown ids.
   */
  abstract read(agent: Agent, id: string, signal?: AbortSignal): Promise<MemoryReadResult>

  /**
   * Persist a candidate and its receipt together, without activating it.
   * @param agent - Initiating Agent and provenance owner.
   * @param input - Candidate input; all fields are runtime validated.
   * @param signal - Cancellation before commit prevents admission; committed retries use the same key.
   * @returns the durable mutation identity; changed input under one key rejects.
   */
  abstract propose(agent: Agent, input: MemoryProposal, signal?: AbortSignal): Promise<MemoryMutation>

  /**
   * Apply a human command to an exact revision under a record-version fence.
   * @param agent - Agent whose session contains the authenticated command invocation.
   * @param request - Command evidence and exact decision target.
   * @param signal - Cooperative cancellation before the commit boundary.
   * @returns the durable decision receipt; fabricated commands, stale versions and invalid sources reject.
   */
  abstract decide(agent: Agent, request: MemoryDecisionRequest, signal?: AbortSignal): Promise<MemoryMutation>

  /**
   * Inspect candidate and historical content through a current human command.
   * @param agent - Receiving Agent.
   * @param request - Exact logged list/show command or decision target identity.
   * @param signal - Cooperative cancellation.
   * @returns detached records authorized for human inspection, never a model approval capability.
   */
  abstract inspect(agent: Agent, request: MemoryInspectionRequest, signal?: AbortSignal): Promise<readonly MemoryInspectedRecord[]>
}

export default ProjectMemory
