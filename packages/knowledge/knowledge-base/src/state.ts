/**
 * 知识项目的业务聚合。一次项目记录替换提交完整业务事实；
 * Work/Attempt 状态仍由 Queue 独占。
 * @module @changanhua/dsh-knowledge-base/state
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { knowledgeEntrySchema, knowledgeIdSchema, projectSpecSchema, sourceSnapshotSchema } from './model.ts'

/** 模型审查只判断主张支持关系，不替代确定性来源/依赖检查。 */
export const reviewDecisionSchema = z.strictObject({
  status: z.enum(['pass', 'fail', 'unresolved']),
  issues: z.array(z.string().min(1).max(4000)).max(100),
  summary: z.string().min(1).max(8000),
}).superRefine((value, ctx) => {
  if (value.status === 'pass' && value.issues.length > 0) ctx.addIssue({ code: 'custom', message: 'passing review has issues' })
})
const hash = z.string().regex(/^[a-f0-9]{64}$/u)
/** 适配器实际可观察的执行配置；原生继承的模型及用量可能不可得。 */
export const executionConfigSchema = z.strictObject({
  provider: z.literal('codex-native'), adapterVersion: z.literal('app-server-run-v1'),
  requestedModel: z.string().min(1).nullable(), observedModel: z.null(),
  permissionMode: z.enum(['never', 'approve-for-me', 'dangerously-bypass-approvals-and-sandbox']),
  usage: z.literal('unknown'),
})
/** 已提交工作版本及其检查身份。 */
export const entryCommitSchema = z.strictObject({
  entry: knowledgeEntrySchema, contentHash: hash, artifactHash: hash,
  inputHash: hash, revision: z.number().int().positive(),
  stale: z.boolean(),
  review: z.strictObject({
    fingerprint: hash, decision: reviewDecisionSchema, stageId: hash,
  }).nullable(),
})
/** 先固定模型输入；桥接层据此做幂等 Queue 准入。 */
export const preparedStageSchema = z.strictObject({
  id: hash, projectId: knowledgeIdSchema, entryId: knowledgeIdSchema,
  action: z.enum(['plan', 'generate', 'review']), inputHash: hash,
  expectedHash: hash.nullable(), prompt: z.string().min(1).max(500_000),
})
/** 一个结果的不可变来源身份，用于恢复时核验归属。 */
export const stageOwnerSchema = z.strictObject({
  workId: z.string().min(1).max(200), attemptId: z.string().min(1).max(200),
})
/** 业务阶段的产物与提交进度，不复制 Queue 的尝试状态。 */
export const stageRecordSchema = z.strictObject({
  prepared: preparedStageSchema, workId: z.string().min(1).max(200).nullable(),
  owner: stageOwnerSchema.nullable(), responseHash: hash.nullable(),
  candidate: entryCommitSchema.nullable(),
  decision: reviewDecisionSchema.nullable(),
  execution: executionConfigSchema.nullable().default(null),
  state: z.enum(['prepared', 'publishing', 'completed']),
})
/** 不可变发布清单及其完整性身份。 */
export const releaseRecordSchema = z.strictObject({
  version: knowledgeIdSchema, manifestHash: hash,
  entries: z.record(knowledgeIdSchema, hash),
})
/** 一个知识项目的权威业务记录，外部调用不得直接写此结构。 */
export const projectRecordSchema = z.strictObject({
  spec: projectSpecSchema, approvedHash: hash.nullable(),
  sources: z.record(z.string(), sourceSnapshotSchema),
  latestSources: z.record(knowledgeIdSchema, hash),
  sourceAvailability: z.record(knowledgeIdSchema, z.strictObject({
    status: z.enum(['available', 'unavailable']), checkedAt: z.iso.datetime(),
    message: z.string().max(8000).nullable(),
    rawContentHash: hash.nullable().default(null), extractorVersion: z.string().min(1).max(200).nullable().default(null),
  })).default({}),
  entries: z.record(knowledgeIdSchema, entryCommitSchema),
  stages: z.record(hash, stageRecordSchema),
  releases: z.record(knowledgeIdSchema, releaseRecordSchema),
  currentRelease: knowledgeIdSchema.nullable(),
})
/** 本版本的知识业务存储域。 */
export const generationControlSchema = z.strictObject({
  stopped: z.strictObject({ reason: z.string().min(1).max(8000), at: z.iso.datetime() }).nullable(),
})
/** 知识项目与生成控制记录使用的持久 Domain 声明。 */
export const knowledgeDomainSpec = defineDomain({
  name: 'knowledge_base', version: 1,
  tables: {
    projects: domainTable<string, z.infer<typeof projectRecordSchema>>(projectRecordSchema),
    control: domainTable<string, z.infer<typeof generationControlSchema>>(generationControlSchema),
  },
})
/** 模型审查结果。 */
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>
/** 已提交条目。 */
export type EntryCommit = z.infer<typeof entryCommitSchema>
/** 入队前冻结的阶段。 */
export type PreparedStage = z.infer<typeof preparedStageSchema>
/** Queue 工作与尝试身份。 */
export type StageOwner = z.infer<typeof stageOwnerSchema>
/** 持久业务阶段。 */
export type StageRecord = z.infer<typeof stageRecordSchema>
/** 权威项目聚合。 */
export type ProjectRecord = z.infer<typeof projectRecordSchema>
