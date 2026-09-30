/** Model-facing planning tool schemas and strict untrusted-input admission. */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { planningCommandSchema } from '@changanhua/dsh-planning'
import type { PlanningCommand } from '@changanhua/dsh-planning'

export const listParameters = {
  kind: {
    type: 'string',
    enum: ['items', 'proposals'],
    description: 'List current cards or planning proposals. Defaults to items.',
  },

  cursor: { type: 'integer', description: 'Zero-based continuation cursor returned by planning_list.' },

  limit: { type: 'integer', description: 'Requested card count, from 1 through 50.' },
  query: {
    type: 'string',
    description:
      'Optional project-local title, intent, scope, acceptance, or captured-source keywords. Separate terms with spaces.',
  },
} as const

export const handoffParameters = {
  item_id: {
    type: 'string',
    required: true,
    description: 'Adopted planning item explicitly selected by the current user for execution preparation.',
  },

  expected_revision_id: {
    type: 'string',
    required: true,
    description: 'Exact head revision read from the selected item. Keep unchanged when retrying.',
  },
} as const

export function parseHandoff(value: unknown): { itemId: string; expectedRevisionId: string } {
  const input = object(value, ['item_id', 'expected_revision_id'])
  if (
    typeof input.item_id !== 'string' ||
    input.item_id.trim() === '' ||
    input.item_id.length > 256 ||
    typeof input.expected_revision_id !== 'string' ||
    input.expected_revision_id.trim() === '' ||
    input.expected_revision_id.length > 256
  ) {
    throw new HarnessError('Provide an adopted planning item and its exact revision.', 'PLANNING_INVALID_INPUT')
  }
  return { itemId: input.item_id, expectedRevisionId: input.expected_revision_id }
}

export const readParameters = {
  item_id: { type: 'string', description: 'Planning item id returned by planning_list. Use instead of proposal_id.' },

  revision_id: { type: 'string', description: 'Optional immutable revision id; defaults to the item head.' },

  proposal_id: { type: 'string', description: 'Proposal id. Use instead of item_id.' },
  proposal_version: { type: 'integer', description: 'Optional immutable proposal generation; defaults to its head.' },

  section: {
    type: 'string',
    enum: ['overview', 'title', 'intent', 'scope', 'acceptance', 'sources', 'assumptions', 'reviews', 'handoffs'],
    description:
      'Read section. Reviews and handoffs belong to items; assumptions belong to proposals. Omit revision_id to read all item review or handoff history.',
  },
} as const

