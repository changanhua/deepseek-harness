import { createHash, randomBytes } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { BrowserGrants, type GrantSummary } from '../src/grants.ts'

const installationA = '123e4567-e89b-42d3-a456-426614174000'
const installationB = '223e4567-e89b-42d3-a456-426614174000'
const extensionA = 'a'.repeat(32)
const extensionB = 'b'.repeat(32)
const proof = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(Buffer.from(verifier, 'base64url')).digest('base64url') }
}

class SerialCredentials extends MemoryCredentials {
  private writes = Promise.resolve()
  override modifyRecord(
    key: CredentialKey,
    mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const operation = this.writes.then(() => super.modifyRecord(key, mutate))
    this.writes = operation.then(() => {}, () => {})
    return operation
  }
}

async function harness(trusted: readonly string[] = []) {
  const ctx = new Context()
  await ctx.plugin(SerialCredentials)
  const lost: GrantSummary[] = []
  const grants = new BrowserGrants(ctx, { requestTTL: 1000, pendingLimit: 4, maxGrants: 4 }, () => {}, trusted,
    (grant) => { lost.push(grant) })
  await grants.start()
  return { grants, lost }
}

async function approve(grants: BrowserGrants, extensionId: string, installationId: string): Promise<GrantSummary> {
  const pending = await grants.begin({ extensionId, installationId, challenge: proof().challenge,
    scopes: ['browser:read'], origins: ['*'] })
  return grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })
}

describe('BrowserGrants authority loss', () => {
  it('reports the exact old epoch once on explicit revoke', async () => {
    const { grants, lost } = await harness()
    const granted = await approve(grants, extensionA, installationA)

    await grants.revoke(installationA)

    expect(lost).toEqual([granted])
  })

  it('does not report surviving grants during an unrelated credential refresh', async () => {
    const { grants, lost } = await harness()
    await approve(grants, extensionA, installationA)
    await approve(grants, extensionB, installationB)

    expect(lost).toEqual([])
  })

  it('reports a trusted grant when a replacement changes its installation and epoch', async () => {
    const { grants, lost } = await harness([extensionA])
    const first = await grants.trust({ extensionId: extensionA, installationId: installationA,
      challenge: proof().challenge, scopes: ['browser:read'], origins: ['*'] })

    await grants.trust({ extensionId: extensionA, installationId: installationB,
      challenge: proof().challenge, scopes: ['browser:read'], origins: ['*'] })

    expect(lost).toEqual([first.grant])
  })
})
