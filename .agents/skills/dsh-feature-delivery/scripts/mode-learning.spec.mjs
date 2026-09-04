import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const helper = fileURLToPath(new URL('./mode-learning.mjs', import.meta.url))

function run(cwd, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [helper, ...args], { cwd }, (error, stdout, stderr) => {
      resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })
    })
  })
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mode-learning-'))
  await mkdir(join(root, '.git'))
  await writeFile(join(root, 'AGENTS.md'), '# test repository\n')
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

async function start(root, task = 'bounded-task') {
  const result = await run(root, ['start', '--mode', 'native', '--task', task])
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const finishArgs = (runId, effectSummary = 'bounded summary') => [
  'finish',
  '--run', runId,
  '--outcome', 'completed',
  '--highest-evidence', 'source-contract',
  '--effect', 'neutral',
  '--effect-summary', effectSummary,
  '--action', 'focused-check',
  '--checks', '1',
  '--subagents', '0',
  '--review-findings', '0',
  '--reused-evidence', '0',
]

test('rejects unknown flags instead of silently recording their default', async (t) => {
  const root = await fixture(t)
  const result = await run(root, ['start', '--mode', 'native', '--task', 'bounded-task', '--mod', 'adaptive'])

  assert.equal(result.code, 1)
  assert.match(result.stderr, /unknown option --mod/u)
})

test('rejects an absolute path before creating an active record', async (t) => {
  const root = await fixture(t)
  const result = await run(root, ['start', '--mode', 'native', '--task', 'artifact=/build/private/output.json'])

  assert.equal(result.code, 1)
  assert.match(result.stderr, /must not contain an absolute path/u)
  await assert.rejects(readdir(join(root, '.artifacts', 'dsh-feature-delivery', 'active')), { code: 'ENOENT' })
})

test('rejects a credential-like summary without consuming the active run', async (t) => {
  const root = await fixture(t)
  const active = await start(root)
  const result = await run(root, finishArgs(active.runId, 'openai_api_key=not-prefixed-secret-value'))

  assert.equal(result.code, 1)
  assert.match(result.stderr, /must not contain credential-like content/u)
  const activeFiles = await readdir(join(root, '.artifacts', 'dsh-feature-delivery', 'active'))
  assert.deepEqual(activeFiles, [`${active.runId}.json`])
})

test('rejects a credential-like model value without consuming the active run', async (t) => {
  const root = await fixture(t)
  const active = await start(root)
  const result = await run(root, [
    ...finishArgs(active.runId),
    '--agent', 'worker|sk-test-not-a-real-secret|low|false|0',
  ])

  assert.equal(result.code, 1)
  assert.match(result.stderr, /agent model must not contain credential-like content/u)
  const activeFiles = await readdir(join(root, '.artifacts', 'dsh-feature-delivery', 'active'))
  assert.deepEqual(activeFiles, [`${active.runId}.json`])
})

test('normal finish stores one per-run record that list returns', async (t) => {
  const root = await fixture(t)
  const active = await start(root)
  const result = await run(root, finishArgs(active.runId))

  assert.equal(result.code, 0, result.stderr)
  const completed = await readdir(join(root, '.artifacts', 'dsh-feature-delivery', 'completed'))
  assert.deepEqual(completed, [`${active.runId}.json`])
  const listed = await run(root, ['list', '--limit', '12'])
  assert.equal(listed.code, 0, listed.stderr)
  assert.deepEqual(JSON.parse(listed.stdout).map(record => record.runId), [active.runId])
})

test('a complete finishing claim is recovered idempotently', async (t) => {
  const root = await fixture(t)
  const active = await start(root)
  const claimDirectory = join(root, '.artifacts', 'dsh-feature-delivery', 'finishing')
  await mkdir(claimDirectory, { recursive: true })
  const record = {
    ...active,
    finishedAt: new Date().toISOString(),
    durationMs: 1,
    outcome: 'completed',
    highestEvidence: 'source-contract',
    effect: 'neutral',
    effectSummary: 'bounded summary',
    actions: ['focused-check'],
    agents: [],
    counts: { checks: 1, subagents: 0, reviewFindings: 0, reusedEvidence: 0 },
    escalation: null,
  }
  await writeFile(join(claimDirectory, `${active.runId}.json`), `${JSON.stringify(record)}\n`)
  const result = await run(root, finishArgs(active.runId))

  assert.equal(result.code, 0, result.stderr)
  const stored = JSON.parse(await readFile(join(root, '.artifacts', 'dsh-feature-delivery', 'completed', `${active.runId}.json`), 'utf8'))
  assert.deepEqual(stored, record)
  await assert.rejects(readFile(join(root, '.artifacts', 'dsh-feature-delivery', 'active', `${active.runId}.json`), 'utf8'), { code: 'ENOENT' })
})

test('a partial legacy claim is replaced from the intact active record', async (t) => {
  const root = await fixture(t)
  const active = await start(root)
  const claimDirectory = join(root, '.artifacts', 'dsh-feature-delivery', 'finishing')
  await mkdir(claimDirectory, { recursive: true })
  await writeFile(join(claimDirectory, `${active.runId}.json`), '{"schemaVersion":1')

  const result = await run(root, finishArgs(active.runId))

  assert.equal(result.code, 0, result.stderr)
  const stored = JSON.parse(await readFile(join(root, '.artifacts', 'dsh-feature-delivery', 'completed', `${active.runId}.json`), 'utf8'))
  assert.equal(stored.runId, active.runId)
})

test('an unsafe legacy active record is not migrated or removed', async (t) => {
  const root = await fixture(t)
  const active = await start(root)
  const activePath = join(root, '.artifacts', 'dsh-feature-delivery', 'active', `${active.runId}.json`)
  await writeFile(activePath, `${JSON.stringify({ ...active, task: 'artifact=/run/secrets/provider' })}\n`)

  const result = await run(root, finishArgs(active.runId))

  assert.equal(result.code, 1)
  assert.match(result.stderr, /must not contain an absolute path/u)
  assert.equal(JSON.parse(await readFile(activePath, 'utf8')).runId, active.runId)
  assert.deepEqual(await readdir(join(root, '.artifacts', 'dsh-feature-delivery', 'completed')), [])
})

test('list does not echo an unsafe summary from a legacy completed record', async (t) => {
  const root = await fixture(t)
  const active = await start(root)
  const finished = await run(root, finishArgs(active.runId))
  assert.equal(finished.code, 0, finished.stderr)
  const completedPath = join(root, '.artifacts', 'dsh-feature-delivery', 'completed', `${active.runId}.json`)
  const record = JSON.parse(await readFile(completedPath, 'utf8'))
  await writeFile(completedPath, `${JSON.stringify({ ...record, effectSummary: 'artifact=/run/secrets/provider' })}\n`)

  const listed = await run(root, ['list', '--limit', '12'])

  assert.equal(listed.code, 1)
  assert.match(listed.stderr, /must not contain an absolute path/u)
  assert.equal(listed.stdout, '')
})

test('concurrent finish attempts converge on one completed record', async (t) => {
  const root = await fixture(t)
  const active = await start(root)
  const attempts = await Promise.all(Array.from({ length: 8 }, () => run(root, finishArgs(active.runId))))

  assert.equal(attempts.some(result => result.code === 0), true)
  const completed = await readdir(join(root, '.artifacts', 'dsh-feature-delivery', 'completed'))
  assert.deepEqual(completed, [`${active.runId}.json`])
})
