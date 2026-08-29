import { mkdtemp, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DeliveryEvidenceError } from '@deepseek-ai/dsh-delivery-evidence'
import {
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  VerificationCheckId,
  WorkPacketId,
  type EvidenceRef,
  type VerificationCheck,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { DeliveryVerificationRunRequest } from '../src/index.ts'
import { createDeliveryVerifier } from '../src/index.ts'
import {
  controlledSubprocessHandle,
  createVerifierFixture,
  settledSubprocessHandle,
} from './harness.ts'

function startFixture(
  request: DeliveryVerificationRunRequest,
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
) {
  return createDeliveryVerifier({
    subprocess: { spawn },
    verifierVersion: 'delivery-verifier@1',
    disposeGraceMs: 5_000,
    verificationOutputBytes: 64 * 1024,
  })(request, new AbortController().signal)
}

describe('delivery verifier execution', () => {
  it('executes the trusted fixed argv and produces a passed verdict', async () => {
    const fixture = await createVerifierFixture()
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())
      const start = createDeliveryVerifier({
        subprocess: { spawn },
        verifierVersion: 'delivery-verifier@1',
        disposeGraceMs: 5_000,
        verificationOutputBytes: 64 * 1024,
      })

      const verdict = await start(
        fixture.request,
        new AbortController().signal,
      ).done

      expect(verdict).toMatchObject({
        packetId: fixture.request.packet.id,
        targetCommit: fixture.request.resolved.targetCommit,
        baseCommit: fixture.request.packet.baseCommit,
        verificationPlanDigest: fixture.request.packet.verificationPlan.digest,
        status: 'passed',
        ancestryResult: 'descendant',
        verifierVersion: 'delivery-verifier@1',
        changedPathFindings: [],
        reviewReasons: [],
      })
      expect(verdict.checkResults).toEqual([
        expect.objectContaining({
          checkId: fixture.check.id,
          status: 'exited',
          exitCode: 0,
          expected: true,
        }),
      ])
      expect(spawn).toHaveBeenCalledOnce()
      expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
        argv: fixture.check.argv,
        cwd: fixture.workspaceRoot,
        graceMs: 5_000,
      }))
      expect(fixture.saves).toEqual([
        expect.objectContaining({ kind: 'verification-output' }),
      ])
      expect(fixture.close).toHaveBeenCalledOnce()
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects a runtime shell command-string plan before side effects', async () => {
    const fixture = await createVerifierFixture()
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())
      const forgedCheck: VerificationCheck = {
        ...fixture.check,
        argv: ['pwsh', '-Command', 'Write-Output unsafe'],
      }
      const request = {
        ...fixture.request,
        resolved: {
          ...fixture.request.resolved,
          trustedPlan: {
            ...fixture.request.resolved.trustedPlan,
            checks: [forgedCheck],
          },
        },
      } as DeliveryVerificationRunRequest

      await expect(startFixture(request, spawn).done).rejects.toEqual(
        expect.objectContaining({ code: 'invalid-request' }),
      )
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects a repository-relative cwd whose symlink resolves outside before spawn', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-delivery-verifier-outside-'))
    const linkPath = RepositoryRelativePath('outside-link')
    const fixture = await createVerifierFixture({ check: { cwd: linkPath } })
    try {
      await symlink(
        outside,
        join(fixture.workspaceRoot, linkPath),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      const spawn = vi.fn(() => settledSubprocessHandle())

      await expect(startFixture(fixture.request, spawn).done).rejects.toEqual(
        expect.objectContaining({ code: 'workspace-boundary' }),
      )
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('uses Protocol path semantics to fail forbidden and outside-allowlist changes', async () => {
    const fixture = await createVerifierFixture({
      range: {
        changedPaths: [
          RepositoryRelativePath('packages/unrelated/secret.ts'),
          RepositoryRelativePath('README.md'),
        ],
      },
    })
    try {
      const verdict = await startFixture(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done

      expect(verdict.status).toBe('failed')
      expect(verdict.changedPathFindings).toEqual([
        {
          path: RepositoryRelativePath('packages/unrelated/secret.ts'),
          kind: 'forbidden',
        },
        {
          path: RepositoryRelativePath('README.md'),
          kind: 'outside-allowed',
        },
      ])
    } finally {
      await fixture.cleanup()
    }
  })

  it('fails a required check that exits outside its expected set', async () => {
    const fixture = await createVerifierFixture()
    try {
      const verdict = await startFixture(
        fixture.request,
        vi.fn(() => settledSubprocessHandle({ exitCode: 2, signal: null })),
      ).done

      expect(verdict.status).toBe('failed')
      expect(verdict.checkResults).toEqual([
        expect.objectContaining({
          status: 'exited',
          exitCode: 2,
          expected: false,
        }),
      ])
    } finally {
      await fixture.cleanup()
    }
  })

  it('sends an optional check failure to human review', async () => {
    const fixture = await createVerifierFixture({ check: { severity: 'optional' } })
    try {
      const verdict = await startFixture(
        fixture.request,
        vi.fn(() => settledSubprocessHandle({ exitCode: 2, signal: null })),
      ).done

      expect(verdict.status).toBe('needs-human-review')
      expect(verdict.reviewReasons).toEqual([
        `optional check '${fixture.check.id}' exited with unexpected code 2`,
      ])
    } finally {
      await fixture.cleanup()
    }
  })

  it('records missing completion evidence as a failed integrity finding', async () => {
    const fixture = await createVerifierFixture({ missingClaimEvidence: true })
    try {
      const verdict = await startFixture(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done

      expect(verdict.status).toBe('failed')
      expect(verdict.evidenceIntegrityFindings).toContainEqual({
        evidenceId: fixture.request.completionClaim.evidenceIds[0],
        required: true,
        status: 'missing',
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('times out a check independently from its eventual zero exit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-29T00:00:00.000Z')
    const fixture = await createVerifierFixture({ check: { timeoutMs: 25 } })
    try {
      const controlled = controlledSubprocessHandle({ exitCode: 0, signal: null })
      let markSpawned: () => void = () => {}
      const spawned = new Promise<void>((resolve) => {
        markSpawned = resolve
      })
      const spawn = vi.fn(() => {
        markSpawned()
        return controlled.handle
      })
      const run = startFixture(fixture.request, spawn)
      await spawned

      await vi.advanceTimersByTimeAsync(25)
      controlled.complete()
      const verdict = await run.done

      expect(controlled.terminate).toHaveBeenCalledOnce()
      expect(controlled.waitForExit).toHaveBeenCalledOnce()
      expect(verdict.status).toBe('failed')
      expect(verdict.checkResults).toEqual([
        expect.objectContaining({ status: 'timed-out' }),
      ])
      expect(new TextDecoder().decode(fixture.saves[0]!.data)).toContain('exitCode=0')
      expect(new TextDecoder().decode(fixture.saves[0]!.data)).toContain('timedOut=true')
    } finally {
      vi.useRealTimers()
      await fixture.cleanup()
    }
  })

  it('cancels the active process tree and waits for quiescence', async () => {
    const fixture = await createVerifierFixture()
    const controlled = controlledSubprocessHandle({ exitCode: null, signal: 'SIGTERM' })
    try {
      let markSpawned: () => void = () => {}
      const spawned = new Promise<void>((resolve) => {
        markSpawned = resolve
      })
      const run = startFixture(fixture.request, vi.fn(() => {
        markSpawned()
        return controlled.handle
      }))
      await spawned

      const canceled = run.cancel('operator canceled verification')
      controlled.complete({ exitCode: null, signal: 'SIGTERM' })
      await canceled

      expect(controlled.terminate).toHaveBeenCalledOnce()
      expect(controlled.waitForExit).toHaveBeenCalledOnce()
      await expect(run.done).rejects.toEqual(expect.objectContaining({
        code: 'canceled',
      }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      controlled.complete()
      await fixture.cleanup()
    }
  })

  it('preserves the lease when whole-tree quiescence cannot be proved', async () => {
    const fixture = await createVerifierFixture()
    try {
      const controlled = controlledSubprocessHandle(
        { exitCode: 0, signal: null },
        false,
      )
      controlled.complete()

      await expect(startFixture(
        fixture.request,
        vi.fn(() => controlled.handle),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.close).toHaveBeenCalledWith('preserve')
    } finally {
      await fixture.cleanup()
    }
  })

  it('bounds the complete saved check output in UTF-8 bytes', async () => {
    const fixture = await createVerifierFixture()
    try {
      const start = createDeliveryVerifier({
        subprocess: {
          spawn: vi.fn(() => settledSubprocessHandle(
            { exitCode: 0, signal: null },
            '测'.repeat(20),
            '试'.repeat(20),
          )),
        },
        verifierVersion: 'delivery-verifier@1',
        disposeGraceMs: 5_000,
        verificationOutputBytes: 54,
      })

      await start(fixture.request, new AbortController().signal).done

      expect(fixture.saves).toHaveLength(1)
      expect(fixture.saves[0]!.data.byteLength).toBeLessThanOrEqual(54)
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(
        fixture.saves[0]!.data,
      )).not.toThrow()
    } finally {
      await fixture.cleanup()
    }
  })

  it('classifies a synchronous spawn failure and removes an idle lease', async () => {
    const fixture = await createVerifierFixture()
    try {
      await expect(startFixture(fixture.request, vi.fn(() => {
        throw new Error('spawn failed')
      })).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('reports lease cleanup failure after otherwise successful verification', async () => {
    const fixture = await createVerifierFixture({
      closeError: new Error('cleanup failed'),
    })
    try {
      await expect(startFixture(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'cleanup' }))
    } finally {
      await fixture.cleanup()
    }
  })

  it('maps an evidence-provider digest rejection into a failed integrity finding', async () => {
    const fixture = await createVerifierFixture({
      claimReadError: new DeliveryEvidenceError(
        'digest-mismatch',
        'stored bytes changed',
      ),
    })
    try {
      const verdict = await startFixture(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done

      expect(verdict.status).toBe('failed')
      expect(verdict.evidenceIntegrityFindings).toContainEqual({
        evidenceId: fixture.request.completionClaim.evidenceIds[0],
        required: true,
        status: 'digest-mismatch',
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('distinguishes evidence size mismatch from digest mismatch', async () => {
    const fixture = await createVerifierFixture({
      claimReadData: new Uint8Array(),
    })
    try {
      const verdict = await startFixture(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done

      expect(verdict.evidenceIntegrityFindings).toContainEqual({
        evidenceId: fixture.request.completionClaim.evidenceIds[0],
        required: true,
        status: 'size-mismatch',
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('fails a completion evidence reference with non-change provenance', async () => {
    const fixture = await createVerifierFixture({
      claimEvidenceProvenance: {
        kind: 'verification-check',
        packetId: WorkPacketId('delivery-verifier-packet'),
        queueWorkId: QueueWorkIdRef('another-verification-work'),
        queueAttemptId: QueueAttemptIdRef('another-verification-attempt'),
        checkId: VerificationCheckId('another-verification-check'),
      },
    })
    try {
      const verdict = await startFixture(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done

      expect(verdict.status).toBe('failed')
      expect(verdict.reviewReasons).toContain(
        'completed claim requires matching Git evidence from its producing Queue Attempt',
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects range facts for another repository before workspace or process work', async () => {
    const fixture = await createVerifierFixture({
      range: { repositoryId: RepositoryId('another-repository') },
    })
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())

      await expect(startFixture(fixture.request, spawn).done).rejects.toEqual(
        expect.objectContaining({ code: 'invalid-request' }),
      )
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects a verification lease whose immutable target identity differs', async () => {
    const fixture = await createVerifierFixture({
      workspace: {
        targetCommit: GitCommitId('3333333333333333333333333333333333333333'),
      },
    })
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())

      await expect(startFixture(fixture.request, spawn).done).rejects.toEqual(
        expect.objectContaining({ code: 'invalid-request' }),
      )
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects a Contract repository that differs from the immutable Packet', async () => {
    const fixture = await createVerifierFixture({
      contractRepositoryId: RepositoryId('another-repository'),
    })
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())

      await expect(startFixture(fixture.request, spawn).done).rejects.toEqual(
        expect.objectContaining({ code: 'invalid-request' }),
      )
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects a collect-mode handle that omits an output reader', async () => {
    const fixture = await createVerifierFixture()
    try {
      const settled = settledSubprocessHandle()
      const handle = { ...settled, collected: {} }

      await expect(startFixture(
        fixture.request,
        vi.fn(() => handle),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.saves).toHaveLength(0)
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects output evidence that is not bound to the exact verification check', async () => {
    const fixture = await createVerifierFixture()
    try {
      const originalEvidenceFor = fixture.request.evidenceFor
      const request: DeliveryVerificationRunRequest = {
        ...fixture.request,
        evidenceFor: checkId => ({
          async save(input, signal): Promise<EvidenceRef> {
            const ref = await originalEvidenceFor(checkId).save(input, signal)
            return { ...ref, kind: 'log' }
          },
        }),
      }

      await expect(startFixture(
        request,
        vi.fn(() => settledSubprocessHandle()),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })
})
