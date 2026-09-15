import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'vitest'
import { memoryRecordSchema } from '@changanhua/dsh-memory'
import type { WebScaffold } from '../../../../apps/web/tests/scaffold.ts'

export type AcceptanceAgent = NonNullable<ReturnType<WebScaffold['ctx']['agents']['get']>>

export async function persistedMemories(storageRoot: string) {
  const payload = JSON.parse(await readFile(join(storageRoot, 'project_memory.json'), 'utf8')) as {
    tables: { memories: Record<string, unknown> }
  }
  return Object.values(payload.tables.memories).map(value => memoryRecordSchema.parse(value))
}

export function memoryCalls(agent: AcceptanceAgent, name: string) {
  return agent.session.events.filter(event => event.type === 'tool/call').filter(event => event.data.name === name)
}

export function memoryResults(agent: AcceptanceAgent, name: string, allowErrors = false): unknown[] {
  const ids = new Set(memoryCalls(agent, name).map(event => event.data.callId))
  const results = agent.session.events.filter(event => event.type === 'tool/result')
    .filter(event => ids.has(event.data.message.content[0].toolCallId))
  expect(results, 'every memory call must have one observed result').toHaveLength(ids.size)
  return results
    .map((event) => {
      const result = event.data.message.content[0]
      if (allowErrors && result.isError) return result
      expect(event.data.error, 'memory tool must finish without an internal failure').toBeUndefined()
      expect(result.isError, 'memory tool result must be successful').not.toBe(true)
      const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
      return JSON.parse(text) as unknown
    })
}

export function assertRecalled(agent: AcceptanceAgent, id: string, revision: number, statement: string): void {
  const results = memoryResults(agent, 'memory_search') as Array<{ items: Array<{
    id: string
    eligibility: string
    checkedAt: string
    memory?: { revision: number; statement: string; sources: unknown[] }
  }> }>
  const hit = results.flatMap(result => result.items).find(item => item.id === id)
  expect(hit).toMatchObject({ id, eligibility: 'usable', memory: { revision } })
  expect(hit?.memory?.statement).toContain(statement)
  expect(hit?.memory?.sources.length).toBeGreaterThan(0)
  expect(Number.isFinite(Date.parse(hit?.checkedAt ?? ''))).toBe(true)
}

export function assertWithheld(agent: AcceptanceAgent, id: string, forbidden: string): void {
  const results = memoryResults(agent, 'memory_search') as Array<{ items: Array<{ id: string }> }>
  expect(results.length, 'a real model memory search must be observed').toBeGreaterThan(0)
  expect(results.flatMap(result => result.items).some(item => item.id === id)).toBe(false)
  expect(JSON.stringify(results)).not.toContain(forbidden)
}
