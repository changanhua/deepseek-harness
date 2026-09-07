/** Pure aggregate transitions; authorization, retries and storage belong to the provider. */
import { createHash, randomUUID } from 'node:crypto'
import { ContentError } from '@changanhua/dsh-content'
import type { ContentCommand, ContentEntry, ContentReceipt, ContentVersion, OperationRecord } from '@changanhua/dsh-content'

type CreateCommand = Extract<ContentCommand, { type: 'create' | 'save-text' }>
type EditCommand = Exclude<ContentCommand, CreateCommand>

/**
 * Construct a draft or original; creation and its receipt are one aggregate.
 * @param command - Parsed creation input.
 * @param requestDigest - Canonical request digest retained for retries.
 * @param source - Verified Session capture, or unverified manual text or web-page source.
 * @returns A new aggregate that has not yet been committed.
 */
export function createEntry(
  command: CreateCommand, requestDigest: string,
  source: Exclude<ContentEntry['source'], null> = { type: 'user-provided', scope: 'provided-text', verification: 'unverified' },
): ContentEntry {
  const original = command.type === 'save-text'
  const versionId = original ? randomUUID() : null
  const createdAt = new Date().toISOString()
  const result: ContentReceipt = {
    operationId: command.operationId, entryId: command.entryId, entryRevision: 1,
    draftRevision: original ? null : 1, versionId,
  }
  const operation = { operationId: command.operationId, requestDigest, result }
  const versions: ContentVersion[] = versionId === null ? [] : [{
    id: versionId, number: 1, title: command.title, body: command.body,
    bodySha256: bodyHash(command.body), createdAt, operation,
  }]
  return {
    id: command.entryId, kind: original ? 'original' : 'idea', createdAt, entryRevision: 1,
    source: original ? source : null, versions, headVersionId: versionId,
    draft: original ? null : { title: command.title, body: command.body, draftRevision: 1, basedOnVersionId: null },
    projectRefs: [], favorite: false, archived: false, creation: operation, receipts: [operation],
  }
}

/**
 * Compare the relevant revisions and change a detached entry; the old object is never mutated.
 * @param input - Latest committed aggregate.
 * @param command - Parsed edit and expected revisions.
 * @param requestDigest - Canonical request digest retained for retries.
 * @returns The replacement aggregate, or throws a conflict without changing input.
 */
export function mutateEntry(input: ContentEntry, command: EditCommand, requestDigest: string): ContentEntry {
  const entry = structuredClone(input)
  entry.entryRevision += 1
  const result: ContentReceipt = {
    operationId: command.operationId, entryId: entry.id, entryRevision: entry.entryRevision,
    draftRevision: entry.draft?.draftRevision ?? null, versionId: null,
  }
  const operation: OperationRecord = { operationId: command.operationId, requestDigest, result }
  switch (command.type) {
    case 'start-draft': {
      compare(input.entryRevision, command.expectedEntryRevision)
      const head = entry.versions.at(-1)
      if (entry.draft || !head) throw new ContentError('invalid_transition')
      entry.draft = {
        title: head.title, body: head.body, draftRevision: entry.entryRevision, basedOnVersionId: entry.headVersionId,
      }
      result.draftRevision = entry.draft.draftRevision
      break
    }
    case 'save-draft': {
      const draft = requireDraft(entry, command)
      entry.draft = { ...draft, title: command.title, body: command.body, draftRevision: draft.draftRevision + 1 }
      result.draftRevision = entry.draft.draftRevision
      break
    }
    case 'commit-version': {
      const draft = requireDraft(entry, command)
      compare(entry.headVersionId, command.expectedHeadVersionId)
      const versionId = randomUUID()
      result.versionId = versionId
      result.draftRevision = null
      entry.versions.push({
        id: versionId, number: entry.versions.length + 1, title: draft.title, body: draft.body,
        bodySha256: bodyHash(draft.body), createdAt: new Date().toISOString(), operation,
      })
      entry.headVersionId = versionId
      entry.draft = null
      break
    }
    case 'metadata': {
      compare(input.entryRevision, command.expectedEntryRevision)
      if (command.favorite !== undefined) entry.favorite = command.favorite
      if (command.archived !== undefined) entry.archived = command.archived
      if (command.addProjectRef !== undefined && !entry.projectRefs.includes(command.addProjectRef)) {
        entry.projectRefs.push(command.addProjectRef)
      }
      if (command.removeProjectRef !== undefined) {
        entry.projectRefs = entry.projectRefs.filter(value => value !== command.removeProjectRef)
      }
      break
    }
  }
  entry.receipts = [...entry.receipts, operation].slice(-256)
  return entry
}

function requireDraft(entry: ContentEntry, command: Extract<EditCommand, { type: 'save-draft' | 'commit-version' }>) {
  if (!entry.draft) throw new ContentError('revision_conflict')
  compare(entry.draft.draftRevision, command.expectedDraftRevision)
  compare(entry.draft.basedOnVersionId, command.basedOnVersionId)
  return entry.draft
}

function compare(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new ContentError('revision_conflict')
}

function bodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}
