import { createHash } from 'node:crypto'
import { mkdir, open, realpath, stat } from 'node:fs/promises'
import net from 'node:net'
import { isAbsolute, join } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { InitiativeError } from '@changanhua/dsh-initiative'

/**
 * Exclusive local-host ownership of one Review decision storage root; OS cleanup releases crashes.
 * @param root - Absolute directory shared by every Host using the same Review decision storage.
 * @returns Idempotent ownership release capability.
 */
export async function acquireReviewOwnership(root: string): Promise<{ release(): Promise<void> }> {
  if (!isAbsolute(root) || root.startsWith('\\') || root.startsWith('//'))
    throw new InitiativeError('conflict', 'review decision ownership requires an absolute local directory')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const directory = await realpath(root)
  if (process.platform === 'win32') return await acquirePipe(directory)
  const path = join(directory, 'initiative-review-owner.lock')
  const handle = await open(path, 'a+', 0o600)
  const before = await handle.stat()
  try {
    await tryLockExclusive(handle.fd)
  } catch (error) {
    await handle.close()
    if (['EAGAIN', 'EWOULDBLOCK'].includes(String((error as NodeJS.ErrnoException).code)))
      throw new InitiativeError('conflict', 'review decision storage already has an owner')
    throw error
  }
  let after
  try {
    after = await stat(path)
  } catch (error) {
    await handle.close()
    throw error
  }
  if (before.ino !== after.ino || before.dev !== after.dev) {
    await handle.close()
    throw new InitiativeError('conflict', 'review decision ownership file changed while locking')
  }
  let released: Promise<void> | undefined
  return { release: () => (released ??= handle.close()) }
}

async function acquirePipe(directory: string): Promise<{ release(): Promise<void> }> {
  const name = `\\\\.\\pipe\\dsh-initiative-review-${createHash('sha256').update(directory.toLowerCase()).digest('hex')}`
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.destroy()
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(name, () => {
        server.off('error', reject)
        resolve()
      })
    })
  } catch (error) {
    server.removeAllListeners()
    server.close()
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE')
      throw new InitiativeError('conflict', 'review decision storage already has an owner')
    throw error
  }
  server.unref()
  let released: Promise<void> | undefined
  return {
    release: () => {
      if (released === undefined) {
        released = (async () => {
          for (const socket of sockets) socket.destroy()
          await new Promise<void>((resolve, reject) =>
            server.close((error) => {
              if (error === undefined) resolve()
              else reject(error)
            }),
          )
        })()
      }
      return released
    },
  }
}
