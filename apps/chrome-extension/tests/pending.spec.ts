import { describe, expect, test } from 'vitest'
import {
  createCaptureRequest,
  createPendingSnapshot,
  createPendingStore,
  normalizeBaseUrl,
  submitPending,
} from '../src/pending.js'

type Source = { url: string; pageTitle: string; site: string; kind: 'selection' | 'single-reply'; capturedAt: string; externalMessageId?: string }
type Request = { captureId: string; title: string; markdown: string; source: Source }
type Snapshot = { baseUrl: string; request: Request }
type Storage = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (value: Record<string, unknown>) => Promise<void>
  remove: (key: string) => Promise<void>
}

const source: Source = Object.freeze({
  url: 'https://chatgpt.com/c/example', pageTitle: '示例对话', site: 'ChatGPT',
  kind: 'single-reply' as const, capturedAt: '2026-09-07T01:02:03.000Z', externalMessageId: 'msg_42',
})

describe('待确认采集', () => {
  test('为一次采集创建 UUIDv4 请求，重试始终复用冻结的内容', async () => {
    const request = createCaptureRequest({ title: '标题', markdown: '正文', source }, () => '123e4567-e89b-42d3-a456-426614174000')
    const pending = createPendingSnapshot('https://dsh.example.test/', request) as unknown as Snapshot
    const sent: unknown[] = []

    const result = await submitPending(pending, {
      submit: async (snapshot) => {
        sent.push(snapshot)
        return { kind: 'receipt', entryId: 'web:123e4567-e89b-42d3-a456-426614174000' }
      },
    })

    expect(result).toEqual({ phase: 'saved', entryId: 'web:123e4567-e89b-42d3-a456-426614174000' })
    expect(sent).toEqual([{
      baseUrl: 'https://dsh.example.test', request: {
        captureId: '123e4567-e89b-42d3-a456-426614174000', title: '标题', markdown: '正文', source,
      },
    }])
  })

  test('不把反向代理子路径当作当前支持的 DSH 服务地址', () => {
    expect(() => normalizeBaseUrl('https://dsh.example.test/base')).toThrow('根地址')
  })

  test('存储最多一个待确认快照，并按原服务恢复', async () => {
    const backing = new Map<string, unknown>()
    const storage: Storage = {
      get: async (key: string) => ({ [key]: backing.get(key) }),
      set: async (value: Record<string, unknown>) => { for (const [key, item] of Object.entries(value)) backing.set(key, item) },
      remove: async (key: string) => { backing.delete(key) },
    }
    const store = createPendingStore(storage)
    const first = createPendingSnapshot('http://127.0.0.1:3080', createCaptureRequest({ title: '一', markdown: '甲', source }, () => '123e4567-e89b-42d3-a456-426614174000'))
    const next = createPendingSnapshot('https://server.example.test', createCaptureRequest({ title: '二', markdown: '乙', source }, () => '123e4567-e89b-42d3-a456-426614174001'))

    await store.save(first)
    await expect(store.save(next)).rejects.toThrow('已有待确认采集')
    expect(await store.load()).toEqual(first)
  })

  test('缺少持久回执时不报告已保存', async () => {
    const pending = createPendingSnapshot('https://dsh.example.test', createCaptureRequest({ title: '标题', markdown: '正文', source }, () => '123e4567-e89b-42d3-a456-426614174000'))

    await expect(submitPending(pending, { submit: async () => ({ kind: 'unknown' }) })).resolves.toEqual({ phase: 'unknown' })
  })
})
