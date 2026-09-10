const phase = process.env.DSH_CONTENT_PROBE_PHASE
const resultPath = process.env.DSH_CONTENT_PROBE_RESULT
const timeoutMs = 15_000
const original = '第一行\r\n第二行：原文'
const revised = '第一行\r\n第二行：版本二'
const source = Object.freeze({
  type: 'session-message',
  sessionId: 'b2bf88f9-9988-45dc-b4ff-3d4dc05c23e6',
  messageId: '1db244bb-0a95-422b-834b-06e3e0971528',
  captureId: '3c1a9eb7-ec38-4370-998d-448c54a2ab14',
  scope: 'full-message',
  verification: 'host-verified',
  boundary: 'completed-text',
})

// This test-only domain deliberately avoids imports. It verifies that the
// ordinary route remains usable when opening the content route fails.
const ordinarySpec = Object.freeze({
  name: 'ordinary_probe',
  version: 1,
  layout: 'single',
  tables: {
    rows: {
      valueSchema: {
        parse(value) {
          if (typeof value?.value !== 'string') throw new Error('ordinary probe record is invalid')
          return value
        },
      },
    },
  },
})

export const name = 'content-domain-probe'
export const inject = ['content', 'storageDomain']

function authorize() {}

async function waitForContent(content, allowed) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = content.status()
    if (allowed.includes(status.phase)) return status
    if (status.phase === 'unavailable' && status.reason !== 'unavailable') {
      throw new Error(`content domain rejected its medium: ${JSON.stringify(status)}`)
    }
    if (Date.now() >= deadline) throw new Error(`content domain did not settle: ${JSON.stringify(status)}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function entryView(content, id) {
  const entry = content.get(id, authorize)
  if (entry === undefined) throw new Error(`missing captured content ${id}`)
  if (entry.versions.length !== 2 || entry.versions[0]?.body !== original || entry.versions[1]?.body !== revised) {
    throw new Error('content versions did not preserve exact original and revised text')
  }
  return {
    id,
    original: entry.versions[0].body,
    current: entry.versions[1].body,
    versions: entry.versions.length,
  }
}

async function resolveSource(request) {
  if (request.sessionId !== source.sessionId || request.messageId !== source.messageId) {
    throw new Error('capture request did not preserve the fixed source identity')
  }
  return { source, title: '含换行的原始内容', body: original }
}

async function execute(ctx) {
  const content = ctx.content
  const ordinary = await ctx.storageDomain.open(ordinarySpec)
  try {
    if (phase === 'write') {
      await waitForContent(content, ['ready'])
      const capture = await content.capture({
        operationId: 'capture-4d9f29d0-b24c-4a7c-84be-8524ccddac77',
        sessionId: source.sessionId,
        messageId: source.messageId,
      }, resolveSource, authorize)
      const started = await content.execute({
        type: 'start-draft',
        entryId: capture.entryId,
        operationId: 'draft-start-4a88d5e6-3bd6-4707-9316-75ad666c2c4d',
        expectedEntryRevision: capture.entryRevision,
      }, authorize)
      const saved = await content.execute({
        type: 'save-draft',
        entryId: capture.entryId,
        operationId: 'draft-save-09bce915-e472-419e-b4fa-f0a0c8a5140c',
        expectedDraftRevision: started.draftRevision,
        basedOnVersionId: capture.versionId,
        title: '含换行的第二版',
        body: revised,
      }, authorize)
      const commitCommand = {
        type: 'commit-version',
        entryId: capture.entryId,
        operationId: 'draft-commit-8eb88a80-4c84-4bfb-a28f-a2dce2c625a8',
        expectedDraftRevision: saved.draftRevision,
        basedOnVersionId: capture.versionId,
        expectedHeadVersionId: capture.versionId,
      }
      const committed = await content.execute(commitCommand, authorize)
      await ordinary.table('rows').put('ordinary', { value: 'written' })
      return {
        phase,
        status: content.status(),
        ordinary: ordinary.table('rows').get('ordinary')?.value,
        entry: entryView(content, capture.entryId),
        receipts: { capture, commit: committed },
      }
    }

    if (phase === 'read') {
      await waitForContent(content, ['ready'])
      const snapshot = content.snapshot(authorize)
      if (snapshot.entries.length !== 1) throw new Error('content snapshot did not retain one captured entry')
      const entry = snapshot.entries[0]
      const capture = await content.capture({
        operationId: 'capture-4d9f29d0-b24c-4a7c-84be-8524ccddac77',
        sessionId: source.sessionId,
        messageId: source.messageId,
      }, resolveSource, authorize)
      const committed = await content.execute({
        type: 'commit-version',
        entryId: entry.id,
        operationId: 'draft-commit-8eb88a80-4c84-4bfb-a28f-a2dce2c625a8',
        expectedDraftRevision: 3,
        basedOnVersionId: entry.versions[0]?.id ?? null,
        expectedHeadVersionId: entry.versions[0]?.id ?? null,
      }, authorize)
      const knownCapture = content.receipt(entry.id, capture.operationId, authorize)
      const knownCommit = content.receipt(entry.id, committed.operationId, authorize)
      if (JSON.stringify(knownCapture) !== JSON.stringify(capture) || JSON.stringify(knownCommit) !== JSON.stringify(committed)) {
        throw new Error('receipt lookup did not reproduce the retried durable results')
      }
      await ordinary.table('rows').put('ordinary', { value: 'reopened' })
      return {
        phase,
        status: content.status(),
        ordinary: ordinary.table('rows').get('ordinary')?.value,
        entry: entryView(content, entry.id),
        receipts: { capture, commit: committed },
      }
    }

    if (phase === 'invalid-identity') {
      const status = await waitForContent(content, ['ready', 'unavailable'])
      if (status.phase !== 'unavailable') throw new Error('content domain opened a database with the wrong application identity')
      await ordinary.table('rows').put('ordinary', { value: 'survived-content-rejection' })
      return {
        phase,
        status,
        ordinary: ordinary.table('rows').get('ordinary')?.value,
      }
    }

    throw new Error(`unknown content probe phase ${JSON.stringify(phase)}`)
  } finally {
    await ordinary.close()
  }
}

export function apply(ctx) {
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  if (ready === undefined || exit === undefined) throw new Error('content probe lacks launcher services')
  return ready.onReady(() => {
    void execute(ctx).then(async (result) => {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(resultPath, `${JSON.stringify(result)}\n`)
      exit(0)
    }, async (error) => {
      process.stderr.write(`content-domain-probe: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      exit(1)
    })
  })
}
