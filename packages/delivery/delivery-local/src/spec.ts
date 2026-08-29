/** Durable Storage Domain declaration for the local Personal Delivery provider. */

import {
  acceptanceDecisionSchema,
  contractRevisionSchema,
  dispatchBindingSchema,
  workPacketSchema,
  type AcceptanceDecision,
  type ContractRevision,
  type DispatchBinding,
  type WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Private domain identity and format owned by `delivery-local`. */
export const deliveryLocalDomainSpec = defineDomain({
  name: 'personal_delivery',
  version: 1,
  tables: {
    contract_revisions: domainTable<string, ContractRevision>(contractRevisionSchema),
    work_packets: domainTable<string, WorkPacket>(workPacketSchema),
    dispatch_bindings: domainTable<string, DispatchBinding>(dispatchBindingSchema),
    acceptance_decisions: domainTable<string, AcceptanceDecision>(acceptanceDecisionSchema),
  },
})
