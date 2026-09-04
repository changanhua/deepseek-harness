import { DeliveryError } from '@changanhua/dsh-delivery'
import { DeliveryEvidenceError } from '@changanhua/dsh-delivery-evidence'
import { DeliveryGitHubIntakeError } from '@changanhua/dsh-delivery-github-intake'
import { DeliveryTaskQueueError } from '@changanhua/dsh-delivery-task-queue'
import { RepositoryWorkspaceError } from '@changanhua/dsh-repo-workspace'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { DeliveryAcceptanceCandidateError } from '../src/acceptance.ts'
import { remoteFailure, requireActive } from '../src/failures.ts'
import { DeliveryProjectionError } from '../src/projection.ts'

describe('Delivery Remote browser failure mapping', () => {
  it('sanitizes typed failures and gives cancellation precedence', () => {
    const sentinel = 'secret=CREDENTIAL C:\\private idempotency-key=delivery:packet:secret'
    const typed = new TypertRemoteFailure({ code: 'typed', message: sentinel, details: { sentinel } })
    expect(remoteFailure('read', typed).failure).toEqual({
      code: 'internal', message: 'Delivery read failed: internal', details: { operation: 'read' },
    })
    const denied = new TypertRemoteFailure({ code: 'denied', message: sentinel, details: { sentinel } })
    expect(remoteFailure('read', denied).failure).toEqual({
      code: 'denied', message: 'Delivery read failed: denied', details: { operation: 'read' },
    })
    const controller = new AbortController()
    controller.abort('stop')
    expect(remoteFailure('read', new Error('secret'), controller.signal).failure).toEqual({
      code: 'cancelled', message: 'Delivery read was cancelled', details: { operation: 'read' },
    })
    expect(() =>{  requireActive(new AbortController().signal, 'read') }).not.toThrow()
    expect(() =>{  requireActive(controller.signal, 'read') }).toThrow('was cancelled')
  })

  it('maps every Delivery-domain refusal to its stable browser class', () => {
    const sentinel = 'secret=CREDENTIAL C:\\private idempotency-key=delivery:packet:secret'
    const cases = [
      ['not-found', 'not-found'],
      ['idempotency-conflict', 'conflict'],
      ['acceptance-denied', 'denied'],
      ['unavailable', 'unavailable'],
      ['invalid-reference', 'bad-request'],
      ['invalid-transition', 'bad-request'],
    ] as const
    for (const [domainCode, code] of cases) {
      const mapped = remoteFailure('write', new DeliveryError(domainCode, sentinel))
      expect(mapped.failure).toMatchObject({ code, details: { domain: 'delivery', domainCode } })
      expect(JSON.stringify(mapped.failure)).not.toContain(sentinel)
      expect(JSON.stringify(mapped.failure)).not.toContain('idempotency-key')
    }
  })

  it('maps Queue, intake, evidence, repository, projection, and unknown failures', () => {
    const sentinel = 'secret=CREDENTIAL C:\\private idempotency-key=delivery:packet:secret'
    const cases: readonly [unknown, string, string][] = [
      [new DeliveryTaskQueueError('unavailable', sentinel), 'unavailable', 'delivery-task-queue'],
      [new DeliveryTaskQueueError('packet-not-found', sentinel), 'not-found', 'delivery-task-queue'],
      [new DeliveryTaskQueueError('executor-not-allowed', sentinel), 'denied', 'delivery-task-queue'],
      [new DeliveryGitHubIntakeError('network-failure', sentinel), 'unavailable', 'delivery-github-intake'],
      [new DeliveryGitHubIntakeError('invalid-request', sentinel), 'bad-request', 'delivery-github-intake'],
      [new DeliveryEvidenceError('not-found', 'x'), 'not-found', 'delivery-evidence'],
      [new DeliveryEvidenceError('unavailable', 'x'), 'unavailable', 'delivery-evidence'],
      [new DeliveryEvidenceError('digest-mismatch', 'x'), 'denied', 'delivery-evidence'],
      [new RepositoryWorkspaceError('unavailable', 'x'), 'unavailable', 'repo-workspace'],
      [new RepositoryWorkspaceError('repository-not-found', 'x'), 'not-found', 'repo-workspace'],
      [new RepositoryWorkspaceError('revision-not-found', 'x'), 'not-found', 'repo-workspace'],
      [new RepositoryWorkspaceError('repository-mismatch', 'x'), 'denied', 'repo-workspace'],
      [new DeliveryProjectionError(sentinel), 'denied', 'delivery-projection'],
      [new DeliveryAcceptanceCandidateError(sentinel), 'denied', 'delivery-projection'],
    ]
    for (const [error, code, domain] of cases) {
      const failure = remoteFailure('operation', error).failure
      expect(failure).toMatchObject({
        code, details: { operation: 'operation', domain },
      })
      expect(JSON.stringify(failure)).not.toContain(sentinel)
    }
    expect(remoteFailure('operation', new Error('private path')).failure).toEqual({
      code: 'internal',
      message: 'Delivery operation failed',
      details: { operation: 'operation' },
    })
  })
})
