/** Seed one former extension capture before the assistant connects; later boots only read it. */
export const name = 'browser-assistant-seed'
export const inject = ['content']
export function apply(ctx) {
  if (process.env.DSH_ASSISTANT_SEED !== '1') return
  return ctx.get('appReady').onReady(async () => {
    const deadline = Date.now() + 10_000
    while (ctx.content.status().phase !== 'ready') {
      if (Date.now() > deadline) throw new Error('Content fixture storage did not become ready: ' + JSON.stringify(ctx.content.status()))
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await ctx.content.execute({ type: 'save-text', entryId: 'web:00000000-0000-4000-8000-000000000001',
      operationId: '00000000-0000-4000-8000-000000000001', title: 'Previous extension capture',
      body: 'Previous browser capture remains readable.', source: { type: 'web-page', scope: 'selection',
        verification: 'unverified', url: 'https://example.com/previous-capture', pageTitle: 'Previous source page',
        site: 'example.com', capturedAt: '2026-09-01T00:00:00.000Z' } }, () => {})
  })
}
