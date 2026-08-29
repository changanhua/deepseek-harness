/** Local Delivery evidence provider scaffold. @module @deepseek-ai/dsh-delivery-evidence-local */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EvidenceId, EvidenceRef } from '@deepseek-ai/dsh-delivery-protocol'
import {
  DeliveryEvidence,
  DeliveryEvidenceError,
} from '@deepseek-ai/dsh-delivery-evidence'
import type {
  SaveDeliveryEvidence,
  StoredDeliveryEvidence,
} from '@deepseek-ai/dsh-delivery-evidence'

const UNAVAILABLE = 'delivery-evidence-local is unavailable because immutable byte storage is not implemented'

/** Local evidence-store location. */
export interface Config {
  /** Private directory containing content-addressed evidence objects. */
  readonly root: string
}

/** Loader configuration schema. */
export const Config: z<Config> = z.object({
  root: z.string().required(),
})

/** Filesystem-backed evidence provider selected for the local MVP. */
export class LocalDeliveryEvidence extends DeliveryEvidence {
  static Config = Config

  constructor(ctx: Context, config: Config) {
    super(ctx)
    void config
  }

  save(_input: SaveDeliveryEvidence, _signal?: AbortSignal): Promise<EvidenceRef> {
    return Promise.reject(new DeliveryEvidenceError('unavailable', UNAVAILABLE))
  }

  resolve(_id: EvidenceId, _signal?: AbortSignal): Promise<EvidenceRef | undefined> {
    return Promise.reject(new DeliveryEvidenceError('unavailable', UNAVAILABLE))
  }

  read(_ref: EvidenceRef, _signal?: AbortSignal): Promise<StoredDeliveryEvidence> {
    return Promise.reject(new DeliveryEvidenceError('unavailable', UNAVAILABLE))
  }
}

export default LocalDeliveryEvidence
