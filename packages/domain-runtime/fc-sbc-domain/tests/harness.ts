import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import DomainArtifacts from '../../domain-runtime/src/index.ts'
import FcDomain from '../src/index.ts'
import * as FcTools from '../../tool-fc-sbc-domain/src/index.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
/** Source-plane Loader composition. Built artifact isolation has a separate process fixture. */
export async function load(root: string, config: import('../src/index.ts').Config = {}, maxOutputBytes = 8192) {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', StorageJson], ['@deepseek-ai/dsh-storage-domain',
      StorageDomain],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt], ['@deepseek-ai/dsh-tools', Tools],
    ['@changanhua/dsh-domain-runtime', DomainArtifacts], ['@changanhua/dsh-fc-sbc-domain', FcDomain],
    ['@changanhua/dsh-tool-fc-sbc-domain', FcTools],
  ])
  ctx.loader.internal = { version: 'v2',
    async import(name: string) { if (!modules.has(name)) throw new Error(`unexpected import ${name}`)
      return modules.get(name) } } as unknown as NonNullable<typeof ctx.loader.internal>
  const template = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
  const yaml = template.replace('__STORAGE_ROOT__', JSON.stringify(join(root,
    'storage'))).replace("- name: '@changanhua/dsh-fc-sbc-domain'",
    `- name: '@changanhua/dsh-fc-sbc-domain'\n  config: ${JSON.stringify(config)}`)
  const toolYaml = yaml.replace("- name: '@changanhua/dsh-tool-fc-sbc-domain'", `- name: '@changanhua/dsh-tool-fc-sbc-domain'\n  config: {maxOutputBytes: ${maxOutputBytes}}`)
  const path = join(root, 'cordis.yml'); await writeFile(path, toolYaml)
  try {
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } }); await ctx.loader.await()
    if ([...ctx.loader.entries()].some(row => row.fiber === undefined && !row.disabled)) throw new Error('incomplete Loader composition')
    if (!ctx.get('fcSbcDomain')) throw new Error('FC service did not load')
    return ctx
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
