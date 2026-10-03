import { closeSync, openSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import koffi from 'koffi'
import { WindowsRoleBoundary } from '../src/windows.ts'
import type { WindowsRoleProcess } from '../src/windows.ts'
import { observeVolumeMapping } from '../src/path-adapter.ts'
import { stageProfileFixture } from './runtime-fixture.ts'

test.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('boots the built dsh Profile under AppContainer without broadening read authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-profile-boundary-'))
  const boundary = WindowsRoleBoundary.create(`dsh.eval.test.${randomUUID()}`)
  const taskBoundary = WindowsRoleBoundary.create(`dsh.eval.test.${randomUUID()}`)
  let child: WindowsRoleProcess | undefined
  let task: WindowsRoleProcess | undefined
  const descriptors: number[] = []
  try {
    const runtime = join(root, 'runtime'), home = join(root, 'home'), data = join(home, 'data')
    const secret = join(root, 'observer-secret')
    await mkdir(data, { recursive: true })
    await writeFile(secret, 'host-only')
    const target = join(data, 'actual')
    const alias = join(data, 'alias')
    await mkdir(target)
    await symlink(target, alias, 'junction')
    const processProbe = `
import {createRequire} from 'node:module';
const require=createRequire(${JSON.stringify(pathToFileURL(join(runtime, 'package.json')).href)});
const koffi=require('koffi'), kernel=koffi.load('kernel32.dll'), pid=Number(process.argv[1]);
const open=kernel.func('void * __stdcall OpenProcess(uint32,int,uint32)');
const close=kernel.func('int __stdcall CloseHandle(void *)');
const result=[16,32,64,0x40000].map(right=>{const handle=open(right,0,pid);if(handle)close(handle);return handle===null});
const openThread=kernel.func('void * __stdcall OpenThread(uint32,int,uint32)');
const ids=JSON.parse(process.argv[2]);let denied=true;
for(const id of ids){
  const handle=openThread(0x10,0,id);if(handle){denied=false;close(handle)}
}
result.push(ids.length>0&&denied);
require('node:fs').writeFileSync(${JSON.stringify(join(data, 'process-rights.json'))},JSON.stringify(result));
`
    const launched = await stageProfileFixture(runtime, home, `
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
export const name='eval-profile-boundary';
export function apply(ctx) {
  ctx.appReady.onReady(async()=>{
    const alias=${JSON.stringify(alias)};
    const values=[fs.realpathSync(alias),fs.realpathSync.native(Buffer.from(alias)),await fs.promises.realpath(new URL(${JSON.stringify(pathToFileURL(alias).href)})),await new Promise((resolve,reject)=>fs.realpath(alias,(e,p)=>e?reject(e):resolve(p)))];
    let denied=false;try{fs.readFileSync(${JSON.stringify(secret)})}catch(e){denied=['EACCES','EPERM'].includes(e.code)}
    const direct=spawnSync(process.execPath,['-e','process.exit(0)'],{stdio:'inherit',windowsHide:true,timeout:5000});
    if(direct.status===0)throw new Error('core allowed a direct task child');
    fs.writeFileSync(${JSON.stringify(join(data, 'probe-ready'))},'ready');
    const threadFile=${JSON.stringify(join(data, 'thread-ids'))};while(!fs.existsSync(threadFile))await delay(20);
    process.stdout.write(JSON.stringify({ready:true,values,denied})+'\\n');
    ctx.appExit(0);
  });
}`)
    await boundary.grant(runtime, false)
    await boundary.grant(home, true)
    const input = join(root, 'input'), output = join(root, 'stdout'), error = join(root, 'stderr')
    await writeFile(input, '')
    const stdio = { stdin: openSync(input, 'r'), stdout: openSync(output, 'wx'), stderr: openSync(error, 'wx') }
    descriptors.push(...Object.values(stdio))
    const env = { SystemRoot: process.env.SystemRoot!, LOCALAPPDATA: data, USERPROFILE: home, TEMP: data, TMP: data,
      DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_EVAL_VOLUME_MAP: JSON.stringify(observeVolumeMapping(root.slice(0, 2))) }
    child = boundary.launch({ kind: 'core', executable: launched.executable,
      args: ['--preserve-symlinks', '--preserve-symlinks-main', '--import', pathToFileURL(launched.startup).href,
        launched.entrypoint, '--profile', 'eval-fixture'], cwd: data,
      env, stdio })
    await vi.waitFor(async () => { expect(await readFile(join(data, 'probe-ready'), 'utf8')).toBe('ready') }, { timeout: 5000 })
    const kernel = koffi.load('kernel32.dll')
    const snapshot = kernel.func('void * __stdcall CreateToolhelp32Snapshot(uint32,uint32)')(4, 0) as bigint
    const first = kernel.func('int __stdcall Thread32First(void *,void *)')
    const next = kernel.func('int __stdcall Thread32Next(void *,void *)')
    const entry = Buffer.alloc(28), ids: number[] = []
    entry.writeUInt32LE(28)
    try {
      for (let ok = first(snapshot, entry) as number; ok; ok = next(snapshot, entry) as number) {
        if (entry.readUInt32LE(12) === child.pid) ids.push(entry.readUInt32LE(8))
      }
    } finally { kernel.func('int __stdcall CloseHandle(void *)')(snapshot) }
    expect(ids.length).toBeGreaterThan(1)
    await taskBoundary.grant(runtime, false)
    await taskBoundary.grant(data, true)
    task = taskBoundary.launch({ kind: 'task', executable: launched.executable,
      args: ['--preserve-symlinks', '--preserve-symlinks-main', '--import', pathToFileURL(launched.startup).href,
        '--input-type=module', '-e', processProbe, String(child.pid), JSON.stringify(ids)], cwd: data, env, stdio })
    expect(await task.wait(5000)).toBe(0)
    await writeFile(join(data, 'thread-ids'), JSON.stringify(ids))
    const exit = await child.wait(20_000)
    expect(exit, await readFile(error, 'utf8')).toBe(0)
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ ready: true, values: [target, target, target, target], denied: true })
    expect(await readFile(secret, 'utf8')).toBe('host-only')
    expect(JSON.parse(await readFile(join(data, 'process-rights.json'), 'utf8'))).toEqual([true, true, true, true, true])
  } finally {
    if (child) { child.terminate(); await child.wait(10_000) }
    if (task) { task.terminate(); await task.wait(10_000) }
    for (const fd of descriptors) closeSync(fd)
    boundary.close()
    taskBoundary.close()
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
