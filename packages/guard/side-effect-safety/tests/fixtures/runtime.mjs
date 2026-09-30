// Test-only process: actual Loader + built exports, synthetic callbacks only.
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
const [repo, root, phase] = process.argv.slice(2)
const moduleAt = path => import(pathToFileURL(resolve(repo, path)).href)
const { boot } = await moduleAt('packages/boot/app-boot/lib/index.js')
const { canonicalDigest } = await moduleAt('packages/delivery/delivery-protocol/lib/index.js')
const { SessionId } = await moduleAt('packages/core/session/lib/index.js')
const config = join(root, 'cordis.yml')
const rows = [
  ['storage', 'packages/storage/storage'],
  ['json', 'packages/storage/storage-json', { root }],
  ['domain', 'packages/storage/storage-domain', { backend: 'json' }],
  ['sessions', 'packages/core/session'],
  ['approval', 'packages/interaction/user-approval'],
  ['safety', 'packages/guard/side-effect-safety', { maxExecutions: 10, maxApprovals: 10,
    maxActionsPerExecution: 10, maxRecordBytes: 65536, maxTotalBytes: 262144, maxEvidenceRefs: 4, maxAdmissionMs: 5000 }],
]
await writeFile(config, JSON.stringify(rows.map(([id, path, config]) => ({ id,
  name: pathToFileURL(resolve(repo, path, 'lib/index.js')).href, ...(config ? { config } : {}) }))))
const ctx = await boot('safety-built-fixture', config)
const service = ctx.sideEffectSafety
const { bindSafetyAdapter } = await moduleAt('packages/guard/side-effect-safety/lib/index.js')
const session = ctx.sessions.create(SessionId('fixture'))
session.append('turn/start', { turn: 1 })
ctx.on('approval/request', () => Promise.resolve('allowed-once'))
const evidenceRefs = [{ uri: 'synthetic:proof', digest: canonicalDigest('verified no external effect') }]
let sends = 0
const binding = bindSafetyAdapter(ctx, 'synthetic', {
  confirmHuman: async draft => ({ kind: 'human', actorId: 'synthetic-human', draftDigest: canonicalDigest(draft), evidenceRefs }),
  validate: async () => true,
  send: async () => {
    sends++
    if (phase === 'crash') process.exit(23)
    return { outcome: 'CONFIRMED', evidenceRefs }
  },
  inspect: async () => ({ outcome: 'NOT_APPLIED', evidenceRefs }),
})
const safety = { ...binding, snapshot: service.snapshot }
const { guardedPlugin } = await moduleAt('packages/extensions/cordis-host-runner/lib/types/guard.js')
let authorityBlocked = false
try {
  await ctx.plugin(guardedPlugin({ name: 'built-storage-probe', inject: ['storageDomain'],
    apply(dynamic) { dynamic.storageDomain.get('side_effect_safety') },
  }, error => { throw error }))
} catch (error) { authorityBlocked = error.message.includes('raw storage authority is Host-only') }
if (!authorityBlocked) throw new Error('built dynamic guard exposed raw storage')

const input = key => ({ idempotencyKey: key, kind: 'synthetic', targetRef: { kind: 'fixture', id: 'target' },
  parameters: { key }, riskCost: { actions: 1, externalWrites: 1, resourceSpend: 0, domainUnits: {} } })
try {
  let id
  if (phase === 'crash') {
    const now = Date.now()
    const approval = await binding.approve({ domain: 'synthetic', subjectRef: input('A').targetRef,
      startsAt: now - 1000, expiresAt: now + 60_000, scopeDigest: canonicalDigest('scope'), policyDigest: canonicalDigest('policy'),
      budget: { maxActions: 3, maxExternalWrites: 3, maxResourceSpend: 0, maxUnknownActions: 1,
        maxConsecutiveFailures: 3, maxRuntimeMs: 60_000, domainLimits: {} } }, { agent: { session }, toolName: 'fixture-approval' })
    const e = await safety.createExecution(approval.id, 'run'); id = e.id
    await writeFile(join(root, 'execution-id'), id)
    await safety.acquireLease(id, e.revision, 30_000)
    const a = await binding.prepare(id, safety.snapshot(id).execution.revision, input('A'))
    await binding.execute(await binding.admit(id, safety.snapshot(id).execution.revision, a.id, input('A').parameters))
    throw new Error('expected process exit at synthetic send')
  }
  id = await readFile(join(root, 'execution-id'), 'utf8')
  const revision = () => safety.snapshot(id).execution.revision
  const before = safety.snapshot(id)
  if (before.breaker !== 'RECONCILING' || before.execution.actions[0].phase !== 'UNKNOWN') throw new Error('crash not recovered')
  let blocked = false
  try { await binding.prepare(id, revision(), input('B')) } catch (e) { blocked = e.code === 'unresolved-action' }
  if (!blocked) throw new Error('B bypassed unresolved UNKNOWN')
  const action = before.execution.actions[0]
  await binding.reconcile(id, revision(), action.id)
  await safety.acquireLease(id, revision(), 30_000)
  const b = await binding.prepare(id, revision(), input('B'))
  await binding.execute(await binding.admit(id, revision(), b.id, input('B').parameters))
  await safety.control(id, revision(), 'completed')
  const final = safety.snapshot(id)
  if (sends !== 1 || final.execution.actions[0].phase !== 'NOT_APPLIED' || final.execution.actions[1].phase !== 'CONFIRMED') throw new Error('unexpected replay or settlement')
  process.stdout.write(JSON.stringify({ sends, blocked, breaker: final.breaker, states: final.execution.actions.map(a => a.phase) }) + '\n')
} finally { await ctx.fiber.dispose() }
