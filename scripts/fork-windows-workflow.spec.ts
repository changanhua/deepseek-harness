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
    expect(buildCommands).toContain('pnpm run build')
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
    expect(verdict.if).toBe("always() && github.event_name == 'pull_request'")
    expect(commandText(verdict)).toContain("join(needs.*.result, ', ')")
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
