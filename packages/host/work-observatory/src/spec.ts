import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const sessionId = z.string().transform(SessionId)

/** One Host-stamped browser observation. Client clocks are deliberately absent. */
export const workObservatoryClientSample = z.object({
  clientId: z.string(),
  seq: z.number().int().nonnegative(),
  observedAt: z.number().int().nonnegative(),
  visible: z.boolean(),
  active: z.boolean(),
  sessionId: sessionId.optional(),
  projectPath: z.string().optional(),
})

/** Latest accepted sequence for one browser document identity. */
export const workObservatoryClientState = z.object({
  lastSeq: z.number().int().nonnegative(),
  lastObservedAt: z.number().int().nonnegative(),
  stateStartedAt: z.number().int().nonnegative(),
  visible: z.boolean(),
  active: z.boolean(),
  sessionId: sessionId.optional(),
  projectPath: z.string().optional(),
})

/** One Session step projected from the durable Session event vocabulary. */
export const workObservatoryAgentStep = z.object({
  sessionId,
  turn: z.number().int().positive(),
  step: z.number().int().positive(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  projectPath: z.string().optional(),
})

export type WorkObservatoryClientSample = z.infer<typeof workObservatoryClientSample>
export type WorkObservatoryClientState = z.infer<typeof workObservatoryClientState>
export type WorkObservatoryAgentStep = z.infer<typeof workObservatoryAgentStep>

/** Host-durable Work Observatory domain over the repository storage seam. */
export const workObservatoryDomainSpec = defineDomain({
  name: 'work_observatory',
  version: 1,
  layout: 'per-record' as const,
  tables: {
    samples: domainTable<string, WorkObservatoryClientSample>(workObservatoryClientSample),
    clients: domainTable<string, WorkObservatoryClientState>(workObservatoryClientState),
    steps: domainTable<string, WorkObservatoryAgentStep>(workObservatoryAgentStep),
  },
})
