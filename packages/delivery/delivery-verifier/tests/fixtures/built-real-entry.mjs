import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repositoryRoot] = process.argv.slice(2)
if (repositoryRoot === undefined) {
  throw new Error('usage: built-real-entry.mjs <repository-root>')
}

const fromRepository = path => pathToFileURL(join(repositoryRoot, path)).href
const [{ Context }, verifier, protocol, testkit, { default: LocalSubprocessRuntime }] = await Promise.all([
  import(fromRepository('vendor/cordis/lib/index.js')),
  import(fromRepository('packages/delivery/delivery-verifier/lib/index.js')),
  import(fromRepository('packages/delivery/delivery-protocol/lib/index.js')),
  import(fromRepository('packages/delivery/delivery-testkit/lib/index.js')),
  import(fromRepository('packages/subprocess/subprocess-local/lib/index.js')),
])

const {
  EvidenceId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryRelativePath,
  VerificationCheckId,
  evidenceBytesDigest,
  evidenceRefSchema,
} = protocol
const {
  completedClaimFixture,
  contractRevisionFixture,
  evidenceRefFixture,
  readyWorkPacketFixture,
  verificationPlanFixture,
} = testkit

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const claimBytes = encoder.encode('delivery fixture evidence\n')
const verificationQueueWorkId = QueueWorkIdRef('built-verification-work')
const verificationQueueAttemptId = QueueAttemptIdRef('built-verification-attempt')
let outputOrdinal = 0

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForFile(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitForGone(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`process ${pid} remained alive after verifier cancellation`)
}

function scenarioRequest(root, check, closes, savedOutputs) {
  const contract = contractRevisionFixture({
    verificationSource: { kind: 'contract-field', checks: [check] },
  })
  const trustedPlan = verificationPlanFixture({ checks: [check] })
  const packet = readyWorkPacketFixture({ verificationPlan: trustedPlan })
  const completionClaim = completedClaimFixture()
  const claimReference = evidenceRefFixture()
  return {
    contract,
    packet,
    resolved: {
      packetId: packet.id,
      contractRevisionId: contract.id,
      repositoryId: packet.repositoryId,
      baseCommit: packet.baseCommit,
      targetCommit: completionClaim.checkpointCommit,
      trustedPlan,
    },
    completionClaim,
    verificationQueueWorkId,
    verificationQueueAttemptId,
    inspectRange: async (signal) => {
      signal.throwIfAborted()
      return {
        repositoryId: packet.repositoryId,
        baseCommit: packet.baseCommit,
        targetCommit: completionClaim.checkpointCommit,
        descendsFromBase: true,
        changedPaths: [RepositoryRelativePath('packages/delivery/example.ts')],
      }
    },
    openWorkspace: async (signal) => {
      signal.throwIfAborted()
      return {
        ownerAttemptId: verificationQueueAttemptId,
        repositoryId: packet.repositoryId,
        baseCommit: packet.baseCommit,
        targetCommit: completionClaim.checkpointCommit,
        cwd: root,
        close: async (disposition) => { closes.push(disposition) },
      }
    },
    evidenceFor: checkId => ({
      save: async (input, signal) => {
        signal?.throwIfAborted()
        outputOrdinal += 1
        const id = EvidenceId(`built-verification-output-${String(outputOrdinal)}`)
        const reference = evidenceRefSchema.parse({
          schemaVersion: 1,
          id,
          kind: input.kind,
          mediaType: input.mediaType,
          uri: `memory://built-verification/${id}`,
          byteLength: input.data.byteLength,
          digest: evidenceBytesDigest(input.data),
          createdAt: '2026-08-29T00:00:00.000Z',
          provenance: {
            kind: 'verification-check',
            packetId: packet.id,
            queueWorkId: verificationQueueWorkId,
            queueAttemptId: verificationQueueAttemptId,
            checkId,
          },
        })
        savedOutputs.push({ reference, data: input.data.slice() })
        return reference
      },
    }),
    resolveEvidence: async (id, signal) => {
      signal.throwIfAborted()
      return id === claimReference.id ? claimReference : undefined
    },
    readEvidence: async (reference, signal) => {
      signal.throwIfAborted()
      assert.equal(reference.id, claimReference.id)
      return { ref: claimReference, data: claimBytes.slice() }
    },
  }
}

