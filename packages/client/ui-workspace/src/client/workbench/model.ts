/** Workspace overview facts derived from the existing controller snapshots. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { deriveFlat } from '../tree.ts'
import type { SessionNode } from '../tree.ts'

/** One visible conversation with its authoritative project membership. */
export interface WorkbenchItem extends SessionNode {
  workspace: WorkspaceView | undefined
}

/** Read-only overview; unread completion is a reminder, never an acceptance verdict. */
export interface WorkbenchOverview {
  items: readonly WorkbenchItem[]
  attention: readonly WorkbenchItem[]
  running: readonly WorkbenchItem[]
  projects: readonly WorkspaceView[]
}

/** Fold live list facts without creating work, changing selection, or inspecting transcripts. */
export function deriveWorkbench(
  sessions: SessionListState,
  workspaces: WorkspaceSnapshot,
  pending: SessionPendingInteractionSnapshot,
): WorkbenchOverview {
  const membership = new Map<SessionId, WorkspaceView>()
  for (const workspace of workspaces.items) {
    for (const id of workspace.sessionIds) membership.set(id, workspace)
  }
  const items = deriveFlat(sessions, workspaces.archivedSessionIds, pending)
    .filter(item => !item.blank)
    .map(item => ({ ...item, workspace: membership.get(item.id) }))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
  return {
    items,
    attention: items.filter(item => item.pendingInteraction !== undefined || item.completed),
    running: items.filter(item => item.running || item.runningSubagentCount > 0),
    projects: workspaces.items,
  }
}
