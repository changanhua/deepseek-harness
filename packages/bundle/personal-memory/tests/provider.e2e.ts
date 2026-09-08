import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAcceptanceWorld } from './acceptance-world.ts'
import { memoryCredentialAvailable, MEMORY_MODEL, GO_PROVIDER } from './live-provider.ts'

afterEach(() => { vi.unstubAllEnvs() })

it.skipIf(!await memoryCredentialAvailable(GO_PROVIDER))('writes a real artifact using configured OpenCode Go Flash with the official route absent',
  { retry: 0, timeout: 180_000 }, async () => {
    vi.stubEnv('DSH_SNAPSHOT', 'record')
    const world = await createAcceptanceWorld(true, GO_PROVIDER)
    try {
      const host = await world.start()
      const catalog = await host.ctx.sessionController.modelCatalog()
      expect(JSON.stringify(catalog)).toContain(GO_PROVIDER)
      expect(JSON.stringify(catalog)).not.toContain('deepseek-official')
      const caller = await world.session(world.a)
      await world.prompt(caller, 'Write provider-proof.txt containing exactly OPENCODE_GO_FLASH_OK. Do not alter any other file.')
      expect((await readFile(join(world.a, 'provider-proof.txt'), 'utf8')).trim()).toBe('OPENCODE_GO_FLASH_OK')
      await writeFile(join(world.evidence, 'provider-proof.txt'), await readFile(join(world.a, 'provider-proof.txt')))
      await writeFile(join(world.evidence, 'provider-result.json'), JSON.stringify({
        provider: GO_PROVIDER, model: MEMORY_MODEL, officialAbsent: true, artifactVerified: true,
      }, null, 2))
      console.log('Verified OpenCode Go Flash artifact: ' + world.evidence)
    } finally {
      await world.close()
    }
  })
