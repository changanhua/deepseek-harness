import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { runVerifierFiles, type VerifierFileConfig } from './run.ts'

export { runVerifierFiles, type VerifierFileConfig } from './run.ts'
export { verifySnapshot } from './verify.ts'

export const name = 'eval-verifier'
export const inject = ['appReady', 'appExit', 'sessions', 'sessionPersistence']
/** A one-shot, Host-generated Profile row. Paths are never Agent input. */
export interface Config extends VerifierFileConfig {
  /** Host-written profile identity; never command-line input. */
  readonly profile: string
  /** Host-derived identity of the frozen checker configuration. */
  readonly configDigest: string
}

/** Execute the fixed checker at Profile readiness, then exit. */
export function apply(ctx: Context, config: Config): void {
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  if (!ready) throw new Error('eval-verifier-missing-app-ready')
  if (!exit) throw new Error('eval-verifier-missing-app-exit')
  ctx.effect(() => ready.onReady(() => {
    void (async () => {
      const session = ctx.sessions.create()
      const stored = await ctx.sessionPersistence.create(session.header)
      try {
        await stored.flush()
        await runVerifierFiles(config, { sessionId: String(session.id), profile: config.profile, configDigest: config.configDigest })
      } finally { await stored.close() }
    })().then(() =>{  exit(0) }, () =>{  exit(1) })
  }), 'eval-verifier.run')
}
