import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { evalContractDigest, parseEvalPlan, parseEvalSuite, runEvalSuite } from '@changanhua/dsh-eval'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { readPinnedPlanSource } from '../src/source.ts'

test('the shipped Plan pins twenty replayable route fixtures and ten deterministic checks', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const example = 'packages/eval/eval-plans-local/examples/'
  const plan = parseEvalPlan(JSON.parse(await readFile(join(root, example, 'minimal-v1.plan.json'), 'utf8')))
  const suite = parseEvalSuite(JSON.parse(await readFile(join(root, example, 'minimal-v1.suite.json'), 'utf8')))
  const approval = JSON.parse(await readFile(join(root, example, 'minimal-v1.approval.json'), 'utf8')) as { id: string; version: string; digest: string }
  expect(approval.digest).toBe(evalContractDigest(plan))
  expect(await readPinnedPlanSource({ root, planFile: example + 'minimal-v1.plan.json', suiteFile: example + 'minimal-v1.suite.json',
    approvedPlan: approval, maxFileBytes: 131072, maxCells: 20 })).toMatchObject({ cellCount: 20 })
  const result = await runEvalSuite(suite, async (request) => {
    const log = await readFile(join(root, request.replayFixture.sessionFile), 'utf8')
    const events = parseSessionLog(log)
    const identity = JSON.parse(log.split('\n')[0] ?? '') as { id: string }
    const header = events.find(event => event.type === 'request/header')
    expect(header).toMatchObject({ data: { header: { config: { provider: request.route.provider, model: request.route.model } } } })
    const input = events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    expect(input).toMatchObject({ data: { content: [{ type: 'text', text: request.evalCase.prompt }] } })
    const answer = events.findLast(event => event.type === 'assistant/message')
    if (answer?.type !== 'assistant/message') throw new Error('fixture has no complete answer')
    const text = answer.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    return { sessionId: identity.id, evidenceRefs: [`fixture:${request.replayFixture.sessionFile}`],
      deterministicOutcome: request.evalCase.successCriteria.every(criterion => criterion.kind === 'output-equals' && criterion.text === text)
        ? 'passed' : 'failed' }
  })
  expect(result.runs.flatMap(run => run.results)).toHaveLength(20)
  expect(result.runs.flatMap(run => run.results).every(row => row.outcome === 'passed')).toBe(true)
})
