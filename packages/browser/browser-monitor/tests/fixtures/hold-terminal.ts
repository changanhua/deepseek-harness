import type { Context } from '@deepseek-ai/cordis'
import type { WorkHandler, WorkKind } from '@changanhua/dsh-task-queue'

export const name = 'hold-monitor-terminal'
export const inject = ['taskQueue']

/** Test-only crash window: the domain committed, but Queue has not received the terminal outcome. */
export function apply(ctx: Context): void {
  const queue = ctx.taskQueue
  const register = queue.registerHandler.bind(queue)
  const replacement: typeof queue.registerHandler = <K extends WorkKind>(handler: WorkHandler<K>,
    options?: { readonly activation?: 'immediate' | 'staged' }) => register({
    ...handler,
    start: (prepared, context) => {
      const live = handler.start(prepared, context)
      if (!isMonitor(handler.kind)) return live
      return { ...live, done: live.done.then(() => new Promise<never>(() => {})) }
    },
  }, options)
  queue.registerHandler = replacement
  ctx.effect(() => () => { queue.registerHandler = register })
}

function isMonitor(kind: string): boolean { return kind === 'browser.monitor.check@1' }
