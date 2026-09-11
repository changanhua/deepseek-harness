import type { z } from 'zod'
import type { ActivityBatchSchema, ActivityEventSchema, ActivityPolicySchema, ActivityRecordSchema, ActivitySettingsSchema,
  ConfigureActivitySchema, ActivityQuerySchema } from './schemas.ts'

export type ActivitySettings = z.infer<typeof ActivitySettingsSchema>
export type ActivityPolicy = z.infer<typeof ActivityPolicySchema>
export type ActivityEvent = z.infer<typeof ActivityEventSchema>
export type ActivityBatch = z.infer<typeof ActivityBatchSchema>
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>
export type ConfigureActivity = z.infer<typeof ConfigureActivitySchema>
export type ActivityQuery = z.input<typeof ActivityQuerySchema>
export interface ActivityState {
  readonly revision: string | null
  readonly policy: ActivityPolicy | null
  readonly sequence: number
  readonly authorizationChanged: boolean
}
export interface ActivityReceipt { readonly sequence: number; readonly accepted: number }
