/** Seeds one real completed plain-text assistant message for the composed Content capture validation. */
import { writeFile } from 'node:fs/promises'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'

const phase = process.env.DSH_CAPTURE_PROBE_PHASE
const resultPath = process.env.DSH_CAPTURE_PROBE_RESULT

export const name = 'content-capture-probe'
export const inject = ['sessions']

export function apply(ctx) {
  if (phase !== 'seed') return
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  if (ready === undefined || exit === undefined) throw new Error('content capture probe lacks launcher services')
  return ready.onReady(() => {
    void seed(ctx).then(async (result) => {
      await writeFile(resultPath, `${JSON.stringify(result)}\n`)
    }, (error) => {
      process.stderr.write(`content-capture-probe: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      exit(1)
    })
  })
}

async function seed(ctx) {
  const session = ctx.sessions.create('dsh-content-capture-seed', { meta: { cwd: '/project' } })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const message = createAssistantMessage({
    content: [{ type: 'text', text: '组合验证捕获的纯文本回复' }],
    source: { provider: 'test', model: 'test' },
  })
  const event = session.append('assistant/message', { turn: 1, step: 1, message }, { surfaceOp: 'append' })
  return { seeded: true, sessionId: session.id, messageId: String(event.seq) }
}
