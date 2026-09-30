import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const repositoryRoot = resolve(import.meta.dirname, '..')
const script = join(repositoryRoot, 'scripts', 'normalize-staged-logs.ts')
const tsxLoader = pathToFileURL(join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function run(input: string): { output: string; result: ReturnType<typeof spawnSync> } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-normalize-log-'))
  roots.push(root)
  const output = join(root, 'evidence.log')
  writeFileSync(output, input)
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, output], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  return { output, result }
}

describe('staged log normalization', () => {
  it('removes terminal trailing whitespace and excess EOF lines without changing log text', () => {
    const { output, result } = run('first  \r\n  indented\t\r\n\r\n\r\n')
    expect(result.status, String(result.stderr)).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe('first\n  indented\n')
  })

  it('keeps an empty log empty', () => {
    const { output, result } = run('')
    expect(result.status, String(result.stderr)).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe('')
  })

  it('runs automatically before the staged whitespace check', () => {
    const config = readFileSync(join(repositoryRoot, 'lefthook.yml'), 'utf8')
    const whitespace = config.indexOf('name: whitespace (staged)')
    const followingJob = config.indexOf('\n    - name:', whitespace + 1)
    const job = config.slice(whitespace, followingJob)
    expect(job).toContain('normalize-staged-logs.ts --staged')
    expect(job.indexOf('normalize-staged-logs.ts')).toBeLessThan(job.indexOf('git diff --cached --check'))
    expect(job).not.toContain('stage_fixed: true')
  })

  it('normalizes the index without staging unrelated working-tree changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-normalize-index-log-'))
    roots.push(root)
    const output = join(root, 'evidence.log')
    spawnSync('git', ['init', '--quiet'], { cwd: root })
    writeFileSync(output, 'staged  \n')
    spawnSync('git', ['add', '--', 'evidence.log'], { cwd: root })
    writeFileSync(output, 'staged  \nunstaged\n')

    const result = spawnSync(process.execPath, ['--import', tsxLoader, script, '--staged', 'evidence.log'], {
      cwd: root,
      encoding: 'utf8',
    })

    expect(result.status, String(result.stderr)).toBe(0)
    expect(spawnSync('git', ['show', ':evidence.log'], { cwd: root, encoding: 'utf8' }).stdout).toBe('staged\n')
    expect(readFileSync(output, 'utf8')).toBe('staged  \nunstaged\n')
  })
})
