import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { KnowledgeRepository, parseEntry, renderEntry } from '../src/repository.ts'
import { canonicalHash } from '../src/model.ts'

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []
const spec = {
  id: 'game-vibe', title: 'AI 游戏开发', readerTask: '写出可委托 AI 的原型任务', language: 'zh-CN',
  seeds: [{
    id: 'prototype', title: '玩法原型', goal: '先验证核心玩法', type: 'method',
    depends: [], sourceIds: ['engine'], required: true,
  }],
}
async function harness(root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'knowledge-repository-'))
  if (!roots.includes(root)) roots.push(root)
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'domain'))
  ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  const repo = await KnowledgeRepository.open(facility, join(root, 'content'))
  const close = async () => { await repo.close(); await backend.close(); await ctx.fiber.dispose() }
  disposers.push(close)
  return { root, repo, close }
}
afterEach(async () => {
  for (const close of disposers.splice(0).reverse()) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('知识业务的持久提交', () => {
  it('停止闸跨重启保留，只有显式恢复才能解除', async () => {
    const { repo, root, close } = await harness()
    expect(repo.generationStop()).toBeNull()
    await repo.pauseGeneration('HTTP status: 429')
    const stopped = repo.generationStop()
    await close()
    const reopened = await harness(root)
    expect(reopened.repo.generationStop()).toEqual(stopped)
    await reopened.repo.resumeGeneration()
    expect(reopened.repo.generationStop()).toBeNull()
  })

  it('格式拒绝保留原始响应及工作归属，不产生条目', async () => {
    const { repo } = await harness()
    await repo.create(spec)
    await repo.ingest(spec.id, { sourceId: 'engine', title: '资料', text: '玩法。', fetchedAt: '2026-09-08T00:00:00Z' })
    await repo.confirmPlan(spec.id, canonicalHash(spec))
    const stage = await repo.prepareStage(spec.id, 'prototype', 'generate')
    await repo.bindStage(spec.id, stage.id, 'work-invalid')
    await expect(repo.acceptResult(spec.id, stage.id, '{"conditions":[]}', {
      workId: 'work-invalid', attemptId: 'attempt-invalid',
    })).rejects.toMatchObject({ name: 'KnowledgeResultValidationError' })
    const saved = repo.get(spec.id).stages[stage.id]!
    expect(saved.owner?.workId).toBe('work-invalid')
    expect(await repo.files.readArtifact(spec.id, saved.responseHash!)).toBe('{"conditions":[]}')
    expect(repo.get(spec.id).entries.prototype).toBeUndefined()
  })

  it('未确认规格可让 AI 提出地图；未通过审查的条目产生带反馈的新修订阶段', async () => {
    const { repo } = await harness()
    await repo.create({ ...spec, seeds: [] })
    const source = await repo.ingest('game-vibe', {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。',
      fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    const plan = await repo.prepareStage('game-vibe', 'plan', 'plan')
    expect(plan.prompt).toContain(source.snapshotId)
    await repo.bindStage('game-vibe', plan.id, 'work-plan')
    await repo.acceptResult('game-vibe', plan.id, JSON.stringify({ seeds: spec.seeds }), {
      workId: 'work-plan', attemptId: 'attempt-plan',
    })
    expect(repo.get('game-vibe').spec.seeds).toEqual(spec.seeds)
    expect(repo.get('game-vibe').approvedHash).toBeNull()
    await repo.confirmPlan('game-vibe', canonicalHash(spec))
    const generation = await repo.prepareStage('game-vibe', 'prototype', 'generate')
    await repo.bindStage('game-vibe', generation.id, 'work-entry')
    await repo.acceptResult('game-vibe', generation.id, JSON.stringify({
      id: 'prototype', title: '玩法原型', type: 'method', seedIds: ['prototype'],
      depends: [], related: [], conditions: '个人小型原型', body: '先做原型。',
      citations: [{ sourceId: 'engine', snapshotId: source.snapshotId, quote: '先验证核心玩法。' }],
    }), { workId: 'work-entry', attemptId: 'attempt-entry' })
    const review = await repo.prepareStage('game-vibe', 'prototype', 'review')
    await repo.bindStage('game-vibe', review.id, 'work-bad-review')
    await repo.acceptResult('game-vibe', review.id, JSON.stringify({
      status: 'fail', issues: ['没有可观察的试玩验收标准'], summary: '步骤不足以判断完成。',
    }), { workId: 'work-bad-review', attemptId: 'attempt-bad-review' })
    const revision = await repo.prepareStage('game-vibe', 'prototype', 'generate')
    expect(revision.id).not.toBe(generation.id)
    expect(revision.prompt).toContain('没有可观察的试玩验收标准')
  })

  it('文件提交中断后根据持久候选恢复，发布检查与回退保护用户工作区', async () => {
    const { repo, root, close } = await harness()
    await repo.create(spec)
    const source = await repo.ingest('game-vibe', {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。',
      fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repo.confirmPlan('game-vibe', canonicalHash(spec))
    const stage = await repo.prepareStage('game-vibe', 'prototype', 'generate')
    await repo.bindStage('game-vibe', stage.id, 'work-recover')
    const entry = {
      id: 'prototype', title: '玩法原型', type: 'method' as const, seedIds: ['prototype'],
      depends: [], related: [], conditions: '个人小型原型', body: '描述可试玩的核心循环。',
      citations: [{ sourceId: 'engine', snapshotId: source.snapshotId, quote: '先验证核心玩法。' }],
    }
    vi.spyOn(repo.files, 'writeEntry').mockRejectedValueOnce(new Error('injected interruption'))
    await expect(repo.acceptResult('game-vibe', stage.id, JSON.stringify(entry), {
      workId: 'work-recover', attemptId: 'attempt-recover',
    })).rejects.toThrow('injected interruption')
    expect(repo.get('game-vibe').stages[stage.id]?.state).toBe('publishing')
    await close()
    const reopened = await harness(root)
    const recovered = await reopened.repo.recoverStage('game-vibe', stage.id, 'work-recover')
    expect(recovered?.state).toBe('completed')
    expect(await reopened.repo.files.readEntry('game-vibe', 'prototype')).toBe(renderEntry(entry))
    await expect(reopened.repo.publish('game-vibe', 'v1')).rejects.toThrow(/check/)
    const review = await reopened.repo.prepareStage('game-vibe', 'prototype', 'review')
    await reopened.repo.bindStage('game-vibe', review.id, 'work-review')
    await reopened.repo.acceptResult('game-vibe', review.id, JSON.stringify({
      status: 'pass', issues: [], summary: '样本主张获来源支持。',
    }), { workId: 'work-review', attemptId: 'attempt-review' })
    expect((await reopened.repo.check('game-vibe')).publishable).toBe(true)
    vi.spyOn(reopened.repo.files, 'selectRelease').mockRejectedValueOnce(new Error('injected pointer failure'))
    await expect(reopened.repo.publish('game-vibe', 'v1')).rejects.toThrow('injected pointer failure')
    expect(reopened.repo.get('game-vibe').currentRelease).toBeNull()
    const released = await reopened.repo.publish('game-vibe', 'v1')
    expect(await readFile(join(released.path, 'entry-prototype.md'), 'utf8')).toBe(renderEntry(entry))
    expect(await readFile(join(released.path, 'sources.json'), 'utf8')).not.toContain('先验证核心玩法。')
    expect(await readFile(join(released.path, 'sources.json'), 'utf8')).toContain(source.snapshotId)
    const directory = await reopened.repo.files.workingDirectory('game-vibe')
    const edited = renderEntry({ ...entry, body: '人工补充试玩验收步骤。' })
    await writeFile(join(directory, 'entries', 'prototype.md'), edited)
    expect((await reopened.repo.check('game-vibe')).publishable).toBe(false)
    await reopened.repo.rollback('game-vibe', 'v1')
    expect(await reopened.repo.files.readEntry('game-vibe', 'prototype')).toBe(edited)
    await reopened.repo.adopt('game-vibe', 'prototype')
    expect(reopened.repo.get('game-vibe').entries.prototype?.entry.body).toBe('人工补充试玩验收步骤。')
    expect((await reopened.repo.check('game-vibe')).entries[0]?.issues).toContain('review_not_passed')
  })

  it('规格确认后准备稳定阶段，来源变化生成新阶段并保留旧版本', async () => {
    const { repo } = await harness()
    await repo.create(spec)
    const snapshot = await repo.ingest('game-vibe', {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。',
      fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await expect(repo.prepareStage('game-vibe', 'prototype', 'generate')).rejects.toThrow(/confirmed/)
    await repo.confirmPlan('game-vibe', canonicalHash(spec))
    const stage = await repo.prepareStage('game-vibe', 'prototype', 'generate')
    expect(stage).toEqual(await repo.prepareStage('game-vibe', 'prototype', 'generate'))
    expect(stage.prompt).toContain(snapshot.snapshotId)
    const newer = await repo.ingest('game-vibe', {
      sourceId: 'engine', title: '资料', text: '先验证玩家是否愿意重复核心玩法。',
      fetchedAt: '2026-09-09T00:00:00.000Z',
    })
    expect((await repo.prepareStage('game-vibe', 'prototype', 'generate')).id).not.toBe(stage.id)
    expect(repo.get('game-vibe').sources['engine:' + snapshot.snapshotId]).toEqual(snapshot)
    expect(repo.get('game-vibe').latestSources.engine).toBe(newer.snapshotId)
  })

  it('Queue 工作绑定和已完成结果重启后仍可取回，不凭重试生成新内容', async () => {
    const { repo, root, close } = await harness()
    await repo.create(spec)
    const source = await repo.ingest('game-vibe', {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。',
      fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repo.confirmPlan('game-vibe', canonicalHash(spec))
    const stage = await repo.prepareStage('game-vibe', 'prototype', 'generate')
    await repo.bindStage('game-vibe', stage.id, 'work-1')
    const response = JSON.stringify({
      id: 'prototype', title: '玩法原型', type: 'method', seedIds: ['prototype'],
      depends: [], related: [], conditions: '个人小型原型',
      body: '把核心玩法描述为一个可试玩的最小循环。',
      citations: [{ sourceId: 'engine', snapshotId: source.snapshotId, quote: '先验证核心玩法。' }],
    })
    await repo.captureResponse('game-vibe', stage.id, response, { workId: 'work-1', attemptId: 'attempt-1' })
    expect(repo.get('game-vibe').entries.prototype).toBeUndefined()
    const result = await repo.recoverStage('game-vibe', stage.id, 'work-1')
    if (!result) throw new Error('expected captured result recovery')
    expect(result.state).toBe('completed')
    await close()
    const reopened = await harness(root)
    expect(reopened.repo.get('game-vibe').stages[stage.id]?.state).toBe('completed')
    expect(await reopened.repo.completedStage('game-vibe', stage.id, 'work-1')).toEqual(result)
    await expect(reopened.repo.completedStage('game-vibe', stage.id, 'another-work')).rejects.toThrow(/owner/)
    const status = await reopened.repo.check('game-vibe')
    expect(status.publishable).toBe(false)
    expect(status.entries[0]?.issues).toContain('review_not_passed')
  })

  it('来源抓取失败保留历史；规格改变使已有条目失效且确认需重新满足来源', async () => {
    const { repo } = await harness()
    await repo.create(spec)
    const first = await repo.ingest(spec.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repo.recordSourceFailure(spec.id, 'engine', '连接超时')
    const failed = repo.get(spec.id)
    expect(failed.sources['engine:' + first.snapshotId]).toEqual(first)
    expect(failed.latestSources.engine).toBe(first.snapshotId)
    expect(failed.sourceAvailability.engine).toMatchObject({ status: 'unavailable', message: '连接超时' })
    await repo.confirmPlan(spec.id, canonicalHash(spec))
    await repo.setPlan(spec.id, [{ ...spec.seeds[0]!, goal: '重新验证核心玩法' }])
    expect(repo.get(spec.id).approvedHash).toBeNull()
    await expect(repo.confirmPlan(spec.id, canonicalHash(spec))).rejects.toThrow(/plan changed/)
    expect(() => repo.recordSourceFailure(spec.id, '../bad', 'x')).toThrow()
  })

  it('拒绝模型格式后可基于已保存响应建立修正阶段，旧输入改变则拒绝修正', async () => {
    const { repo } = await harness()
    await repo.create(spec)
    await repo.ingest(spec.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repo.confirmPlan(spec.id, canonicalHash(spec))
    const stage = await repo.prepareStage(spec.id, 'prototype', 'generate')
    await repo.bindStage(spec.id, stage.id, 'work-correction')
    await expect(repo.acceptResult(spec.id, stage.id, '{"id":"prototype"}', {
      workId: 'work-correction', attemptId: 'attempt-correction',
    })).rejects.toMatchObject({ name: 'KnowledgeResultValidationError' })
    const correction = await repo.prepareCorrection(spec.id, stage.id, '缺少条目字段')
    expect(correction.id).not.toBe(stage.id)
    expect(correction.prompt).toContain('缺少条目字段')
    expect(correction.prompt).toContain('\\"id\\":\\"prototype\\"')
    await repo.ingest(spec.id, {
      sourceId: 'engine', title: '资料', text: '新版来源。', fetchedAt: '2026-09-09T00:00:00.000Z',
    })
    await expect(repo.prepareCorrection(spec.id, stage.id, '再次修正')).rejects.toThrow(/stale/)
  })

  it('明确导出部分草稿而不改变发布指针，并在重新打开时重建完整发布投影', async () => {
    const { repo, root, close } = await harness()
    await repo.create(spec)
    const source = await repo.ingest(spec.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repo.confirmPlan(spec.id, canonicalHash(spec))
    const stage = await repo.prepareStage(spec.id, 'prototype', 'generate')
    await repo.bindStage(spec.id, stage.id, 'work-draft')
    await repo.acceptResult(spec.id, stage.id, JSON.stringify({
      id: 'prototype', title: '玩法原型', type: 'method', seedIds: ['prototype'], depends: [], related: [],
      conditions: '小型原型', body: '先验证核心玩法。',
      citations: [{ sourceId: 'engine', snapshotId: source.snapshotId, quote: '先验证核心玩法。' }],
    }), { workId: 'work-draft', attemptId: 'attempt-draft' })
    const draft = await repo.exportDraft(spec.id, 'preview')
    expect(repo.get(spec.id).currentRelease).toBeNull()
    expect(await readFile(join(draft.path, 'README.md'), 'utf8')).toContain('部分草稿')
    expect(await readFile(join(draft.path, 'manifest.json'), 'utf8')).toContain('"status": "draft"')
    const review = await repo.prepareStage(spec.id, 'prototype', 'review')
    await repo.bindStage(spec.id, review.id, 'work-publish')
    await repo.acceptResult(spec.id, review.id, JSON.stringify({ status: 'pass', issues: [], summary: '来源支持。' }), {
      workId: 'work-publish', attemptId: 'attempt-publish',
    })
    await repo.publish(spec.id, 'v1')
    await repo.files.selectRelease(spec.id, null)
    await close()
    const reopened = await harness(root)
    expect(reopened.repo.get(spec.id).currentRelease).toBe('v1')
    expect(await readFile(join(root, 'content', 'projects', spec.id, 'current-release.json'), 'utf8')).toContain('v1')
  })

  it('核验两个完整发布后按条目摘要返回改动，并拒绝未知版本', async () => {
    const { repo } = await harness()
    await repo.create(spec)
    const source = await repo.ingest(spec.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repo.confirmPlan(spec.id, canonicalHash(spec))
    const generated = await repo.prepareStage(spec.id, 'prototype', 'generate')
    await repo.bindStage(spec.id, generated.id, 'work-diff-1')
    const first = {
      id: 'prototype', title: '玩法原型', type: 'method' as const, seedIds: ['prototype'], depends: [], related: [],
      conditions: '小型原型', body: '先验证核心玩法。',
      citations: [{ sourceId: 'engine', snapshotId: source.snapshotId, quote: '先验证核心玩法。' }],
    }
    await repo.acceptResult(spec.id, generated.id, JSON.stringify(first), { workId: 'work-diff-1', attemptId: 'attempt-diff-1' })
    const firstReview = await repo.prepareStage(spec.id, 'prototype', 'review')
    await repo.bindStage(spec.id, firstReview.id, 'work-diff-review-1')
    await repo.acceptResult(spec.id, firstReview.id, JSON.stringify({ status: 'pass', issues: [], summary: '支持。' }), {
      workId: 'work-diff-review-1', attemptId: 'attempt-diff-review-1',
    })
    await repo.publish(spec.id, 'v1')
    const directory = await repo.files.workingDirectory(spec.id)
    await writeFile(join(directory, 'entries', 'prototype.md'), renderEntry({ ...first, body: '先验证核心玩法，再记录试玩反馈。' }))
    await repo.adopt(spec.id, 'prototype')
    const secondReview = await repo.prepareStage(spec.id, 'prototype', 'review')
    await repo.bindStage(spec.id, secondReview.id, 'work-diff-review-2')
    await repo.acceptResult(spec.id, secondReview.id, JSON.stringify({ status: 'pass', issues: [], summary: '支持。' }), {
      workId: 'work-diff-review-2', attemptId: 'attempt-diff-review-2',
    })
    await repo.publish(spec.id, 'v2')
    await expect(repo.diffReleases(spec.id, 'missing', 'v2')).rejects.toThrow(/unknown release/)
    await expect(repo.diffReleases(spec.id, 'v1', 'v2')).resolves.toEqual({
      from: 'v1', to: 'v2', manifestChanged: true, added: [], removed: [], changed: ['prototype'],
    })
  })

  it('同规格创建可重入，冲突规格拒绝；关闭后不再接受新写入', async () => {
    const { repo } = await harness()
    const [left, right] = await Promise.all([repo.create(spec), repo.create(spec)])
    expect(left.spec).toEqual(right.spec)
    await expect(repo.create({ ...spec, title: '另一项目说明' })).rejects.toThrow(/another spec/)
    await repo.close()
    await expect(repo.create({ ...spec, id: 'second' })).rejects.toThrow(/closed/)
  })

  it('拒绝损坏工作稿与阶段所有者冲突，并把捕获的原响应限定为同一工作', async () => {
    expect(() => parseEntry('正文没有 frontmatter')).toThrow(/frontmatter/)
    expect(() => parseEntry('---\n- array\n---\n正文')).toThrow(/frontmatter/)
    const { repo } = await harness()
    await repo.create(spec)
    expect(repo.list()).toEqual([expect.objectContaining({ id: spec.id })])
    await repo.ingest(spec.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repo.confirmPlan(spec.id, canonicalHash(spec))
    const stage = await repo.prepareStage(spec.id, 'prototype', 'generate')
    await repo.bindStage(spec.id, stage.id, 'work-capture')
    await expect(repo.bindStage(spec.id, stage.id, 'other-work')).rejects.toThrow(/owner conflict/)
    await expect(repo.captureResponse(spec.id, stage.id, '{}', { workId: 'other-work', attemptId: 'a' })).rejects.toThrow(/owner mismatch/)
    await repo.captureResponse(spec.id, stage.id, '{}', { workId: 'work-capture', attemptId: 'a' })
    await expect(repo.captureResponse(spec.id, stage.id, '{"changed":true}', { workId: 'work-capture', attemptId: 'b' }))
      .rejects.toThrow(/already captured/)
    await expect(repo.completedStage(spec.id, stage.id, 'other-work')).rejects.toThrow(/owner mismatch/)
  })

  it('地图阶段要求来源，并拒绝空地图和引用未知来源的模型结果', async () => {
    const { repo } = await harness()
    await repo.create({ ...spec, seeds: [] })
    await expect(repo.prepareStage(spec.id, 'plan', 'plan')).rejects.toThrow(/requires available sources/)
    await repo.ingest(spec.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    repo.configureExecution(undefined, 'never')
    const stage = await repo.prepareStage(spec.id, 'plan', 'plan')
    await repo.bindStage(spec.id, stage.id, 'work-plan-invalid')
    await expect(repo.acceptResult(spec.id, stage.id, JSON.stringify({ seeds: [] }), {
      workId: 'work-plan-invalid', attemptId: 'attempt-empty',
    })).rejects.toMatchObject({ name: 'KnowledgeResultValidationError' })
    const correction = await repo.prepareCorrection(spec.id, stage.id, '地图不能为空')
    await repo.bindStage(spec.id, correction.id, 'work-plan-unknown')
    await expect(repo.acceptResult(spec.id, correction.id, JSON.stringify({ seeds: [{
      ...spec.seeds[0], sourceIds: ['unknown'],
    }] }), { workId: 'work-plan-unknown', attemptId: 'attempt-unknown' })).rejects.toMatchObject({ name: 'KnowledgeResultValidationError' })
  })

  it('重开含未发布项目的库时不把 null 发布指针当作版本', async () => {
    const { repo, root, close } = await harness()
    await repo.create(spec)
    await close()
    const reopened = await harness(root)
    expect(reopened.repo).toBeInstanceOf(KnowledgeRepository)
  })

  it('在来源、前置、种子和发布版本不满足时拒绝越权的业务操作', async () => {
    const { repo } = await harness()
    await repo.create(spec)
    await expect(repo.confirmPlan(spec.id, canonicalHash(spec))).rejects.toThrow(/source missing/)
    await expect(repo.prepareStage(spec.id, 'unknown', 'generate')).rejects.toThrow(/confirmed/)
    await expect(repo.publish(spec.id, 'draft-hidden')).rejects.toThrow(/reserved/)
    await expect(repo.rollback(spec.id, 'missing')).rejects.toThrow(/unknown release/)
    await repo.ingest(spec.id, {
      sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z',
    })
    await repo.confirmPlan(spec.id, canonicalHash(spec))
    await expect(repo.prepareStage(spec.id, 'unknown', 'generate')).rejects.toThrow(/unknown seed/)
    const status = await repo.check(spec.id)
    expect(status).toMatchObject({ required: 1, covered: 0, coverage: 0, publishable: false })
  })

  it('生成前核对前置条目、审查对象和修正证据，并让同一工作重复绑定保持稳定', async () => {
    const { repo } = await harness()
    const twoStep = {
      ...spec,
      seeds: [spec.seeds[0]!, { ...spec.seeds[0]!, id: 'followup', title: '后续', depends: ['prototype'] }],
    }
    await repo.create(twoStep)
    await repo.ingest(twoStep.id, { sourceId: 'engine', title: '资料', text: '先验证核心玩法。', fetchedAt: '2026-09-08T00:00:00.000Z' })
    await repo.confirmPlan(twoStep.id, canonicalHash(twoStep))
    await expect(repo.prepareStage(twoStep.id, 'followup', 'generate')).rejects.toThrow(/prerequisite not ready/)
    await expect(repo.prepareStage(twoStep.id, 'prototype', 'review')).rejects.toThrow(/entry must exist/)
    const stage = await repo.prepareStage(twoStep.id, 'prototype', 'generate')
    await expect(repo.prepareCorrection(twoStep.id, stage.id, '无响应')).rejects.toThrow(/no rejected response/)
    await repo.bindStage(twoStep.id, stage.id, 'work-repeat')
    await repo.bindStage(twoStep.id, stage.id, 'work-repeat')
    await expect(repo.completedStage(twoStep.id, stage.id, 'work-repeat')).resolves.toBeNull()
  })
})
