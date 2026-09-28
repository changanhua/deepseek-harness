import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { planningBoardSchema } from '@changanhua/dsh-planning'
export const planningLocalDomain = defineDomain({
  name: 'planning_boards',
  version: 1,
  layout: 'single',
  tables: { boards: domainTable(planningBoardSchema) },
})
