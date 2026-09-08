import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { MemoryKind } from '@changanhua/dsh-memory'
import { createAcceptanceWorld } from './acceptance-world.ts'
import { assertWithheld, type AcceptanceAgent } from './assertions.ts'
import { compareBenefit, taskMetrics } from './benefit-metrics.ts'
import { memoryCredentialAvailable, MEMORY_MODEL, MEMORY_PROVIDER } from './live-provider.ts'

interface BenefitCase {
  id: string
  kind: MemoryKind
  topic: string
  title: string
  statement: string
  request: string
  output: string
  expected: Record<string, unknown>
}

async function seed(world: Awaited<ReturnType<typeof createAcceptanceWorld>>, agent: AcceptanceAgent,
  topic: string, statement: string, source: string, kind: MemoryKind = 'method', title = topic) {
  // Fixture admission is outside the measured turn and makes no model request.
  // Both lanes retain the same source files; the enabled lane additionally has human-accepted memory.
  const proposed = await world.getHost().ctx.get('projectMemory')!.propose(agent, {
    topicKey: topic, kind, title, statement, tags: [], conditions: '',
    sources: [{ kind: 'file', path: source }], idempotencyKey: source,
  })
  return proposed.id
}

async function invalidSourceGuards(world: Awaited<ReturnType<typeof createAcceptanceWorld>>) {
  const reviewer = await world.session(world.a)
  const old = 'pnpm verify:expired-policy'
  await writeFile(join(world.a, 'decisions/expired.md'), old)
  const expired = await seed(world, reviewer, 'review policy', old, 'decisions/expired.md')
  const deadline = new Date(Date.now() + 3_000).toISOString()
  await world.command(reviewer, '/memory accept ' + expired + '@1 --review-after ' + deadline)
  await expect.poll(async () => (await world.getHost().ctx.get('projectMemory')!.read(reviewer, expired)).eligibility,
    { timeout: 6_000, interval: 100 }).toBe('review-due')
  const expiryCaller = await world.session(world.a)
  await world.prompt(expiryCaller, 'Use memory_search for review policy. If no usable memory is returned, write exactly NEEDS_REVIEW to guard-expiry.txt. '
    + 'Do not infer a command from unreviewed sources, accept memories, or execute a command.')
  assertWithheld(expiryCaller, expired, old)
  expect((await readFile(join(world.a, 'guard-expiry.txt'), 'utf8')).trim()).toBe('NEEDS_REVIEW')

  const conflicting = ['pnpm verify:conflict-one', 'pnpm verify:conflict-two']
  const ids: string[] = []
  for (const [index, statement] of conflicting.entries()) {
    const source = 'decisions/conflict-' + String(index) + '.md'
    await writeFile(join(world.a, source), statement)
    const id = await seed(world, reviewer, 'conflicting policy', statement, source)
    await world.command(reviewer, '/memory accept ' + id + '@1')
    ids.push(id)
  }
  const conflictCaller = await world.session(world.a)
  await world.prompt(conflictCaller, 'Use memory_search for conflicting policy. If no usable memory is returned, write exactly NEEDS_REVIEW to guard-conflict.txt. '
    + 'Do not choose between conflicting commands, accept memories, or execute a command.')
  for (const [index, id] of ids.entries()) assertWithheld(conflictCaller, id, conflicting[index]!)
  expect((await readFile(join(world.a, 'guard-conflict.txt'), 'utf8')).trim()).toBe('NEEDS_REVIEW')
  for (const filename of ['guard-expiry.txt', 'guard-conflict.txt']) {
    await writeFile(join(world.evidence, filename), await readFile(join(world.a, filename)))
  }
  return { expiry: true, conflict: true, blindReuseCount: 0 }
}

afterEach(() => { vi.unstubAllEnvs() })

