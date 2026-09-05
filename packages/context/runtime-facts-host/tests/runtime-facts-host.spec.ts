import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import RuntimeFacts, { factKey } from '@changanhua/dsh-runtime-facts'
import * as RuntimeFactsHost from '@changanhua/dsh-runtime-facts-host'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'

async function boot(options: {
  subprocess?: { executionWorld: 'local' | 'remote' }
  webServer?: { host: '127.0.0.1' | '0.0.0.0'; port: number }
  env?: Record<string, string>
} = {}) {
  const ctx = new Context()
  if (options.subprocess !== undefined) ctx.provide('subprocess', options.subprocess as never)
  if (options.webServer !== undefined) ctx.provide('webServer', options.webServer as never)
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([
    { source: 'process', values: options.env ?? {} },
  ]))
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(RuntimeFacts, {})
  const fiber = await ctx.plugin(RuntimeFactsHost)
  return { ctx, fiber }
}

describe('runtime-facts-host', () => {
  it('registers the complete host fact inventory under one owner', async () => {
    const { ctx } = await boot()
    const infos = ctx.runtimeFacts.list()
    expect(infos.map(info => info.key)).toEqual([
      'host.arch',
      'host.os',
      'host.pid',
      'host.proxy.configured',
      'host.proxy.host',
      'host.proxy.port',
      'host.proxy.scheme',
      'host.proxy.source',
      'runtime.execution-world',
      'web.server-url',
    ])
    expect(new Set(infos.map(info => info.owner))).toEqual(new Set(['runtime-facts-host']))
  })

  it('projects only the execution world and keeps host details inspect-only', async () => {
    const subprocess: { executionWorld: 'local' | 'remote' } = { executionWorld: 'local' }
    const { ctx } = await boot({ subprocess })
    expect(ctx.runtimeFacts.render({})).toBe([
      'Host runtime facts:',
      '- runtime.execution-world: local',
    ].join('\n'))
    await expect(ctx.runtimeFacts.inspect([
      factKey('host.arch'),
      factKey('host.os'),
    ])).resolves.toEqual({
      'host.arch': { status: 'ok', value: process.arch },
      'host.os': { status: 'ok', value: process.platform },
    })

    subprocess.executionWorld = 'remote'
    expect(ctx.runtimeFacts.render({})).toContain('- runtime.execution-world: remote')
  })

  it('reports unavailable for optional providers without hiding process constants', async () => {
    const { ctx } = await boot()
    await expect(ctx.runtimeFacts.inspect([
      factKey('host.os'),
      factKey('host.pid'),
      factKey('runtime.execution-world'),
      factKey('web.server-url'),
    ])).resolves.toEqual({
      'host.os': { status: 'ok', value: process.platform },
      'host.pid': { status: 'ok', value: process.pid },
      'runtime.execution-world': { status: 'unavailable' },
      'web.server-url': { status: 'unavailable' },
    })
  })

  it('reads the live web server host and port instead of caching provider state', async () => {
    const webServer = { host: '127.0.0.1' as const, port: 3080 }
    const { ctx } = await boot({ webServer })
    await expect(ctx.runtimeFacts.inspect([factKey('web.server-url')])).resolves.toEqual({
      'web.server-url': { status: 'ok', value: 'http://127.0.0.1:3080' },
    })
    webServer.port = 3081
    await expect(ctx.runtimeFacts.inspect([factKey('web.server-url')])).resolves.toEqual({
      'web.server-url': { status: 'ok', value: 'http://127.0.0.1:3081' },
    })
  })

  it('removes every host fact when its owner fiber unloads', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.runtimeFacts.list()).not.toHaveLength(0)
    await fiber.dispose()
    expect(ctx.runtimeFacts.list()).toHaveLength(0)
  })
})
