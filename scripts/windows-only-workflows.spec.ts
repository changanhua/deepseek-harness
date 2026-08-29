import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('fork workflow policy', () => {
  it('limits pull-request CI to the four native Windows jobs', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(Object.keys(workflow.jobs).sort()).toEqual([
      'windows-build',
      'windows-coverage',
      'windows-native-tests',
      'windows-observational',
    ])

    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      if (!isRecord(job)) throw new TypeError(`${jobName} must define a job`)
      expect(job['runs-on'], `${jobName} must use GitHub-hosted Windows`).toBe('windows-latest')
    }
  })
})

function loadWorkflow(file: string): { on: Record<string, unknown>; jobs: Record<string, unknown> } {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows', file), 'utf8'))
  if (!isRecord(workflow) || !isRecord(workflow.on) || !isRecord(workflow.jobs)) {
    throw new TypeError(`${file} must define workflow events and jobs`)
  }
  return { on: workflow.on, jobs: workflow.jobs }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
