import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('fork Windows pull-request workflow', () => {
  it('blocks on build and C0 differential evidence through one stable verdict', () => {
    const workflow = loadWorkflow('.github/workflows/ci-fork-windows.yml')
    expect(Object.keys(workflow.on)).toEqual(['pull_request'])
    expect(Object.keys(workflow.jobs).sort()).toEqual(['c0-diff', 'fork-checks', 'windows-build'])

    const build = workflowJob(workflow, 'windows-build')
    const c0Diff = workflowJob(workflow, 'c0-diff')
    const verdict = workflowJob(workflow, 'fork-checks')
    for (const [name, job] of [['windows-build', build], ['c0-diff', c0Diff], ['fork-checks', verdict]] as const) {
      expect(job['runs-on'], `${name} must use native hosted Windows`).toBe('windows-latest')
    }

    const buildCommands = commandText(build)
    expect(workflowStep(build, step => step.uses === 'actions/checkout@v6').with).toMatchObject({ 'fetch-depth': 0 })
    expect(buildCommands).toContain('pnpm run build')
    expect(buildCommands).toContain('pnpm run check:core-patches')
    expect(buildCommands.indexOf('pnpm run check:core-patches')).toBeLessThan(buildCommands.indexOf('pnpm run build'))
    expect(buildCommands).not.toContain('check:ci:windows-blocking')
    expect(buildCommands).not.toContain('docs:build')

    const diffCommands = commandText(c0Diff)
    expect(diffCommands).toContain('pnpm --dir head run check:ci:fork-c0-diff')
    expect(diffCommands).toContain('github.event.pull_request.base.sha')
    expect(diffCommands).toContain('scripts/test-invariants.spec.ts')
    const c0PnpmSetup = workflowStep(c0Diff, step => step.uses === 'pnpm/action-setup@v4')
    expect(c0PnpmSetup.with).toMatchObject({ version: '11.7.0' })
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    expect(manifest.scripts?.['check:ci:fork-c0-diff']).toBe('tsx scripts/run-fork-c0-diff.ts')
    expect(verdict.needs).toEqual(['windows-build', 'c0-diff'])
    expect(verdict.if).toBe('always()')
    const verdictStep = workflowStep(verdict, step => step.name === 'Require every fork check')
    expect(verdictStep.env).toMatchObject({
      ACTOR: '${{ github.actor }}',
      AUTHOR: '${{ github.event.pull_request.user.login }}',
      HEAD_REPOSITORY: '${{ github.event.pull_request.head.repo.full_name }}',
      REPOSITORY: '${{ github.repository }}',
    })
    expect(commandText(verdict)).toContain("join(needs.*.result, ', ')")
    expect(commandText(verdict)).toContain("$env:ACTOR -ne 'changanhua'")
  })

  it('restricts every hosted Windows job to owner-authored same-repository pull requests', () => {
    const workflow = loadWorkflow('.github/workflows/ci-fork-windows.yml')
    for (const name of ['windows-build', 'c0-diff']) {
      const condition = workflowJob(workflow, name).if
      expect(condition, `${name} must declare an authorization condition`).toEqual(expect.any(String))
      if (typeof condition !== 'string') continue
      expect(condition, `${name} must require the repository owner actor`).toContain(
        "github.actor == 'changanhua'",
      )
      expect(condition, `${name} must require the repository owner author`).toContain(
        "github.event.pull_request.user.login == 'changanhua'",
      )
      expect(condition, `${name} must reject pull requests from forks`).toContain(
        'github.event.pull_request.head.repo.full_name == github.repository',
      )
    }
  })

  it('compares the one-time master rollup against the tested Personal Delivery foundation', () => {
    const workflow = loadWorkflow('.github/workflows/ci-fork-windows.yml')
    if (!isRecord(workflow.env)) throw new TypeError('workflow must define shared environment')
    expect(workflow.env.PERSONAL_DELIVERY_BASELINE_SHA)
      .toBe('527338cf077a475e82b718faa12cc16bfc82283f')

    const c0Diff = workflowJob(workflow, 'c0-diff')
    const scope = workflowStep(c0Diff, step => step.id === 'scope')
    expect(scope.run).toContain('git merge-base --is-ancestor $baseline $pullRequestBase')
    expect(scope.run).toContain('git merge-base --is-ancestor $baseline $pullRequestHead')
    expect(scope.run).toContain('"trusted_base=$trustedBase"')

    const checkout = workflowStep(c0Diff, step => step.name === 'Check out trusted base')
    expect(checkout.with).toMatchObject({ ref: '${{ steps.scope.outputs.trusted_base }}' })
    expect(commandText(c0Diff)).toContain('--base-sha "${{ steps.scope.outputs.trusted_base }}"')
  })
})

interface ParsedWorkflow extends Record<string, unknown> {
  on: Record<string, unknown>
  jobs: Record<string, unknown>
}

function loadWorkflow(path: string): ParsedWorkflow {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow) || !isRecord(workflow.on) || !isRecord(workflow.jobs)) {
    throw new TypeError(`${path} must define workflow events and jobs`)
  }
  return { ...workflow, on: workflow.on, jobs: workflow.jobs }
}

function workflowJob(workflow: Record<string, unknown>, name: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[name])) {
    throw new TypeError(`workflow must define ${name}`)
  }
  return workflow.jobs[name]
}

function commandText(job: Record<string, unknown>): string {
  if (!Array.isArray(job.steps)) throw new TypeError('job must define steps')
  return job.steps
    .filter(isRecord)
    .map(step => typeof step.run === 'string' ? step.run : '')
    .join('\n')
}

function workflowStep(
  job: Record<string, unknown>,
  predicate: (step: Record<string, unknown>) => boolean,
): Record<string, unknown> {
  if (!Array.isArray(job.steps)) throw new TypeError('job must define steps')
  const step = job.steps.filter(isRecord).find(predicate)
  if (step === undefined) throw new TypeError('workflow step is missing')
  return step
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
