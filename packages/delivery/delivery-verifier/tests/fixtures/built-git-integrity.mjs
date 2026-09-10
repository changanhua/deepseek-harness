import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const [repositoryRoot] = process.argv.slice(2)
assert.ok(repositoryRoot, 'supply the built subject repository')
const load = path => import(pathToFileURL(join(repositoryRoot, path)).href)
const [{ Context }, { createDeliveryVerifier }, protocol, fixtures, { default: Subprocess }, { default: Workspace }, { default: Evidence }] = await Promise.all([
  load('vendor/cordis/lib/index.js'),
  load('packages/delivery/delivery-verifier/lib/index.js'),
  load('packages/delivery/delivery-protocol/lib/index.js'),
  load('packages/delivery/delivery-testkit/lib/index.js'),
  load('packages/subprocess/subprocess-local/lib/index.js'),
  load('packages/delivery/repo-workspace-git-local/lib/index.js'),
  load('packages/delivery/delivery-evidence-local/lib/index.js'),
])
const exec = promisify(execFile)
const git = async (cwd, ...args) => (await exec('git', ['-C', cwd, ...args], { windowsHide: true })).stdout.trim()
const observations = []
for (const [name, script, drift] of [
  ['clean', 'process.exit(0)', false],
  ['generated', "require('node:fs').writeFileSync('output.txt', 'build')", false],
  ['tracked', "require('node:fs').writeFileSync('tracked.txt', 'tampered')", true],
  ['head', "require('node:child_process').execFileSync('git', ['checkout', '--detach', 'HEAD^'])", true],
  ['index', "const fs = require('node:fs'); fs.writeFileSync('tracked.txt', 'staged'); require('node:child_process').execFileSync('git', ['add', 'tracked.txt']); fs.writeFileSync('tracked.txt', 'target\\n')", true],
]) {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-built-git-integrity-'))
  const repository = join(temp, 'repo')
  const ctx = new Context()
  let lease
  try {
    await mkdir(repository)
    await git(repository, 'init', '--initial-branch=master')
    await git(repository, 'config', 'user.name', 'Integrity Test')
    await git(repository, 'config', 'user.email', 'integrity@example.test')
    await git(repository, 'config', 'core.autocrlf', 'false')
    await writeFile(join(repository, 'tracked.txt'), 'base\n')
    await git(repository, 'add', '.')
    await git(repository, 'commit', '-m', 'base')
    const baseCommit = protocol.GitCommitId(await git(repository, 'rev-parse', 'HEAD'))
    await writeFile(join(repository, 'tracked.txt'), 'target\n')
    await git(repository, 'commit', '-am', 'target')
    const targetCommit = protocol.GitCommitId(await git(repository, 'rev-parse', 'HEAD'))
    const repositoryId = protocol.RepositoryId('integrity')
    await ctx.plugin(Subprocess)
    await ctx.plugin(Workspace, { repositories: { [repositoryId]: repository }, worktreeRoot: join(temp, 'worktrees') })
    await ctx.plugin(Evidence, { root: join(temp, 'evidence') })
    const check = {
      id: protocol.VerificationCheckId('check'), name: 'Check immutable inputs',
      argv: [process.execPath, '-e', script], cwd: '.', timeoutMs: 5000,
      severity: 'required', expectedExitCodes: [0],
    }
    const contract = fixtures.contractRevisionFixture({ repositoryId, baseSelectionRule: { kind: 'commit', commit: baseCommit }, verificationSource: { kind: 'contract-field', checks: [check] } })
    const trustedPlan = fixtures.verificationPlanFixture({ checks: [check] })
    const packet = fixtures.readyWorkPacketFixture({ repositoryId, baseCommit, verificationPlan: trustedPlan, allowedPaths: [{ kind: 'exact', path: 'tracked.txt' }], forbiddenPaths: [] })
    const claim = fixtures.completedClaimFixture({ checkpointCommit: targetCommit, changedPaths: ['tracked.txt'] })
    const claimRef = await ctx.deliveryEvidence.bind({ kind: 'change-attempt', packetId: packet.id, queueWorkId: claim.queueWorkId, queueAttemptId: claim.queueAttemptId }).save({
      kind: 'checkpoint-metadata', mediaType: 'text/plain', data: new TextEncoder().encode('checkpoint evidence'),
    })
    const completionClaim = { ...claim, evidenceIds: [claimRef.id] }
    const verificationQueueWorkId = protocol.QueueWorkIdRef('verify-work')
    const verificationQueueAttemptId = protocol.QueueAttemptIdRef('verify-attempt')
    const base = await ctx.repoWorkspace.inspectRevision({ repositoryId, commit: baseCommit })
    const target = await ctx.repoWorkspace.inspectRevision({ repositoryId, commit: targetCommit })
    const request = {
      contract, packet, completionClaim, verificationQueueWorkId, verificationQueueAttemptId,
      resolved: { packetId: packet.id, contractRevisionId: contract.id, repositoryId, baseCommit, targetCommit, trustedPlan },
      inspectRange: signal => ctx.repoWorkspace.inspectRange({ base, target, signal }),
      openWorkspace: async signal => {
        lease = await ctx.repoWorkspace.openVerification({ ownerAttemptId: verificationQueueAttemptId, base, target, signal })
        return lease
      },
      evidenceFor: checkId => ctx.deliveryEvidence.bind({ kind: 'verification-check', packetId: packet.id, queueWorkId: verificationQueueWorkId, queueAttemptId: verificationQueueAttemptId, checkId }),
      resolveEvidence: (id, signal) => ctx.deliveryEvidence.resolve(id, signal),
      readEvidence: (ref, signal) => ctx.deliveryEvidence.read(ref, signal),
    }
    const start = createDeliveryVerifier({ subprocess: ctx.subprocess, verifierVersion: 'built-integrity', disposeGraceMs: 200, verificationOutputBytes: 4096 })
    const done = start(request, new AbortController().signal).done
    if (drift) {
      await assert.rejects(done, { code: 'workspace-integrity' })
      await access(lease.cwd)
    } else {
      const verdict = await done
      assert.equal(verdict.status, 'passed')
      assert.equal(verdict.targetCommit, targetCommit)
      await assert.rejects(access(lease.cwd), { code: 'ENOENT' })
    }
    assert.equal(await git(repository, 'rev-parse', 'HEAD'), targetCommit)
    assert.equal(await readFile(join(repository, 'tracked.txt'), 'utf8'), 'target\n')
    assert.notEqual(resolve(lease.cwd), resolve(repository))
    observations.push({ name, outcome: drift ? 'rejected-and-preserved' : 'passed-and-removed' })
  } finally {
    await ctx.fiber.dispose()
    await rm(temp, { recursive: true, force: true })
  }
}
console.log(JSON.stringify({ entry: 'built Git, subprocess, evidence and verifier', observations }))
