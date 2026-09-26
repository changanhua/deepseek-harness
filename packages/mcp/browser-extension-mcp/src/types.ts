import type { z } from 'zod'
import type { actionSchema, configSchema, rpcSchema } from './schema.ts'

export type ConnectorConfig = z.infer<typeof configSchema>
export type Action = z.infer<typeof actionSchema>
export type RpcInput = z.infer<typeof rpcSchema>
export interface Grant {
  installationId: string
  extensionId: string
  grantEpoch: number
  origins: string[]
  scopes: string[]
  createdAt: string
}
export interface Invocation {
  protocolVersion: 1
  grantEpoch: number
  requestId: string
  sessionId: string
  installationId: string
  deadline: number
  mutates: boolean
  payload: Action
  target?: { tabId: number; frameId: number; documentId: string }
  fingerprint: string
}
export interface Receipt {
  outcome: 'observed' | 'failed' | 'cancelled' | 'unknown'
  quiescent: boolean
  requestId: string
  sessionId: string
  installationId: string
  reason?: string
  value?: unknown
}