const draftProperties = {
  title: { type: 'string', required: true },
  intent: { type: 'string', required: true },
  scope: { type: 'array', required: true, items: { type: 'string' } },
  acceptance: { type: 'array', required: true, items: { type: 'string' } },
  sources: {
    type: 'array',
    required: true,
    items: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'manual' },
            text: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'session-event' },
            sessionId: { type: 'string', required: true },
            seq: { type: 'integer', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'content' },
            entryId: { type: 'string', required: true },
            version: { type: 'string', required: true },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, const: 'link' },
            url: { type: 'string', required: true },
            label: { type: 'string', required: true },
          },
        },
      ],
    },
  },
  estimate: {
    type: 'object',
    required: true,
    additionalProperties: false,
    properties: {
      value: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      urgency: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      reuse: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      compounding: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      timeCost: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      tokenCost: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      risk: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      cognitiveCost: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      rationale: { type: 'string', required: true },
    },
  },
  reviewAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
} as const
const commandBase = {
  requestId: { type: 'string', required: true },
  expectedBoardVersion: { type: 'integer', required: true },
} as const
const directCommandSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'create' },
        ...commandBase,
        itemId: { type: 'string' },
        fromReviewId: {
          type: 'string',
          description: 'Source review for an explicitly requested new follow-up; links atomically.',
        },
        lane: { type: 'string', required: true, enum: ['inbox', 'now', 'next', 'later', 'parking'] },
        ...draftProperties,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'revise' },
        ...commandBase,
        itemId: { type: 'string', required: true },
        expectedRevisionId: { type: 'string', required: true },
        ...draftProperties,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'move' },
        ...commandBase,
        itemId: { type: 'string', required: true },
        lane: { type: 'string', required: true, enum: ['inbox', 'now', 'next', 'later', 'parking'] },
        beforeItemId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'dependencies' },
        ...commandBase,
        itemId: { type: 'string', required: true },
        dependsOnItemIds: { type: 'array', required: true, items: { type: 'string' } },
      },
    },

    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'archive' },
        ...commandBase,
        itemId: { type: 'string', required: true },
      },
    },

    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'review' },
        ...commandBase,
        itemId: { type: 'string', required: true },
        expectedRevisionId: { type: 'string', required: true },
        outcome: { type: 'string', required: true, enum: ['completed', 'abandoned', 'learned'] },
        summary: { type: 'string', required: true },
        lessons: { type: 'array', required: true, items: { type: 'string' } },
        followUpItemIds: { type: 'array', required: true, items: { type: 'string' } },
        acceptanceRef: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'follow-up' },
        ...commandBase,
        reviewId: { type: 'string', required: true },
        itemId: { type: 'string', required: true },
      },
    },
  ],
} as const
export const updateParameters = {
  command: {
    ...directCommandSchema,
    description:
      'One explicit direct PlanningCommand. It changes a card only when the current user message directs that exact change.',
  },

  propose: {
    type: 'object',
    additionalProperties: false,
    properties: {
      request_id: { type: 'string', required: true },
      expected_board_version: { type: 'integer', required: true },
      proposal_id: { type: 'string', required: true },
      from_review_id: {
        type: 'string',
        description: 'Source review for a new follow-up draft; preserve it across generations.',
      },
      expected_proposal_version: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
      target_item_id: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true,
        description: 'For any delta, including a Focus delta, use planning_context.plan.id (the owning Plan), never the Focus id or null.' },
      base_revision_id: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true,
        description: 'For a delta, use planning_context.plan.revision, identical to delta.baseRevision.' },
      draft: { type: 'object', required: true, additionalProperties: false, properties: draftProperties },
      suggested_lane: { type: 'string', required: true, enum: ['inbox', 'now', 'next', 'later', 'parking'] },
      assumptions: { type: 'array', required: true, items: { type: 'string' } },
      delta_json: { type: 'string', description: 'Optional JSON delta: {subject:{kind:"plan"|"focus",id},baseRevision,originRef:{kind,id},evidenceRefs?:[{kind,id}],operations:[{kind:"add-state-entry"|"update-state-entry",entry:{id,kind:"objective"|"accepted"|"open",content,sourceRefs?:[{kind,id}]} }|{kind:"remove-state-entry",id}|{kind:"create-focus",id,title,objective?}|{kind:"update-focus",id,expectedVersion,status?,title?,objective?}|{kind:"add-resource-link",id,resource:{kind,id,provider?,revision?,label?},role?}|{kind:"remove-resource-link",id}]}. Delta uses the existing proposal, requires exact adoption, and must match target_item_id/base_revision_id.' },
    },
  },
  accept_proposal: {
    type: 'object',
    additionalProperties: false,
    properties: {
      request_id: { type: 'string', required: true },
      expected_board_version: { type: 'integer', required: true },
      proposal_id: { type: 'string', required: true },
      expected_proposal_version: { type: 'integer', required: true },
    },
  },

  dismiss_proposal: {
    type: 'object',
    additionalProperties: false,
    properties: {
      request_id: { type: 'string', required: true },
      expected_board_version: { type: 'integer', required: true },
      proposal_id: { type: 'string', required: true },
      expected_proposal_version: { type: 'integer', required: true },
    },
  },
} as const

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !keys.includes(key))
  ) {
    throw new HarnessError('Planning input contains unsupported fields.', 'PLANNING_INVALID_INPUT')
  }
  return value as Record<string, unknown>
}

function nestedObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return object(value, keys)
}

export function parseList(value: unknown): {
  cursor: number
  limit: number
  kind: 'items' | 'proposals'
  query?: string
} {
  const input = object(value, ['kind', 'cursor', 'limit', 'query'])
  if (
    (input.cursor !== undefined && (!Number.isSafeInteger(input.cursor) || (input.cursor as number) < 0)) ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 50))
  ) {
    throw new HarnessError('Planning list cursor and limit are invalid.', 'PLANNING_INVALID_INPUT')
  }
  if (input.kind !== undefined && input.kind !== 'items' && input.kind !== 'proposals')
    throw new HarnessError('Planning list kind is invalid.', 'PLANNING_INVALID_INPUT')
  if (
    input.query !== undefined &&
    (typeof input.query !== 'string' || input.query.trim().length === 0 || input.query.length > 256)
  )
    throw new HarnessError('Planning list query must contain 1 to 256 characters.', 'PLANNING_INVALID_INPUT')
  return {
    kind: input.kind ?? 'items',
    cursor: (input.cursor as number | undefined) ?? 0,
    limit: (input.limit as number | undefined) ?? 20,
    ...(input.query === undefined ? {} : { query: input.query.trim() }),
  }
}

export function parseRead(value: unknown):
  | {
    itemId: string
    revisionId?: string
    section: 'overview' | 'title' | 'intent' | 'scope' | 'acceptance' | 'sources' | 'reviews' | 'handoffs'
    cursor: number
    limit: number
  }
  | {
    proposalId: string
    proposalVersion?: number
    section: 'overview' | 'title' | 'intent' | 'scope' | 'acceptance' | 'sources' | 'assumptions'
    cursor: number
    limit: number
  } {
  const input = object(value, [
    'item_id',
    'revision_id',
    'proposal_id',
    'proposal_version',
    'section',
    'cursor',
    'limit',
  ])
  if (
    (input.item_id === undefined) === (input.proposal_id === undefined) ||
    (input.item_id !== undefined &&
      (typeof input.item_id !== 'string' || input.item_id.trim().length === 0 || input.item_id.length > 256)) ||
    (input.revision_id !== undefined &&
      (typeof input.revision_id !== 'string' ||
        input.revision_id.trim().length === 0 ||
        input.revision_id.length > 256))
  ) {
    throw new HarnessError('Provide a planning item id and an optional revision id.', 'PLANNING_INVALID_INPUT')
  }
  if (
    (input.cursor !== undefined && (!Number.isSafeInteger(input.cursor) || (input.cursor as number) < 0)) ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 50))
  ) {
    throw new HarnessError('Provide a valid read cursor and limit.', 'PLANNING_INVALID_INPUT')
  }
  const section = (input.section as string | undefined) ?? 'overview'
  const commonSections = ['overview', 'title', 'intent', 'scope', 'acceptance', 'sources']
  const itemSections = [...commonSections, 'reviews', 'handoffs']
  const proposalSections = [...commonSections, 'assumptions']
  if (
    input.proposal_id !== undefined &&
    (typeof input.proposal_id !== 'string' ||
      (typeof input.proposal_version !== 'undefined' &&
        (!Number.isSafeInteger(input.proposal_version) || (input.proposal_version as number) < 1)) ||
      !proposalSections.includes(section))
  )
    throw new HarnessError('Provide a valid proposal identity.', 'PLANNING_INVALID_INPUT')
  if (input.item_id !== undefined && !itemSections.includes(section))
    throw new HarnessError('Item reads do not support this section.', 'PLANNING_INVALID_INPUT')
  return input.item_id === undefined
    ? {
      proposalId: input.proposal_id as string,
      ...(input.proposal_version === undefined ? {} : { proposalVersion: input.proposal_version as number }),
      section: section as 'overview' | 'title' | 'intent' | 'scope' | 'acceptance' | 'sources' | 'assumptions',
      cursor: (input.cursor as number | undefined) ?? 0,
      limit: (input.limit as number | undefined) ?? 20,
    }
    : {
      itemId: input.item_id,
      ...(input.revision_id === undefined ? {} : { revisionId: input.revision_id }),
      section: section as
          | 'overview'
          | 'title'
          | 'intent'
          | 'scope'
          | 'acceptance'
          | 'sources'
          | 'reviews'
          | 'handoffs',
      cursor: (input.cursor as number | undefined) ?? 0,
      limit: (input.limit as number | undefined) ?? 20,
    }
}

