import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import DomainArtifactRegistry, { domainArtifactRefSchema } from '../src/index.ts'
import type { DomainArtifactHeader, DomainRuntimeProvider } from '../src/index.ts'
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
const ref = (domain: string, kind: string) => domainArtifactRefSchema.parse({ domain, kind, id: 'one', digest: `sha256:${'a'.repeat(64)}` })
const header = (domain: string, kind: string): DomainArtifactHeader => ({ ref: ref(domain, kind),
  createdAt: '2026-09-30T01:00:00.000Z', derivedFrom: [], sourceRefs: [], issues: [] })
const provider = (domain: string, kind: string, payload: unknown): DomainRuntimeProvider => ({ domain,
  descriptor: () => ({ domain: ref(domain, kind).domain, label: domain, artifactKinds: [kind], capabilities: [{ name: 'inspect',
    mode: 'read' }] }),
  readArtifact: async () => ({ header: header(domain, kind), payload }), readArtifactHeader: async () => header(domain, kind),
})
async function setup() { const ctx = new Context(); contexts.push(ctx); await ctx.plugin(DomainArtifactRegistry); return ctx }
describe('domain artifact routing', () => {
  it('routes two unrelated providers without payload interpretation and detaches every read', async () => {
    const ctx = await setup(); const a = { apples: [1, 2] }; const b = ['arbitrary', { beta: true }]
    ctx.domainArtifacts.register(provider('a', 'alpha', a)); ctx.domainArtifacts.register(provider('b', 'beta', b))
    expect(ctx.domainArtifacts.discover().map(row => row.domain)).toEqual(['a', 'b'])
    const read = await ctx.domainArtifacts.readArtifact(ref('a', 'alpha'))
    ;(read!.payload as typeof a).apples.push(3)
    read!.header.issues.push({ code: 'mutated' })
    expect(a.apples).toEqual([1, 2]); expect((await ctx.domainArtifacts.readHeader(ref('a', 'alpha')))!.issues).toEqual([])
    expect((await ctx.domainArtifacts.readArtifact(ref('b', 'beta')))!.payload).toEqual(b)
    const descriptions = ctx.domainArtifacts.discover(); descriptions[0]!.artifactKinds.push('mutated')
    expect(ctx.domainArtifacts.discover()[0]!.artifactKinds).toEqual(['alpha'])
    expect(await ctx.domainArtifacts.parents(ref('a', 'alpha'))).toEqual([])
  })
  it('fails closed for duplicate, unknown domain/kind, malformed and wrong references', async () => {
    const ctx = await setup(); const a = provider('a', 'alpha', false); ctx.domainArtifacts.register(a)
    expect(() => ctx.domainArtifacts.register(a)).toThrow('already registered')
    await expect(ctx.domainArtifacts.readHeader(ref('unknown', 'alpha'))).rejects.toThrow('unavailable')
    await expect(ctx.domainArtifacts.readHeader(ref('a', 'wrong'))).rejects.toThrow('unavailable')
    for (const change of [{ domain: 'wrong' }, { kind: 'wrong' }, { id: 'wrong' }, { digest: `sha256:${'b'.repeat(64)}` }]) {
      a.readArtifactHeader = async () => ({ ...header('a', 'alpha'), ref: domainArtifactRefSchema.parse({ ...ref('a', 'alpha'),
        ...change }) })
      await expect(ctx.domainArtifacts.readHeader(ref('a', 'alpha'))).rejects.toThrow('different artifact')
    }
    a.readArtifact = async () => ({ header: header('a', 'alpha'), payload: { invalid: undefined } })
    await expect(ctx.domainArtifacts.readArtifact(ref('a', 'alpha'))).rejects.toThrow('lossless JSON')
  })
  it('checks whole UTF-8 metadata bounds and preserves absent artifacts', async () => {
    const ctx = await setup(); const a = provider('a', 'alpha', null); ctx.domainArtifacts.register(a)
    a.readArtifactHeader = async () => ({ ...header('a', 'alpha'), coverage: { status: 'partial',
      reasons: Array(64).fill('界'.repeat(512)) } })
    await expect(ctx.domainArtifacts.readHeader(ref('a', 'alpha'))).rejects.toThrow('32768 UTF-8 bytes')
    a.readArtifact = async () => undefined; a.readArtifactHeader = async () => undefined
    expect(await ctx.domainArtifacts.readArtifact(ref('a', 'alpha'))).toBeUndefined()
    expect(await ctx.domainArtifacts.parents(ref('a', 'alpha'))).toBeUndefined()
    await expect(ctx.domainArtifacts.readHeader(ref('a', 'alpha'), AbortSignal.abort())).rejects.toThrow()
  })
  it('captures stable registration identity and disposes with its contributing fiber', async () => {
    const ctx = await setup(); const a = provider('a', 'alpha', null)
    const fiber = ctx.plugin({ name: 'contributor', inject: ['domainArtifacts'],
      apply(scope: Context) { scope.domainArtifacts.register(a) } })
    await fiber
    Object.assign(a, { domain: 'mutated' })
    expect((await ctx.domainArtifacts.readHeader(ref('a', 'alpha')))!.ref.domain).toBe('a')
    await fiber.dispose()
    expect(ctx.domainArtifacts.discover()).toEqual([])
    await expect(ctx.domainArtifacts.readHeader(ref('a', 'alpha'))).rejects.toThrow('unavailable')
  })
  it('rejects an in-flight read after dispose and same-object re-registration', async () => {
    const ctx = await setup(); const a = provider('a', 'alpha', null); const deferred = Promise.withResolvers<DomainArtifactHeader>()
    a.readArtifactHeader = () => deferred.promise
    const dispose = ctx.domainArtifacts.register(a)
    const pending = ctx.domainArtifacts.readHeader(ref('a', 'alpha'))
    dispose(); ctx.domainArtifacts.register(a); deferred.resolve(header('a', 'alpha'))
    await expect(pending).rejects.toThrow('unloaded')
  })
})
