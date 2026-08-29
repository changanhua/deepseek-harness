import { spawn as spawnProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessOutputReader,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { createDeliveryVerifier } from '@deepseek-ai/dsh-delivery-verifier'
import { createVerifierFixture } from './harness.ts'

function collectedReader(
  chunks: readonly Buffer[],
  maxBytes: number,
): SubprocessOutputReader {
  return {
    readFrom(fromByte) {
      const complete = Buffer.concat(chunks)
      const retained = complete.subarray(Math.max(0, complete.byteLength - maxBytes))
      const retainedStart = complete.byteLength - retained.byteLength
      const lossy = fromByte < retainedStart
      const start = lossy ? 0 : Math.max(0, fromByte - retainedStart)
      return {
        text: retained.subarray(start).toString('utf8'),
        nextOffset: complete.byteLength,
        lossy,
      }
    },
  }
}

function realNodeSpawn(spec: SubprocessSpawnSpec): SubprocessHandle {
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const child = spawnProcess(spec.argv[0] as string, spec.argv.slice(1), {
    cwd: spec.cwd,
    env: { ...scrubbedParentEnv(), ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(Buffer.from(chunk)) })
  child.stderr.on('data', (chunk: Buffer) => { stderr.push(Buffer.from(chunk)) })
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode, signal) => { resolve({ exitCode, signal }) })
  })
  const terminate = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  const onAbort = () => { terminate() }
  spec.signal?.addEventListener('abort', onAbort, { once: true })
  void done.finally(() => spec.signal?.removeEventListener('abort', onAbort))
  const stdoutMode = spec.stdio.stdout
  const stderrMode = spec.stdio.stderr
  if (stdoutMode === 'pipe' || stdoutMode === 'inherit' || stderrMode === 'pipe' || stderrMode === 'inherit') {
    throw new Error('real-entry fixture requires collect-mode stdout and stderr')
  }
  return {
    pid: child.pid ?? -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: collectedReader(stdout, stdoutMode.maxBytes),
      stderr: collectedReader(stderr, stderrMode.maxBytes),
    },
    done,
    terminate,
    async waitForExit() {
      await done
      return true
    },
  }
}

describe('delivery verifier real public entry', () => {
  it('executes a trusted script file through a real direct-argv process', async () => {
    const fixture = await createVerifierFixture({
      check: {
        argv: [process.execPath, 'verify-target.mjs'],
      },
    })
    try {
      await writeFile(
        join(fixture.workspaceRoot, 'verify-target.mjs'),
        "process.stdout.write('real-entry-ok\\n'); process.stderr.write('real-entry-diagnostic\\n')\n",
      )
      const start = createDeliveryVerifier({
        subprocess: { spawn: realNodeSpawn },
        verifierVersion: 'delivery-verifier-real-entry@1',
        disposeGraceMs: 5_000,
        verificationOutputBytes: 4 * 1024,
      })

      const verdict = await start(
        fixture.request,
        new AbortController().signal,
      ).done

      expect(verdict.status).toBe('passed')
      const output = new TextDecoder().decode(fixture.saves[0]!.data)
      expect(output).toContain('real-entry-ok')
      expect(output).toContain('real-entry-diagnostic')
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })
})
