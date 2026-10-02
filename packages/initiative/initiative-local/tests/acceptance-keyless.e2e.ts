import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { evaluation } from '../../../requirement-assessment/requirement-assessment/tests/fixtures.ts'
import { runAcceptance } from './fixtures/acceptance-scenario.ts'

// This verifies the process/controller wiring. Scripted responses establish no model behavior.
it('runs the isolated SDK assessment and pending-promotion flow with a loopback fixture', { timeout: 240000, retry: 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-initiative-keyless-'))
  const requests: unknown[] = []
  let candidateCalls = 0
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body) as { tools?: unknown[] }
      requests.push(parsed)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
      if ((parsed.tools?.length ?? 0) === 0) send({ content: JSON.stringify(evaluation) })
      else if (++candidateCalls === 1) {
        send({ tool_calls: [{ index: 0, id: 'fixture-candidate', type: 'function', function: {
          name: 'initiative_record', arguments: JSON.stringify({ input_json: JSON.stringify({ action: 'propose', key: 'fixture-case-b',
            kind: 'simplify', trigger: 'Observed fresh-checkout native JavaScript entry missing',
            facts: { claim: 'Clarify the Windows fresh-checkout native build prerequisite', assumptions: [],
              uncertainties: ['Frequency is unknown'], evidenceRefs: [], counterEvidenceRefs: [],
              suggestedNextStep: 'Check whether the existing setup instructions already explain build:ts' } }) }),
        } }] })
      } else send({ content: 'The existing build:ts command addresses the observed setup failure. Frequency remains unknown.' })
      send({}, candidateCalls === 1 && (parsed.tools?.length ?? 0) > 0 ? 'tool_calls' : 'stop')
      response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind')
    const report = await runAcceptance(root, { ...process.env, DEEPSEEK_API_KEY: 'keyless-fixture-only',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}` }, 'keyless')
    expect(report.liveModelAcceptance).toBe('not claimed')
    expect(requests).toHaveLength(3)
    expect(report.requests).toHaveLength(3)
    for (const ordinal of [1, 2, 3]) {
      const material = await readFile(join(root, 'evidence', `request-${ordinal}.json`), 'utf8')
      expect(material).not.toContain(root.replace(/\\/gu, '\\\\'))
      expect(material).not.toContain('keyless-fixture-only')
    }
  } finally {
    await writeFile(join(root, 'fixture-requests.json'), JSON.stringify(requests, null, 2))
    await writeFile(join(root, 'evidence-location.txt'), 'Retained locally for acceptance facility inspection; dummy key and loopback responses only.\n')
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error) reject(error)
      else resolve()
    }))
    console.info(`Acceptance facility evidence: ${root}`)
  }
})
