/** 知识项目持久记录与其业务身份的不变量。 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { generationControlSchema, projectRecordSchema } from './state.ts'

/** Companion 的稳定名称。 */
export const name = 'knowledge-base-invariant'
/** Companion 在不变量注册器就绪后加载。 */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'knowledge_base' || change.operation === 'deleted') return
    if (change.table === 'control') {
      if (change.key !== 'codex' || !generationControlSchema.safeParse(change.value).success) fail('invalid Codex generation control')
      return
    }
    const parsed = projectRecordSchema.safeParse(change.value)
    if (!parsed.success) return fail('knowledge project write does not satisfy its schema')
    if (parsed.data.spec.id !== change.key) return fail('knowledge project key differs from its declared identity')
    for (const [id, stage] of Object.entries(parsed.data.stages)) {
      if (id !== stage.prepared.id || stage.prepared.projectId !== change.key) return fail('stage is bound to another project')
      if (stage.state === 'completed' && (!stage.owner || !stage.responseHash || stage.owner.workId !== stage.workId)) {
        return fail('completed stage lacks its response or Queue owner')
      }
    }
  }, { global: true })
}
/** @param ctx - 注册器上下文。 @returns 可释放的注册。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-knowledge-base', install))
