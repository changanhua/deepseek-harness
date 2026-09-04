import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalDelivery from '@changanhua/dsh-delivery-local'
import LocalDeliveryEvidence from '@changanhua/dsh-delivery-evidence-local'
import {
  AcceptanceClauseId,
  GitCommitId,
  RepositoryId,
  VerificationCheckId,
  githubIssueContentDigest,
} from '@changanhua/dsh-delivery-protocol'
import DeliveryRemote from '@changanhua/dsh-delivery-remote'
import * as DeliveryTaskQueue from '@changanhua/dsh-delivery-task-queue'
import GitLocalRepositoryWorkspace from '@changanhua/dsh-repo-workspace-git-local'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '@changanhua/dsh-task-queue-local'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

const uiDeliveryHost = { apply(): void {} }

describe('Personal Delivery bundle composition', () => {
  it('mounts the complete host and browser chain over the base Web profile', () => {
    const patch = load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as {
      insert?: {
        id?: string
        name?: string
        config?: Record<string, unknown>
      }[]
    }[]
    const rows = patch.flatMap(entry => entry.insert ?? [])

    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['delivery-local', '@changanhua/dsh-delivery-local'],
      ['delivery-evidence-local', '@changanhua/dsh-delivery-evidence-local'],
      ['repo-workspace-git-local', '@changanhua/dsh-repo-workspace-git-local'],
      ['delivery-task-queue', '@changanhua/dsh-delivery-task-queue'],
      ['delivery-remote', '@changanhua/dsh-delivery-remote'],
      ['ui-delivery', '@changanhua/dsh-client-ui-delivery'],
    ])
    expect(rows.find(row => row.id === 'delivery-evidence-local')?.config).toEqual({
      root: { __jsExpr: "dshHomePath('personal-delivery/evidence')" },
    })
    expect(rows.find(row => row.id === 'repo-workspace-git-local')?.config).toEqual({
      repositories: { workspace: { __jsExpr: 'process.cwd()' } },
      worktreeRoot: { __jsExpr: "dshHomePath('personal-delivery/worktrees')" },
    })
  })

  it('boots and disposes the complete chain through Loader', { timeout: 30_000 }, async () => {
    const temp = await mkdtemp(resolve(tmpdir(), 'dsh-personal-delivery-loader-'))
    const configPath = resolve(temp, 'cordis.yml')
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
      .replace("!!js dshHomePath('personal-delivery/evidence')", JSON.stringify(resolve(temp, 'evidence')))
      .replace('!!js process.cwd()', JSON.stringify(resolve(import.meta.dirname, '../../../..')))
      .replace("!!js dshHomePath('personal-delivery/worktrees')", JSON.stringify(resolve(temp, 'worktrees')))
      .replace(/^- insert:\r?\n/mu, '')
      .replace(/^    /gmu, '')
    await writeFile(configPath, [
      "- { id: storage, name: '@deepseek-ai/dsh-storage' }",
      "- id: storage-json\n  name: '@deepseek-ai/dsh-storage-json'\n  config:\n    root: " + JSON.stringify(resolve(temp, 'storage')),
      "- id: storage-domain\n  name: '@deepseek-ai/dsh-storage-domain'\n  config:\n    backend: json",
      "- { id: subprocess, name: '@deepseek-ai/dsh-subprocess-local' }",
      "- id: task-queue\n  name: '@changanhua/dsh-task-queue-local'\n  config:\n    queueRoot: " + JSON.stringify(resolve(temp, 'queue')) + '\n    maxConcurrent: 1\n    resourceCapacity:\n      agent-run: 1',
      patch,
    ].join('\n'))

    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-json', StorageJson],
      ['@deepseek-ai/dsh-storage-domain', StorageDomain],
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
      ['@changanhua/dsh-task-queue-local', LocalTaskQueue],
      ['@changanhua/dsh-delivery-local', LocalDelivery],
      ['@changanhua/dsh-delivery-evidence-local', LocalDeliveryEvidence],
      ['@changanhua/dsh-repo-workspace-git-local', GitLocalRepositoryWorkspace],
      ['@changanhua/dsh-delivery-task-queue', DeliveryTaskQueue],
      ['@changanhua/dsh-delivery-remote', DeliveryRemote],
      ['@changanhua/dsh-client-ui-delivery', uiDeliveryHost],
    ])
    const boot = async (): Promise<Context> => {
      const ctx = new Context()
      ctx.baseUrl = pathToFileURL(temp).href + '/'
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      ctx.loader.internal = {
        version: 'v2',
        async import(specifier: string) {
          const plugin = modules.get(specifier)
          if (plugin === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
          return plugin
        },
      } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({
        name: 'cordis:include',
        config: { path: pathToFileURL(configPath).href },
      })
      await ctx.loader.await()
      return ctx
    }

    let first: Context | undefined
    let reopened: Context | undefined
    try {
      first = await boot()

      expect(first.get('delivery')).toBeDefined()
      expect(first.get('deliveryEvidence')).toBeDefined()
      expect(first.get('repoWorkspace')).toBeDefined()
      expect(first.taskQueue.listKinds()).toEqual(expect.arrayContaining(['code.change@1', 'code.verify@1']))
      expect([...first.loader.entries()].find(entry => entry.options.id === 'delivery-remote')?.fiber).toBeDefined()
      expect([...first.loader.entries()].find(entry => entry.options.id === 'ui-delivery')?.fiber).toBeDefined()

      const title = 'Compose Personal Delivery'
      const body = 'Keep one restart-stable Contract revision.'
      const { case: createdCase, revision } = await first.delivery.createCase({
        idempotencyKey: 'personal-delivery-loader-restart',
        repositoryId: RepositoryId('workspace'),
        origin: {
          kind: 'github-import',
          repository: { owner: 'changanhua', name: 'deepseek-harness' },
          issueNumber: 1,
          contentDigest: githubIssueContentDigest({ title, body }),
        },
        title,
        revision: {
          outcome: 'Prove the final bundle composition.',
          context: 'The Loader owns the complete Personal Delivery chain.',
          allowedScope: ['The Personal Delivery bundle.'],
          forbiddenScope: ['Unrelated packages.'],
          acceptanceClauses: [{ id: AcceptanceClauseId('bundle-composes'), text: 'The complete chain boots.' }],
          openDecisions: [],
          baseSelectionRule: {
            kind: 'commit',
            commit: GitCommitId('8d25c4ccd4ce5578a699b97b654cd6b46f733f63'),
          },
          verificationSource: {
            kind: 'contract-field',
            checks: [{
              id: VerificationCheckId('bundle-smoke'),
              name: 'Bundle smoke',
              argv: [process.execPath, '--version'],
              cwd: '.',
              timeoutMs: 30_000,
              severity: 'required',
              expectedExitCodes: [0],
            }],
          },
          referenceLinks: [],
        },
      })
      expect(createdCase.headRevisionId).toBe(revision.id)
      await first.fiber.dispose()
      first = undefined

      reopened = await boot()
      expect(reopened.delivery.getContractRevision(revision.id)).toEqual(revision)
      expect(reopened.delivery.getCase(createdCase.id)).toEqual(createdCase)
    } finally {
      await first?.fiber.dispose()
      await reopened?.fiber.dispose()
      await rm(temp, { recursive: true, force: true })
    }
  })
})
