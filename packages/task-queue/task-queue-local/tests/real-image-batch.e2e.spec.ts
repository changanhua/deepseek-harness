import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import ImageGeneration from '@deepseek-ai/dsh-image-generation'
import type { ImageGeneration as ImageGenerationService } from '@deepseek-ai/dsh-image-generation'
import * as ArkcliImageGeneration from '@deepseek-ai/dsh-image-generation-arkcli'
import { createImageGenerateHandler } from '@deepseek-ai/dsh-image-generation-task-queue'
import type { ImageGenerateOutput } from '@deepseek-ai/dsh-image-generation-task-queue'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createVerifiedAgentAuthority, createVerifiedOperatorAuthority } from '@deepseek-ai/dsh-task-queue'
import { describe, expect, it } from 'vitest'
import LocalTaskQueue, { WorkQueueStore } from '../src/index.ts'

const PROMPTS = [
  ['Crime and Punishment', '陀思妥耶夫斯基《罪与罚》方形封面：圣彼得堡昏暗楼梯间俯视构图，青年紧握斧柄停在半明半暗门前，深红与煤黑，高压心理现实主义，书名留出清晰上方排版区，无现成文字。'],
  ['Moby-Dick', '梅尔维尔《白鲸》方形封面：极小捕鲸船被雪白巨鲸从黑蓝风暴海面正下方掀起，泡沫像撕裂纸张，浪尖冷光，宏大负空间与致命尺度对比，现代版画质感，无现成文字。'],
  ['The Brothers Karamazov', '《卡拉马佐夫兄弟》方形封面：三兄弟的侧脸像破碎宗教圣像环绕一张空审判椅，金箔裂纹中渗出暗红，凝视彼此又彼此回避，俄式宗教表现主义，压抑、庄严、冲突，无现成文字。'],
  ['Wuthering Heights', '《呼啸山庄》方形封面：荒原暴风中两个人影隔着一道燃烧般的石墙伸手却无法触及，枯草横扫，乌云压低，黑绿与灼橙，哥特浪漫主义油画，情感撕裂达到顶点，无现成文字。'],
  ['The Great Gatsby', '《了不起的盖茨比》方形封面：奢华金色舞会在画面中心突然坍塌成黑色水面，远处唯一绿色灯火，香槟杯碎片悬停，装饰艺术几何构图，美丽与幻灭同时发生，无现成文字。'],
  ['One Hundred Years of Solitude', '《百年孤独》方形封面：马孔多暴雨中一棵巨树缠绕七代人的微小剪影，黄色蝴蝶被风暴卷成时间漩涡，一座房屋同时新生与腐朽，魔幻现实主义织毯质感，无现成文字。'],
  ['Les Misérables', '《悲惨世界》方形封面：巴黎街垒即将被冲破的一秒，前景是一只保护孩子的粗糙手，旗帜穿过烟雾形成唯一红色斜线，铜版画与电影光影结合，悲壮但不煽情，无现成文字。'],
  ['The Trial', '卡夫卡《审判》方形封面：无尽灰色办公室门框层层套叠，把一个穿黑西装的人压缩成文件上的指纹，天花板垂下一枚没有指针的钟，冷峻超现实主义，制度性窒息，无现成文字。'],
  ['Anna Karenina', '《安娜·卡列尼娜》方形封面：雪夜站台上红裙女人与迎面列车灯光被一条细黑铁轨切开，蒸汽遮住人群，近景舞会珠宝倒映成冰裂纹，俄式写实与象征主义，无现成文字。'],
  ['Don Quixote', '《堂吉诃德》方形封面：骑士与巨型风车在黄昏地平线上正面冲撞，风车叶片的影子却像真正巨人握拳，桑丘在尘暴中追赶，西班牙木刻与荒诞史诗感，无现成文字。'],
] as const

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 7_200; index += 1) {
    if (predicate()) return
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  throw new Error('real ten-image Batch did not settle within 30 minutes')
}

const realIt = process.env.DSH_REAL_IMAGE_BATCH === '1' ? it : it.skip