export function parseUpdate(value: unknown): PlanningCommand {
  const input = object(value, ['command', 'propose', 'accept_proposal', 'dismiss_proposal'])
  const operations = Object.entries(input).filter(([, operation]) => operation !== undefined)
  if (operations.length !== 1)
    throw new HarnessError('Provide exactly one planning operation.', 'PLANNING_INVALID_INPUT')
  if (input.command !== undefined) {
    const direct = planningCommandSchema.safeParse(input.command)
    if (!direct.success) throw new HarnessError('Provide a valid direct PlanningCommand.', 'PLANNING_INVALID_INPUT')
    return direct.data
  }
  const operation = operations[0]
  if (operation === undefined)
    throw new HarnessError('Provide exactly one planning operation.', 'PLANNING_INVALID_INPUT')
  const [kind, command] = operation
  const commandValue = nestedObject(
    command,
    kind === 'propose'
      ? [
        'request_id',
        'expected_board_version',
        'proposal_id',
        'expected_proposal_version',
        'target_item_id',
        'base_revision_id',
        'from_review_id',
        'draft',
        'suggested_lane',
        'assumptions',
        'delta_json',
      ]
      : ['request_id', 'expected_board_version', 'proposal_id', 'expected_proposal_version'],
  )
  if (kind === 'propose')
    nestedObject(commandValue.draft, ['title', 'intent', 'scope', 'acceptance', 'sources', 'estimate', 'reviewAt'])
  let delta: unknown
  if (commandValue.delta_json !== undefined) {
    if (typeof commandValue.delta_json !== 'string')
      throw new HarnessError('delta_json must be a JSON string.', 'PLANNING_INVALID_INPUT')
    try { delta = JSON.parse(commandValue.delta_json) as unknown }
    catch { throw new HarnessError('delta_json must contain valid JSON.', 'PLANNING_INVALID_INPUT') }
  }
  const mapped =
    kind === 'propose'
      ? {
        kind,
        requestId: commandValue.request_id,
        expectedBoardVersion: commandValue.expected_board_version,
        proposalId: commandValue.proposal_id,
        expectedProposalVersion: commandValue.expected_proposal_version,
        targetItemId: commandValue.target_item_id,
        baseRevisionId: commandValue.base_revision_id,
        ...(commandValue.from_review_id === undefined ? {} : { fromReviewId: commandValue.from_review_id }),
        draft: commandValue.draft && {
          ...(commandValue.draft as Record<string, unknown>),
          reviewAt: (commandValue.draft as Record<string, unknown>).reviewAt,
        },
        suggestedLane: commandValue.suggested_lane,
        assumptions: commandValue.assumptions,
        ...(commandValue.delta_json === undefined ? {} : { delta }),
      }
      : {
        kind: kind === 'accept_proposal' ? 'accept-proposal' : 'dismiss-proposal',
        requestId: commandValue.request_id,
        expectedBoardVersion: commandValue.expected_board_version,
        proposalId: commandValue.proposal_id,
        expectedProposalVersion: commandValue.expected_proposal_version,
      }
  const parsed = planningCommandSchema.safeParse(mapped)
  if (!parsed.success)
    throw new HarnessError('Provide one valid PlanningCommand without authority fields.', 'PLANNING_INVALID_INPUT')
  return parsed.data
}
