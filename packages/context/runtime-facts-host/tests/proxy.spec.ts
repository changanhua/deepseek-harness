import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import RuntimeFacts, { factKey } from '@deepseek-ai/dsh-runtime-facts'
import * as RuntimeFactsHost from '@deepseek-ai/dsh-runtime-facts-host'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import { sanitizeProxy } from '../src/proxy.ts'

describe('sanitizeProxy', () => {
  it('keeps only scalar connection metadata from a credential-bearing proxy URL', () => {
    const snapshot = createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: {
        HTTPS_PROXY: 'http://user:pass@proxy.example.com:8080/private?token=secret',
      },
    }])

    const proxy = sanitizeProxy(snapshot)
    expect(proxy).toEqual({
      configured: true,
      scheme: 'http',
      host: 'proxy.example.com',
      port: 8080,
      source: 'env',
    })
    expect(JSON.stringify(proxy)).not.toContain('user')
    expect(JSON.stringify(proxy)).not.toContain('pass')
    expect(JSON.stringify(proxy)).not.toContain('token')
    expect(JSON.stringify(proxy)).not.toContain('/private')
  })

  it('marks an invalid proxy URL unconfigured and returns no raw value', () => {
    const snapshot = createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { HTTPS_PROXY: 'not a proxy URL with secret-token' },
    }])
    expect(sanitizeProxy(snapshot)).toEqual({ configured: false })
  })

  it('publishes five sanitized scalar facts from one launch snapshot', async () => {
    const ctx = new Context()
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { HTTP_PROXY: 'https://alice:hunter2@proxy.example.com:8443/a?key=sk-test' },
    }]))
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(RuntimeFacts, {})
    await ctx.plugin(RuntimeFactsHost)

    const result = await ctx.runtimeFacts.inspect([
      factKey('host.proxy.configured'),
      factKey('host.proxy.scheme'),
      factKey('host.proxy.host'),
      factKey('host.proxy.port'),
      factKey('host.proxy.source'),
    ])
    expect(result).toEqual({
      'host.proxy.configured': { status: 'ok', value: true },
      'host.proxy.scheme': { status: 'ok', value: 'https' },
      'host.proxy.host': { status: 'ok', value: 'proxy.example.com' },
      'host.proxy.port': { status: 'ok', value: 8443 },
      'host.proxy.source': { status: 'ok', value: 'env' },
    })
    expect(JSON.stringify(result)).not.toMatch(/alice|hunter2|sk-test|\/a/)
  })
})
