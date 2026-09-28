import { mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { acquirePlanningOwnership } from '../src/ownership.ts'

const roots: string[] = []
const children: ReturnType<typeof spawn>[] = []
afterEach(async () => {
  await Promise.all(children.splice(0).map(stopOwnedChild))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function stopOwnedChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await new Promise<void>(resolve =>
    child.once('exit', () => {
      resolve()
    }),
  )
}

async function holder(root: string) {
  const child = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      join(process.cwd(), 'packages/planning/planning-local/tests/fixtures/ownership-holder.ts'),
      root,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  children.push(child)
  let stderr = ''
  child.stderr.on('data', (value) => {
    stderr += String(value)
  })
  await new Promise<void>((resolve, reject) => {
    const ready = (value: Buffer) => {
      if (String(value).includes('READY')) finish(resolve)
    }
    const failed = (error: Error) => {
      finish(() => {
        reject(error)
      })
    }
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => {
        reject(new Error(`holder exited code=${String(code)} signal=${String(signal)}: ${stderr}`))
      })
    }
    const timeout = setTimeout(() => {
      finish(() => {
        reject(new Error(`holder readiness timed out: ${stderr}`))
      })
    }, 5000)
    const finish = (done: () => void) => {
      clearTimeout(timeout)
      child.stdout.off('data', ready)
      child.off('error', failed)
      child.off('exit', exited)
      done()
    }
    child.stdout.on('data', ready)
    child.once('error', failed)
    child.once('exit', exited)
  })
  return child
}
describe.skipIf(process.platform !== 'win32')('Windows planning ownership', () => {
  it('rejects a second process, recovers after kill, and releases gracefully', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-planning-owner-'))
    roots.push(root)
    try {
      const first = await holder(root)
      await expect(acquirePlanningOwnership(root)).rejects.toMatchObject({ code: 'conflict' })
      first.kill('SIGKILL')
      await new Promise(resolve => first.once('exit', resolve))
      const recovered = await acquirePlanningOwnership(root)
      await recovered.release()
      const graceful = await holder(root)
      graceful.stdin.write('release\n')
      await new Promise<void>((resolve, reject) => {
        let released = false
        graceful.stdout.on('data', (value) => {
          if (String(value).includes('RELEASED')) released = true
        })
        graceful.once('exit', (code) => {
          if (code === 0 && released) resolve()
          else reject(new Error(`graceful holder exited ${String(code)} before release`))
        })
      })
      const next = await acquirePlanningOwnership(root)
      await next.release()
    } finally {
      await Promise.all(children.splice(0).map(stopOwnedChild))
    }
  })
  it('accepts a client connection and releases without waiting for that client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-planning-owner-'))
    roots.push(root)
    const lease = await acquirePlanningOwnership(root)
    const directory = await realpath(root)
    const pipe = `\\\\.\\pipe\\dsh-planning-${createHash('sha256').update(directory.toLowerCase()).digest('hex')}`
    const client = net.connect(pipe)
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve)
        client.once('error', reject)
      })
      await expect(lease.release()).resolves.toBeUndefined()
    } finally {
      client.destroy()
      await lease.release()
    }
  })
})
