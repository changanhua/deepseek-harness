import { createAssistantMessage } from '../../../../packages/llm/llm/lib/index.js'

export const name = 'content-restart-seed'
export const inject = ['sessions']

export function apply(ctx) {
  if (process.env.DSH_CONTENT_RESTART_SEED !== '1') return
  return ctx.get('appReady').onReady(() => {
    const session = ctx.sessions.create('content-restart-browser', { meta: { cwd: process.cwd() } })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'Browser restart original' }],
      source: { provider: 'test', model: 'test' },
    })
    session.append('assistant/message', { turn: 1, step: 1, message }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })
}
