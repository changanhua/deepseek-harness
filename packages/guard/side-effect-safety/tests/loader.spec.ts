import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

function run(root: string, phase: string): Promise<{ code: number | null; output: string }> {
  const script = fileURLToPath(new URL('./fixtures/runtime.mjs', import.meta.url))
  const repo = resolve(import.meta.dirname, '../../../..')
  return new Promise((resolveResult, reject) => {
    // This test loads built exports deliberately; no provider credentials or local application state.
    const child = spawn(process.execPath, [script, repo, root, phase], {
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DSH_HOME: root }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (data) => { output += String(data) })
    child.stderr.on('data', (data) => { output += String(data) })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000)
    child.on('error', (error) => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code) => { clearTimeout(timeout); resolveResult({ code, output }) })
  })
}

it('built Loader composition survives process loss after SENT without invoking A again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'safety-loader-'))
  try {
    const first = await run(root, 'crash')
    expect(first.code, first.output).toBe(23)
    const onDisk = await readFile(join(root, 'side_effect_safety.json'), 'utf8')
    expect(onDisk).toContain('SENT')
    const next = await run(root, 'recover')
    expect(next.code, next.output).toBe(0)
    expect(next.output).toContain('"sends":1,"blocked":true,"breaker":"COMPLETED","states":["NOT_APPLIED","CONFIRMED"]')
    const settled = await readFile(join(root, 'side_effect_safety.json'), 'utf8')
    expect(settled).not.toContain('"phase": "SENT"')
    expect(settled).toContain('NOT_APPLIED')
    expect(settled).toContain('CONFIRMED')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 45_000)