describe('real Queue-backed ArkCLI image Batch', () => {
  realIt('persists ten Agent Plan covers as Attachment-backed typed results', async () => {
    const repositoryRoot = resolve(import.meta.dirname, '../../../..')
    const evidenceRoot = join(repositoryRoot, 'outputs', 'task-queue-v2-owner-delivery', 'real-image-batch')
    const runtimeRoot = join(evidenceRoot, 'runtime')
    const queueRoot = join(runtimeRoot, 'queue')
    await mkdir(evidenceRoot, { recursive: true })
    const ctx = new Context()
    await ctx.plugin(ImageGeneration)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalAttachmentStore, { dshHome: runtimeRoot })
    await ctx.plugin(SessionStore)
    await ctx.plugin(ArkcliImageGeneration, {
      executable: process.execPath,
      argvPrefix: [join(dirname(process.execPath), 'node_modules', '@volcengine', 'ark-cli', 'scripts', 'run.js')],
      maxImageBytes: 16 * 1024 * 1024,
    })
    const queue = new LocalTaskQueue(ctx, {
      queueRoot,
      maxConcurrent: 10,
      resourceCapacity: { 'image-generation': 3, 'agent-run': 1 },
    })
    let active = 0
    let maximumActive = 0
    let generationCalls = 0
    const trackedGeneration = {
      resolve: ctx.imageGeneration.resolve.bind(ctx.imageGeneration),
      async generate(input, generationContext) {
        active += 1
        generationCalls += 1
        maximumActive = Math.max(maximumActive, active)
        try {
          return await ctx.imageGeneration.generate(input, generationContext)
        } finally {
          active -= 1
        }
      },
    } satisfies Pick<ImageGenerationService, 'resolve' | 'generate'>
    queue.registerHandler(createImageGenerateHandler(trackedGeneration as ImageGenerationService, ctx.attachments))
    const session = ctx.sessions.create(SessionId('queue-v2-real-image-owner'))
    const batchId = await queue.forAgent(createVerifiedAgentAuthority(session)).enqueueBatch({
      kind: 'image.generate@1',
      items: PROMPTS.map(([title, prompt]) => ({
        title,
        input: {
          prompt,
          provider: 'arkcli',
          model: 'doubao-seedream-5.0-lite',
          size: '1920x1920',
          outputFormat: 'png' as const,
          watermark: false,
        },
      })),
      sharedPayload: {},
      idempotencyKey: `ten-classic-covers-${Date.now()}`,
      maxParallel: 3,
    })
    const operator = queue.forOperator(createVerifiedOperatorAuthority())
    await waitFor(() => operator.list().length === 10 && operator.list().every(view => ['succeeded', 'failed', 'unknown', 'canceled'].includes(view.state.status)))
    const views = operator.list()
    expect(views.every(view => view.state.status === 'succeeded')).toBe(true)
    expect(generationCalls).toBe(10)
    expect(maximumActive).toBeLessThanOrEqual(3)
    const resultRecords = views.map((view) => {
      const output = view.result?.output as unknown as ImageGenerateOutput
      return {
        workId: view.work.id,
        attemptId: view.result?.attemptId,
        resultId: view.result?.id,
        title: view.work.title,
        status: view.state.status,
        provider: output.provider,
        model: output.model,
        attachment: output.attachments[0],
      }
    })
    const notifications = queue.forAgent(createVerifiedAgentAuthority(session)).pendingNotifications()
    await ctx.fiber.dispose()

    const reopened = new WorkQueueStore(queueRoot)
    const projection = await reopened.open()
    const attachmentContext = new Context()
    const reopenedAttachments = new LocalAttachmentStore(attachmentContext, { dshHome: runtimeRoot })
    const persisted = []
    try {
      for (const record of resultRecords) {
        const stored = await reopenedAttachments.readImage(record.attachment as never)
        persisted.push({
          ...record,
          sha256: createHash('sha256').update(stored.data).digest('hex'),
          width: stored.ref.width,
          height: stored.ref.height,
        })
      }
      expect(projection.batchesById.get(batchId)?.maxParallel).toBe(3)
      expect(projection.resultsById.size).toBe(10)
    } finally {
      await reopened.close()
      await attachmentContext.fiber.dispose()
    }

    const evidence = {
      version: 1,
      recordedAt: new Date().toISOString(),
      profile: 'agent-plan_cn-beijing_personal',
      resource: 'doubao-seedream-5.0-lite',
      batchId,
      maxParallel: 3,
      maximumObservedGenerationCalls: maximumActive,
      generationCalls,
      taskWorkerStarts: 0,
      notificationIds: notifications.map(notification => notification.id),
      queueRoot: relative(repositoryRoot, queueRoot).replaceAll('\\', '/'),
      results: persisted,
    }
    const evidencePath = join(evidenceRoot, 'evidence.json')
    const body = `${JSON.stringify(evidence, null, 2)}\n`
    await writeFile(evidencePath, body, 'utf8')
    const digest = createHash('sha256').update(await readFile(evidencePath)).digest('hex')
    await writeFile(join(evidenceRoot, 'SHA256SUMS'), `${digest}  evidence.json\n`, 'utf8')
  }, 1_800_000)
})
