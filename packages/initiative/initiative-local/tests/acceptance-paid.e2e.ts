import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'
import { runAcceptance } from './fixtures/acceptance-scenario.ts'

// Credentials alone never authorize this suite. The operator sets this marker only after approval.
it.skipIf(process.env.DSH_INITIATIVE_REAL_ACCEPTANCE !== 'approved' || !process.env.DEEPSEEK_API_KEY)(
  'records the approved real-provider acceptance attempt without automatic reruns', { timeout: 600000, retry: 0 }, async () => {
    if (process.env.DEEPSEEK_BASE_URL && process.env.DEEPSEEK_BASE_URL.replace(/\/+$/u, '') !== 'https://api.deepseek.com')
      throw new Error('The approved route requires the public DeepSeek endpoint')
    const root = await mkdtemp(join(tmpdir(), 'dsh-initiative-paid-'))
    console.info(`Real-provider acceptance evidence: ${root}`)
    await runAcceptance(root, process.env, 'paid')
  },
)

it.skipIf(process.env.DSH_INITIATIVE_REAL_ACCEPTANCE !== 'approved' || !process.env.DEEPSEEK_API_KEY)(
  'records a real Agent investigation of a Human Candidate through scoped tools', { timeout: 300000, retry: 0 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-initiative-investigation-'))
    console.info(`Human Candidate investigation evidence: ${root}`)
    await runAcceptance(root, process.env, 'paid', 'human-investigation')
  },
)
