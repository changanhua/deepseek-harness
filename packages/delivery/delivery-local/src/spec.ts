/** Durable Storage Domain declaration for the local Personal Delivery provider. */

import {
  acceptanceDecisionSchema,
  contractRevisionSchema,
  deliveryCaseSchema,
  dispatchBindingSchema,
  issuePublicationSchema,
  requirementDecisionSchema,
  workPacketSchema,
  type AcceptanceDecision,
  type ContractRevision,
  type DeliveryCase,
  type DispatchBinding,
  type IssuePublication,
  type RequirementDecision,
  type WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * Private domain identity and format owned by `delivery-local`.
 *
 * Version 2 adds the Delivery Case, requirement-decision, and Issue-publication
 * record families of the frozen version-2 contract. Storage Domain has no data
 * migration: a medium stamped with a different version rejects at open with
 * `version-mismatch`, so a version-1 root fails closed before any write and its
 * bytes stay untouched; version-2 acceptance uses a separate DSH home.
 */
export const deliveryLocalDomainSpec = defineDomain({
  name: 'personal_delivery',
  version: 2,
  tables: {
    contract_revisions: domainTable<string, ContractRevision>(contractRevisionSchema),
    work_packets: domainTable<string, WorkPacket>(workPacketSchema),
    dispatch_bindings: domainTable<string, DispatchBinding>(dispatchBindingSchema),
    acceptance_decisions: domainTable<string, AcceptanceDecision>(acceptanceDecisionSchema),
    delivery_cases: domainTable<string, DeliveryCase>(deliveryCaseSchema),
    requirement_decisions: domainTable<string, RequirementDecision>(requirementDecisionSchema),
    issue_publications: domainTable<string, IssuePublication>(issuePublicationSchema),
  },
})
