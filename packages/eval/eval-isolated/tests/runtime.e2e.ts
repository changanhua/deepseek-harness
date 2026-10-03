import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import { evalContractDigest } from '@changanhua/dsh-eval'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, test } from 'vitest'
import LocalBudget from '../../../budget/budget-local/src/index.ts'
import * as BudgetBridge from '../../../budget/budget-llm/src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { stageProfileFixture } from './runtime-fixture.ts'
import { observeRuntimeTree } from '../src/build.ts'
import { IsolatedRoleRuntime } from '../src/runtime.ts'

test.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('runs independently built Subject and Grader through the pinned core owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-runtime-'))
  const ctx = new Context(), backend = new MemoryStorageBackend()
  const signal = AbortSignal.timeout(90_000)
  const bounds = { maxFiles: 30000, maxBytes: 1024 * 1024 * 1024 }
  const held: Array<{ acknowledgeEvidence(): void; release(): Promise<void> }> = []
  const requests = new Map<string, number>()
  const subjectCwd = join(root, 'subject-work'), graderCwd = join(root, 'grader-work')
  const shared = join(root, 'approved-subject-output')
  const parameters = { type: 'object', properties: { source: { type: 'string' } }, required: ['source'] }
  const outputSchema = { type: 'object', additionalProperties: true }
  const tool = { id: 'fixture_run_node', source: 'tool-contract:global', digest: evalContractDigest({
    name: 'fixture_run_node', description: 'Execute a Node task.', parameters, outputSchema }) }
  const skillBody = { name: 'fixture-skill', description: 'Fixture skill.', content: 'Actual version 2.',
    invocation: { modelInvocable: true, userInvocable: true }, metadata: null }
  const skill = { id: 'fixture-skill', source: 'skill:runtime:runtime', digest: evalContractDigest(skillBody) }
  try {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
    await ctx.plugin(LlmRuntime)
    class Adapter extends LlmAdapter {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const grading = JSON.stringify(options.messages).includes('Grade the subject')
        const session = String(options.sessionId), call = requests.get(session) ?? 0
        requests.set(session, call + 1)
        if (call === 0) {
          const source = grading
            ? `import fs from 'node:fs';let denied=false;try{fs.readFileSync(${JSON.stringify(join(subjectCwd, 'private-session'))})}catch(e){denied=['EACCES','EPERM'].includes(e.code)}if(!denied)throw new Error('subject private state leaked');if(fs.readFileSync(${JSON.stringify(join(shared, 'output.txt'))},'utf8')!=='from-isolated-task')throw new Error('missing material');denied=false;try{fs.writeFileSync(${JSON.stringify(join(shared, 'output.txt'))},'tampered')}catch(e){denied=['EACCES','EPERM'].includes(e.code)}if(!denied)throw new Error('readonly material was writable');console.log('GRADE_OK')`
            : `import fs from 'node:fs';let denied=false;try{fs.readFileSync(${JSON.stringify(join(graderCwd, 'private-rubric'))})}catch(e){denied=['EACCES','EPERM'].includes(e.code)}if(!denied)throw new Error('rubric leaked');fs.writeFileSync('artifact.txt','from-isolated-task');console.log('TASK_OK')`
          const block = { type: 'tool-call' as const, id: ToolCallId('task-1'), name: 'fixture_run_node', arguments: JSON.stringify({ source }) }
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
          yield { type: 'block-end', index: 0, block }
          yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        const text = grading ? 'PASS' : 'READY'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['fixture'], new Adapter())
    await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
    await ctx.plugin(BudgetBridge)
    const budget = await ctx.budget.createScope({ id: 'run', kind: 'session', subjectId: 'eval', parentId: null,
      limits: { requests: 8, inputTokens: 20000, outputTokens: 1000, totalTokens: 21000, wallTimeMs: 120000 }, onExhausted: 'deny' }, () => {})
    const core = join(root, 'core')
    await stageProfileFixture(core, join(root, 'staging-home'), '', [
      '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-agent-presets', '@deepseek-ai/dsh-skill',
      '@deepseek-ai/dsh-session-persistence-jsonl', '@changanhua/dsh-eval',
    ])
    await mkdir(join(core, 'presets/minimal'), { recursive: true })
    await writeFile(join(core, 'presets/minimal/agent.cordis.yml'), '[]\n')
    await writeFile(join(core, 'capabilities.mjs'), `
export const name='fixture-capabilities';export const inject=['tools','skills'];
export function apply(ctx){
  ctx.tools.register({name:'fixture_run_node',description:'Execute a Node task.',parameters:${JSON.stringify(parameters)},
    output:{schema:${JSON.stringify(outputSchema)},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async(args,exec)=>{const result=await ctx.bail('eval-isolated/task',{sessionId:exec.agent.id,source:args.source});if(!result)throw new Error('task bridge absent');return result}});
  ctx.skills.register({name:'fixture-skill',description:'Fixture skill.',source:'runtime',content:'Actual version 2.'});
}
`)
    const actual = await observeRuntimeTree(core, bounds, signal)
    const corePin = { directory: core, digest: actual.digest, plugins: [{ id: 'capabilities', module: 'capabilities.mjs' }] }
    const runtime = new IsolatedRoleRuntime(ctx, { root: join(root, 'run'), core: { subject: corePin, grader: corePin },
      imageBounds: bounds, maxFrameBytes: 1024 * 1024, maxRequests: 8, executionMs: 20000, graceMs: 5000,
      stopMs: 10000, maxResponseBytes: 8192, maxModelAttempts: 4 })
    const route = { id: 'route', provider: 'fixture', model: 'fixture', parameters: { maxTokens: 64 },
      preset: { id: 'minimal', source: 'preset:system', digest: createHash('sha256').update('[]\n').digest('hex') } }
    await mkdir(subjectCwd); await mkdir(graderCwd)
    await mkdir(shared)
    await writeFile(join(subjectCwd, 'private-session'), 'subject-only')
    await writeFile(join(graderCwd, 'private-rubric'), 'grader-only')
    const subject = await runtime.run({ role: 'subject', verifiedCommit: 'a'.repeat(40), cwd: subjectCwd,
      prompt: 'Run the Node task and reply READY.', route, budget: budget.reference, tools: [tool], skills: [skill] }, signal)
    held.push(subject)
    expect(subject).toMatchObject({ status: 'reported', output: 'READY' })
    expect(await readFile(join(subjectCwd, 'artifact.txt'), 'utf8')).toBe('from-isolated-task')
    expect(subject.evidence.tasks).toMatchObject([{ status: 'exited', quiescent: true, exitCode: 0, stdout: 'TASK_OK\n' }])
    expect(await readFile(join(graderCwd, 'private-rubric'), 'utf8')).toBe('grader-only')
    await writeFile(join(shared, 'output.txt'), await readFile(join(subjectCwd, 'artifact.txt')))
    const grader = await runtime.run({ role: 'grader', verifiedCommit: 'a'.repeat(40), cwd: graderCwd,
      prompt: `Grade the subject: ${subject.output}`, route, budget: budget.reference, tools: [tool], skills: [skill], readOnlyInputs: [shared] }, signal)
    held.push(grader)
    expect(grader).toMatchObject({ status: 'reported', output: 'PASS' })
    expect(grader.evidence.tasks).toMatchObject([{ status: 'exited', quiescent: true, exitCode: 0, stdout: 'GRADE_OK\n' }])
    expect(await readFile(join(shared, 'output.txt'), 'utf8')).toBe('from-isolated-task')
    expect(grader.observation.executionId).not.toBe(subject.observation.executionId)
    expect(subject.observation.buildDigest).toBe(actual.digest)
    expect(grader.observation.buildDigest).toBe(actual.digest)
    expect(subject.observation.actual!.tools).toEqual([tool])
    expect(subject.observation.actual!.skills).toEqual([skill])
    expect(JSON.stringify(subject.observation)).not.toContain(root)
    expect(subject.evidence.accounting.every(row => row.status === 'settled')).toBe(true)
    await expect(subject.release()).rejects.toThrow('eval-evidence-ack-required')
    subject.acknowledgeEvidence(); grader.acknowledgeEvidence()
    await subject.release(); await grader.release()
    const nextCwd = join(root, 'next-work')
    await mkdir(nextCwd)
    const mismatched = await runtime.run({ role: 'subject', verifiedCommit: 'a'.repeat(40), cwd: nextCwd,
      prompt: 'Must not execute.', route, budget: budget.reference, tools: [tool],
      skills: [{ ...skill, digest: evalContractDigest({ ...skillBody, content: 'Expected version 1.' }) }] }, signal)
    held.push(mismatched)
    expect(mismatched).toMatchObject({ status: 'invalid', reason: 'eval-role-identity-mismatch' })
    expect(mismatched.observation.actual!.skills).toEqual([skill])
    expect(mismatched.evidence.accounting).toHaveLength(0)
    expect(requests.has(mismatched.observation.sessionId)).toBe(false)
  } finally {
    for (const role of held) { role.acknowledgeEvidence(); await role.release() }
    await ctx.fiber.dispose(); await backend.close()
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
