import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { closeSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { WindowsRoleBoundary } from '../src/windows.ts'
import type { WindowsRoleProcess } from '../src/windows.ts'
import { RoleChannel } from '../src/channel.ts'
import { superviseRoleProcess } from '../src/controller.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eval-isolation-'))
  const boundary = WindowsRoleBoundary.create(`dsh.eval.test.${randomUUID()}`)
  const world = join(root, 'world')
  const data = join(world, 'data')
  await mkdir(data, { recursive: true })
  const executable = join(world, 'node.exe')
  await copyFile(process.execPath, executable)
  await boundary.grant(world, false)
  await boundary.grant(data, true)
  const descriptors: number[] = []
  const processes: WindowsRoleProcess[] = []
  cleanups.push(async () => {
    for (const process of processes) { process.terminate(); await process.wait(10_000) }
    for (const fd of descriptors) closeSync(fd)
    boundary.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, world, data, boundary, async launch(source: string) {
    const script = join(world, `${randomUUID()}.cjs`)
    const output = join(root, `${randomUUID()}.out`)
    const error = join(root, `${randomUUID()}.err`)
    const input = join(root, `${randomUUID()}.in`)
    await writeFile(script, source)
    await writeFile(input, '')
    const stdio = { stdin: openSync(input, 'r'), stdout: openSync(output, 'wx'), stderr: openSync(error, 'wx') }
    descriptors.push(stdio.stdin, stdio.stdout, stdio.stderr)
    const process = boundary.launch({ kind: 'task', executable, args: ['--preserve-symlinks', '--preserve-symlinks-main', script],
      cwd: world, env: { SystemRoot: globalThis.process.env.SystemRoot!, LOCALAPPDATA: data, TEMP: data, TMP: data }, stdio })
    processes.push(process)
    return { process, output, error }
  } }
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('Windows Eval role isolation', () => {
  it('supervises early exit and forced cancellation through process-tree quiescence', async () => {
    for (const cancel of [false, true]) {
      const world = await fixture()
      const channelRoot = join(world.data, 'channel')
      await mkdir(channelRoot)
      const channel = await RoleChannel.create(channelRoot, 1024)
      cleanups.push(() => channel.close())
      const launched = await world.launch(cancel ? 'setInterval(()=>{},1000)' : 'process.exit(3)')
      const abort = new AbortController()
      const running = superviseRoleProcess(launched.process, channel, {
        sessionId: 'subject', maxRequests: 4, model: async () => { throw new Error('must not dispatch') },
      }, { executionMs: 3000, graceMs: 100, stopMs: 3000 }, abort.signal)
      if (cancel) abort.abort()
      const result = await running
      expect(result).toMatchObject({ status: 'uncertain', quiescent: true,
        exitCode: cancel ? 1 : 3, reason: cancel ? 'eval-role-forced-stop' : 'eval-role-exit-without-completion' })
      world.boundary.close()
    }
  }, 15_000)

  it('does not complete from a role report while the actual Job is still running', async () => {
    const world = await fixture()
    const directory = join(world.data, 'channel')
    await mkdir(directory)
    const host = await RoleChannel.create(directory, 1024), writer = await RoleChannel.connect(directory, 1024)
    cleanups.push(async () => { await writer.close(); await host.close() })
    const launched = await world.launch('setInterval(()=>{},1000)')
    const abort = new AbortController()
    const running = superviseRoleProcess(launched.process, host, { sessionId: 'subject', maxRequests: 4,
      model: async () => { throw new Error('must not dispatch') },
    }, { executionMs: 3000, graceMs: 100, stopMs: 3000 }, abort.signal)
    try {
      await writer.send({ sequence: 1, kind: 'ready', value: { sessionId: 'subject' } })
      await writer.receive(1, AbortSignal.timeout(3000))
      await writer.send({ sequence: 2, kind: 'complete', value: { sessionId: 'subject', output: 'forged success', flushed: true } })
      await writer.receive(2, AbortSignal.timeout(3000))
      expect(() =>{  world.boundary.close() }).toThrow('isolation-process-tree-not-quiescent')
      abort.abort()
      expect(await running).toMatchObject({ status: 'uncertain', reason: 'eval-role-forced-stop', quiescent: true,
        protocol: { status: 'reported' } })
      world.boundary.close()
    } finally { abort.abort(); await running }
  }, 15_000)

  it('enforces both role boundaries, sealed code, descendant reads and network denial', async () => {
    let connections = 0
    const server = createServer((socket) => { connections++; socket.end('control') })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) =>{  if (error) reject(error); else resolve() })))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing listener')
    await new Promise<void>((resolve, reject) => {
      const client = connect(address.port, '127.0.0.1')
      client.on('data', () => {})
      client.once('end', resolve)
      client.once('error', reject)
    })
    const subject = await fixture()
    const grader = await fixture()
    await writeFile(join(subject.data, 'private'), 'subject-secret')
    await writeFile(join(grader.data, 'private'), 'grader-secret')
    const observer = join(subject.root, 'observer-private')
    await writeFile(observer, 'observer-secret')
    for (const [self, peer] of [[subject, grader], [grader, subject]] as const) {
      const launched = await self.launch(`
const fs = require('node:fs'), net = require('node:net'), cp = require('node:child_process');
const denied = fn => { try { fn(); return false } catch(e) { return ['EPERM','EACCES'].includes(e.code) } };
const peer = ${JSON.stringify(join(peer.data, 'private'))};
const observer = ${JSON.stringify(observer)};
const result = {
  peerRead: denied(() => fs.readFileSync(peer)), peerWrite: denied(() => fs.writeFileSync(peer, 'changed')),
  observerRead: denied(() => fs.readFileSync(observer)), observerWrite: denied(() => fs.writeFileSync(observer, 'changed')),
  buildWrite: denied(() => fs.writeFileSync(__filename, 'changed')),
};
fs.writeFileSync(${JSON.stringify(join(self.data, 'own'))}, 'own');
const child = cp.spawnSync(process.execPath, ['-e', 'try{require("node:fs").readFileSync('+JSON.stringify(peer)+');process.exit(2)}catch(e){process.exit(["EPERM","EACCES"].includes(e.code)?0:3)}'], {stdio:'inherit', windowsHide:true, timeout:3000});
result.descendantRead = child.status === 0;
const socket = net.connect({host:'127.0.0.1',port:${address.port}});
let finished=false;
function finish(network) { if(finished)return;finished=true;socket.destroy();console.log(JSON.stringify({...result,network})); }
socket.on('connect',()=>finish('connected'));socket.on('error',e=>finish(e.code));socket.setTimeout(2000,()=>finish('timeout'));
`)
      expect(await launched.process.wait(10_000), await readFile(launched.error, 'utf8')).toBe(0)
      const facts = JSON.parse(await readFile(launched.output, 'utf8')) as Record<string, unknown>
      for (const field of ['peerRead', 'peerWrite', 'observerRead', 'observerWrite', 'buildWrite', 'descendantRead']) expect(facts[field], field).toBe(true)
      expect(facts.network).not.toBe('connected')
      expect(await readFile(join(self.data, 'own'), 'utf8')).toBe('own')
    }
    expect(connections).toBe(1)
    expect(await readFile(join(subject.data, 'private'), 'utf8')).toBe('subject-secret')
    expect(await readFile(join(grader.data, 'private'), 'utf8')).toBe('grader-secret')
    expect(await readFile(observer, 'utf8')).toBe('observer-secret')
  }, 30_000)

  it('retains ownership on timeout, kills descendants, and refuses premature profile cleanup', async () => {
    const world = await fixture()
    const marker = join(world.data, 'descendant-ready')
    const child = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`
    const launched = await world.launch(`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit',windowsHide:true});setInterval(()=>{},1000)`)
    const deadline = performance.now() + 5000
    while (true) {
      try { await readFile(marker); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || performance.now() > deadline) throw error
        await delay(20)
      }
    }
    expect(() =>{  world.boundary.close() }).toThrow('isolation-process-tree-not-quiescent')
    await expect(launched.process.wait(20)).rejects.toThrow('isolation-quiescence-uncertain')
    launched.process.terminate()
    expect(await launched.process.wait(5000)).toBe(1)
    world.boundary.close()
  }, 15_000)
})
