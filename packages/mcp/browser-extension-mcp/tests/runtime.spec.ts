import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { connectorVersion, diagnoseStatus, runtimeIdentity } from '../src/runtime.ts'

describe('runtime diagnostics', () => {
  const mcp = runtimeIdentity(import.meta.url)
  it('keeps protocol identity aligned with the installed package version', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(connectorVersion).toBe(manifest.version)
  })
  it('identifies missing relay metadata without claiming which version is installed', () => {
    expect(diagnoseStatus({ instances: [] }, mcp)).toMatchObject({ connector: { mcp, relay: null }, issues: [
      { component: 'relay', code: 'runtime_unknown' }, { component: 'extension', code: 'no_connected_installation' },
    ] })
  })
  it('compares only connector versions, preserving the actual relay location', () => {
    const relay = { ...mcp, version: '0.1.0', modulePath: 'C:\\old-release\\startup.js', processId: 1234 }
    const status = diagnoseStatus({ relay, instances: [{ installationId: randomUUID(), online: true, scopes: ['browser:read'],
      runtime: { version: '42.0' }, capabilities: { targetFreeOpen: true, actionKinds: ['tab_open'] } }] }, mcp)
    expect(status.connector.relay).toEqual(relay)
    expect(status.issues).toEqual([{ component: 'relay', code: 'connector_version_mismatch' }])
  })
  it('does not report stale extension capabilities as online', () => {
    expect(diagnoseStatus({ relay: mcp, instances: [{ installationId: randomUUID(), online: false, scopes: [] }] }, mcp).issues)
      .toEqual([{ component: 'extension', installationId: expect.any(String), code: 'offline' }])
  })
})