// A credentialed run always uses live inference; missing-key skips are not delivery evidence.
it.skipIf(!await memoryCredentialAvailable())('compares five fixed real tasks under identical model and source inputs, then checks expiry and conflict blindness',
  { retry: 0, timeout: 1_800_000 }, async () => {
    vi.stubEnv('DSH_SNAPSHOT', 'record')
    const fixtureBytes = await readFile(join(import.meta.dirname, 'fixtures/benefit-cases.json'), 'utf8')
    const cases = JSON.parse(fixtureBytes) as BenefitCase[]
    expect(cases).toHaveLength(5)
    const enabled: Array<{ id: string; success: boolean } & ReturnType<typeof taskMetrics>> = []
    const disabled: typeof enabled = []
    const evidenceDirectories: string[] = []
    let guards: Awaited<ReturnType<typeof invalidSourceGuards>> | undefined
    // Counterbalance lane order across cases; each measurement starts with an empty Session.
    for (const [index, task] of cases.entries()) {
      for (const memoryEnabled of index % 2 === 0 ? [false, true] : [true, false]) {
        const world = await createAcceptanceWorld(memoryEnabled)
        evidenceDirectories.push(world.evidence)
        try {
          await mkdir(join(world.a, 'decisions'))
          await writeFile(join(world.a, 'README.md'), '# Project rules\n\nRecorded decisions, preferences, and methods are in decisions/.\n')
          for (const source of cases) {
            await writeFile(join(world.a, 'decisions', source.id + '.md'), '# ' + source.title + '\n\n' + source.statement + '\n')
          }
          await world.start()
          if (memoryEnabled) {
            const reviewer = await world.session(world.a)
            for (const source of cases) {
              const id = await seed(world, reviewer, source.topic, source.statement, 'decisions/' + source.id + '.md', source.kind, source.title)
              await world.command(reviewer, '/memory accept ' + id + '@1')
            }
          }
          const caller = await world.session(world.a)
          const fullRequest = task.request + ' Use the available project history and sources. Change only the requested output file. '
            + 'Do not ask for clarification or execute a shell command.'
          await world.prompt(caller, fullRequest)
          expect(await readFile(join(world.a, 'README.md'), 'utf8')).toBe('# Project rules\n\nRecorded decisions, preferences, and methods are in decisions/.\n')
          for (const source of cases) {
            expect(await readFile(join(world.a, 'decisions', source.id + '.md'), 'utf8'))
              .toBe('# ' + source.title + '\n\n' + source.statement + '\n')
          }
          let artifact: string | null = null
          let success = false
          try {
            artifact = await readFile(join(world.a, task.output), 'utf8')
            success = isDeepStrictEqual(JSON.parse(artifact) as unknown, task.expected)
          } catch (error) {
            if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
          const result = { id: task.id, success, ...taskMetrics(caller) }
          const destination = memoryEnabled ? enabled : disabled
          destination.push(result)
          await writeFile(join(world.evidence, 'task-result.json'), JSON.stringify({
            ...result, memoryEnabled, request: fullRequest, artifact, expected: task.expected,
            scope: 'one measured reuse turn; fixture seeding and human acceptance are reported separately',
            setup: { modelCalls: 0, humanAcceptances: memoryEnabled ? 5 : 0 },
          }, null, 2))
          if (memoryEnabled && index === 0) guards = await invalidSourceGuards(world)
        } finally {
          await world.close()
        }
      }
    }
    const comparison = compareBenefit(enabled, disabled, guards?.blindReuseCount === 0)
    const report = {
      fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
      provider: MEMORY_PROVIDER, model: MEMORY_MODEL, tasks: { enabled, disabled }, guards,
      ...comparison, evidenceDirectories,
      limitation: 'Five constrained artifact tasks assess reuse of already accepted memory, not general productivity or total lifecycle cost.',
    }
    await writeFile(join(evidenceDirectories[0]!, 'benefit-comparison.json'), JSON.stringify(report, null, 2))
    expect(comparison.enabled.successes, 'at least four normal tasks must succeed').toBeGreaterThanOrEqual(4)
    expect(guards?.blindReuseCount).toBe(0)
    // No cost improvement is a valid measured outcome; it must never become a benefit claim.
  })
