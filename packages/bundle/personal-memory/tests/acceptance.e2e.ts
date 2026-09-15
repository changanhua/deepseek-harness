import { createHash, randomUUID } from 'node:crypto'
import { access, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAcceptanceWorld } from './acceptance-world.ts'
import { assertRecalled, assertWithheld, memoryCalls, memoryResults, persistedMemories } from './assertions.ts'
import { memoryCredentialAvailable } from './live-provider.ts'

afterEach(() => { vi.unstubAllEnvs() })

// Keyless CI follows the repository convention; a skip never closes live acceptance.
it.skipIf(!await memoryCredentialAvailable())('uses real model memory across sessions, normal Host restart, source revision, isolation, and withdrawal',
  { retry: 0, timeout: 900_000 }, async () => {
    vi.stubEnv('DSH_SNAPSHOT', 'record')
    const world = await createAcceptanceWorld()
    const initialCommand = 'pnpm verify:memory-' + randomUUID()
    const revisedCommand = 'pnpm verify:revised-' + randomUUID()
    const initialSource = '# Project validation\n\nThe required validation command is ' + initialCommand + '.\n'
    const revisedSource = '# Project validation\n\nThe required validation command is ' + revisedCommand + '.\n'
    const output = join(world.a, 'validation-command.txt')
    try {
      await writeFile(join(world.a, 'README.md'), initialSource)
      await writeFile(join(world.b, 'README.md'), '# Another project\nNo validation rule has been decided.\n')
      await world.start()
      const a1 = await world.session(world.a)
      await world.prompt(a1, 'Read README.md. Propose exactly one memory for the validation method using topic_key validation.command, '
        + 'kind method, title Project validation, source README.md and idempotency_key acceptance-initial. Do not run commands or edit files.')
      expect(memoryCalls(a1, 'memory_propose')).toHaveLength(1)
      const candidates = await persistedMemories(world.storageRoot)
      expect(await readFile(join(world.a, 'README.md'), 'utf8')).toBe(initialSource)
      expect(candidates).toHaveLength(1)
      const candidate = candidates[0]!
      expect(candidate).toMatchObject({ activeRevision: null, candidateRevision: 1, decisions: [] })
      expect(candidate.revisions[0]?.statement).toContain(initialCommand)
      expect(candidate.revisions[0]?.sources).toMatchObject([{
        kind: 'file', path: 'README.md', sha256: createHash('sha256').update(initialSource).digest('hex'),
      }])
      const id = candidate.id
      await world.command(a1, '/memory show ' + id)
      const accepted = await world.command(a1, '/memory accept ' + id + '@1')
      const active = (await persistedMemories(world.storageRoot))[0]!
      expect(active).toMatchObject({ activeRevision: 1, candidateRevision: null, recordVersion: 2 })
      expect(active.decisions[0]).toMatchObject({ action: 'accept', commandId: accepted?.commandId, sessionId: a1.id, revision: 1 })

      const requestOutput = 'Find the project validation method using memory_search, then create validation-command.txt with only its exact command. '
        + 'Use current sources if memory is unavailable. Change only this output file. Do not execute the validation command.'
      const a2 = await world.session(world.a)
      await world.prompt(a2, requestOutput)
      assertRecalled(a2, id, 1, initialCommand)
      expect((await readFile(output, 'utf8')).trim()).toBe(initialCommand)
      expect(await readFile(join(world.a, 'README.md'), 'utf8')).toBe(initialSource)
      await writeFile(join(world.evidence, 'a2-output.txt'), await readFile(output))
      await rm(output)

      await world.stop()
      await expect(access(join(world.home, 'storages/project-memory-ownership/owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
      await world.start()
      const a3 = await world.session(world.a)
      await world.prompt(a3, requestOutput)
      assertRecalled(a3, id, 1, initialCommand)
      expect((await readFile(output, 'utf8')).trim()).toBe(initialCommand)
      expect(await readFile(join(world.a, 'README.md'), 'utf8')).toBe(initialSource)
      expect((await persistedMemories(world.storageRoot))[0]?.revisions).toEqual(active.revisions)
      await writeFile(join(world.evidence, 'a3-output.txt'), await readFile(output))
      await rm(output)

      await writeFile(join(world.a, 'README.md'), revisedSource)
      const changed = await world.session(world.a)
      await world.prompt(changed, 'Use memory_search to find the project validation command. Report whether any usable memory exists. Do not edit files.')
      assertWithheld(changed, id, initialCommand)
      await world.prompt(changed, 'Read the current README.md and propose a revision of memory ' + id
        + ' at expected_version 2, using topic_key validation.command and idempotency_key acceptance-revision. Do not accept it or edit files.')
      const revision = (await persistedMemories(world.storageRoot))[0]!
      expect(await readFile(join(world.a, 'README.md'), 'utf8')).toBe(revisedSource)
      expect(revision).toMatchObject({ id, activeRevision: 1, candidateRevision: 2, recordVersion: 3 })
      expect(revision.revisions[0]).toEqual(active.revisions[0])
      expect(revision.revisions[1]?.statement).toContain(revisedCommand)
      expect(revision.revisions[1]?.sources).toMatchObject([{
        kind: 'file', path: 'README.md', sha256: createHash('sha256').update(revisedSource).digest('hex'),
      }])
      await world.command(changed, '/memory show ' + id + '@2')
      await world.command(changed, '/memory accept ' + id + '@2')
      const revised = await world.session(world.a)
      await world.prompt(revised, requestOutput)
      assertRecalled(revised, id, 2, revisedCommand)
      expect((await readFile(output, 'utf8')).trim()).toBe(revisedCommand)
      expect(await readFile(join(world.a, 'README.md'), 'utf8')).toBe(revisedSource)
      await writeFile(join(world.evidence, 'revised-output.txt'), await readFile(output))

      const b = await world.session(world.b)
      await world.prompt(b, 'Use memory_search to find the project validation command, then call memory_read for ' + id
        + '. Report only whether usable memory exists. Do not browse other projects or edit files.')
      assertWithheld(b, id, revisedCommand)
      expect(memoryCalls(b, 'memory_read')).toHaveLength(1)
      const foreign = memoryResults(b, 'memory_read', true)
      expect(JSON.stringify(foreign)).not.toContain(revisedCommand)
      expect(JSON.stringify(foreign)).not.toContain(world.a)
      expect(await readFile(join(world.b, 'README.md'), 'utf8')).toBe('# Another project\nNo validation rule has been decided.\n')
      await world.command(revised, '/memory retire ' + id + '@2')
      const withdrawn = await world.session(world.a)
      await world.prompt(withdrawn, 'Use memory_search for the project validation command. Report only whether a usable memory exists.')
      assertWithheld(withdrawn, id, revisedCommand)
      expect((await persistedMemories(world.storageRoot))[0]).toMatchObject({ id, activeRevision: null })
      await world.saveEvidence()
      await writeFile(join(world.evidence, 'result.json'), JSON.stringify({
        status: 'passed', id, initialRevision: 1, finalRevision: 2, normalRestart: true,
        crossSessionArtifact: true, sourceRevisionArtifact: true, projectIsolation: true, withdrawal: true,
        browserEvidence: 'separate project-memory Web snapshot required', benefit: 'not assessed by this scenario',
      }, null, 2))
    } finally {
      await world.close()
    }
  })
