import type { z } from 'zod'
import type { WorkKindDefinition } from '@changanhua/dsh-task-queue'
import type { CreateMonitorSchema, MonitorCheckSchema, MonitorFailureSchema, MonitorMatchSchema,
  MonitorNoticeSchema, MonitorRecordSchema, MonitorSampleSchema } from './schemas.ts'

/** An explicit Host plan; a null interval runs one finite check. */
export type CreateMonitor = z.infer<typeof CreateMonitorSchema>
export type MonitorMatch = z.infer<typeof MonitorMatchSchema>
export type MonitorSample = z.infer<typeof MonitorSampleSchema>
export type MonitorNotice = z.infer<typeof MonitorNoticeSchema>
export type MonitorFailure = z.infer<typeof MonitorFailureSchema>
export type MonitorRecord = z.infer<typeof MonitorRecordSchema>
export type MonitorCheck = z.infer<typeof MonitorCheckSchema>
export interface ResolvedMonitorCheck extends MonitorCheck { readonly installationId: string }
export interface MonitorCheckOutput {
  readonly monitorId: string
  readonly slot: number
  readonly outcome: 'sampled' | 'already-recorded'
}

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'browser.monitor.check@1': WorkKindDefinition<MonitorCheck, ResolvedMonitorCheck, ResolvedMonitorCheck, MonitorCheckOutput>
  }
}
