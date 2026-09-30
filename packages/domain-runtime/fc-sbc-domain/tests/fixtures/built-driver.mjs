import { registerHooks } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const [repository, root, isolatedOwner, inputFile] = process.argv.slice(2)
registerHooks({ resolve(specifier, context, next) {
  if (specifier.includes('/apps/chrome-extension/') || context.parentURL?.includes('/apps/chrome-extension/')) throw new Error('app source access forbidden in built artifact fixture')
  return next(specifier, context)
} })
globalThis.fetch = () => { throw new Error('network access forbidden in fixture') }
let forbiddenCalls = 0
globalThis.services = new Proxy({}, { get() { forbiddenCalls += 1; throw new Error('MAIN-world service access forbidden') } })
const moduleAt = path => import(pathToFileURL(join(repository, path)).href)
const { Context } = await moduleAt('vendor/cordis/lib/index.js')
const { default: Loader } = await moduleAt('vendor/loader/lib/index.js')
const { default: Include } = await moduleAt('vendor/include/lib/index.js')
const modules = new Map([
  ['@deepseek-ai/dsh-storage', await moduleAt('packages/storage/storage/lib/index.js')],
  ['@deepseek-ai/dsh-storage-json', await moduleAt('packages/storage/storage-json/lib/index.js')],
  ['@deepseek-ai/dsh-storage-domain', await moduleAt('packages/storage/storage-domain/lib/index.js')],
  ['@changanhua/dsh-domain-runtime', await moduleAt('packages/domain-runtime/domain-runtime/lib/index.js')],
  ['@changanhua/dsh-fc-sbc-domain', await import(pathToFileURL(isolatedOwner).href)],
])
const config = join(root, 'built-cordis.yml')
await writeFile(config, [...modules.keys()].map(name => `- name: '${name}'${name.endsWith('storage-json') ? `\n  config: {root: ${JSON.stringify(join(root, 'built-storage'))}}` : name.endsWith('storage-domain') ? '\n  config: {backend: json}' : ''}`).join('\n'))
async function boot() {
  const ctx = new Context(); ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name) { if (!modules.has(name)) throw new Error(`unexpected import ${name}`); return modules.get(name) } }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } }); await ctx.loader.await()
  if (!ctx.get('fcSbcDomain')) throw new Error('FC owner unavailable')
  return ctx
}
let ctx = await boot()
try {
  const input = JSON.parse(await readFile(inputFile, 'utf8'))
  const realityRef = await ctx.fcSbcDomain.captureReality(input)
  const planRef = await ctx.fcSbcDomain.buildPlan({ requestId: 'built-plan', realityRef, searchLimit: 1 })
  const before = await ctx.domainArtifacts.readArtifact(planRef)
  await ctx.fiber.dispose(); ctx = await boot()
  const after = await ctx.domainArtifacts.readArtifact(planRef)
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('restart changed the Plan artifact')
  process.stdout.write(JSON.stringify({ realityRef, planRef, payload: after.payload, forbiddenCalls, restarted: true }))
} finally { await ctx.fiber.dispose() }