async function runScenario(subprocess, options) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delivery-built-verifier-'))
  const closes = []
  const savedOutputs = []
  try {
    const script = join(root, options.scriptName)
    await writeFile(script, options.script)
    const check = {
      id: VerificationCheckId(options.checkId),
      name: options.checkId,
      argv: [process.execPath, script, ...options.args ?? []],
      cwd: '.',
      timeoutMs: options.timeoutMs ?? 5_000,
      severity: 'required',
      expectedExitCodes: [0],
    }
    const start = verifier.createDeliveryVerifier({
      subprocess,
      verifierVersion: 'built-real-entry@1',
      disposeGraceMs: 200,
      verificationOutputBytes: options.outputBytes ?? 4 * 1024,
    })
    const request = scenarioRequest(root, check, closes, savedOutputs)
    return await options.run({ start, request, closes, savedOutputs, root })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const context = new Context()
const providerFiber = await context.plugin(LocalSubprocessRuntime)
let helperPid
try {
  const success = await runScenario(context.subprocess, {
    scriptName: 'success.mjs',
    checkId: 'built-success',
    script: "process.stdout.write('built-success\\n'); process.stderr.write('built-diagnostic\\n')\n",
    run: async ({ start, request, closes, savedOutputs }) => {
      const verdict = await start(request, new AbortController().signal).done
      assert.equal(verdict.status, 'passed')
      assert.deepEqual(closes, ['remove'])
      const output = decoder.decode(savedOutputs[0].data)
      assert.match(output, /built-success/u)
      assert.match(output, /built-diagnostic/u)
      return verdict.status
    },
  })

  const boundedBytes = await runScenario(context.subprocess, {
    scriptName: 'bounded.mjs',
    checkId: 'built-bounded',
    outputBytes: 256,
    script: "process.stdout.write('x'.repeat(8192))\n",
    run: async ({ start, request, closes, savedOutputs }) => {
      const verdict = await start(request, new AbortController().signal).done
      assert.equal(verdict.status, 'passed')
      assert.deepEqual(closes, ['remove'])
      assert.equal(savedOutputs[0].data.byteLength, 256)
      return savedOutputs[0].data.byteLength
    },
  })

  const timeout = await runScenario(context.subprocess, {
    scriptName: 'timeout.mjs',
    checkId: 'built-timeout',
    timeoutMs: 75,
    script: 'setInterval(() => {}, 60_000)\n',
    run: async ({ start, request, closes }) => {
      const verdict = await start(request, new AbortController().signal).done
      assert.equal(verdict.status, 'failed')
      assert.equal(verdict.checkResults[0].status, 'timed-out')
      assert.deepEqual(closes, ['remove'])
      return verdict.checkResults[0].status
    },
  })

  const cancellation = await runScenario(context.subprocess, {
    scriptName: 'cancel-tree.mjs',
    checkId: 'built-cancel-tree',
    timeoutMs: 10_000,
    args: ['helper.pid'],
    script: [
      "import { spawn } from 'node:child_process'",
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "const pidFile = join(process.cwd(), process.argv[2])",
      "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' })",
      "if (helper.pid === undefined) throw new Error('helper pid unavailable')",
      "writeFileSync(pidFile, String(helper.pid))",
      'setInterval(() => {}, 60_000)',
      '',
    ].join('\n'),
    run: async ({ start, request, closes, root }) => {
      const pidFile = join(root, 'helper.pid')
      const run = start(request, new AbortController().signal)
      await waitForFile(pidFile)
      helperPid = Number(await readFile(pidFile, 'utf8'))
      assert.ok(Number.isSafeInteger(helperPid) && helperPid > 0)
      await run.cancel('built provider cancellation')
      const error = await run.done.catch(reason => reason)
      assert.equal(error.code, 'canceled')
      assert.deepEqual(closes, ['remove'])
      await waitForGone(helperPid)
      return error.code
    },
  })

  console.log(JSON.stringify({
    entry: 'lib/index.js',
    provider: context.subprocess.constructor.name,
    success,
    boundedBytes,
    timeout,
    cancellation,
    helperTreeGone: helperPid !== undefined && !isAlive(helperPid),
  }))
} finally {
  if (helperPid !== undefined && isAlive(helperPid)) {
    try {
      process.kill(helperPid, 'SIGKILL')
    } catch {
      // The provider already reaped the helper.
    }
  }
  await providerFiber.dispose()
}
