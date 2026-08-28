/**
 * Pure session-resolution helpers for the Skills management feature.
 * Everything here is a deterministic function of (a) the feature store's
 * adopted-session fact, (b) the current sessions list and (c) the current
 * selection. No subscription machinery, no host access — components derive
 * their target through `useMemo` from framework-hook data.
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** The resolved addressable target for a Skills surface. */
export type SkillsTarget =
  /** The popover's "Manage all" deliberately adopted this session; hold it fixed. */
  | { readonly mode: 'explicit'; readonly sessionId: SessionId }
  /** Follow the current ordinary session (direct Settings navigation). */
  | { readonly mode: 'following'; readonly sessionId: SessionId }
  /** No ordinary session available: render the empty state, never query global. */
  | { readonly mode: 'none' }

/** Minimal structural view the resolver reads off a sessions-list row. */
export interface OrdinarySessionRow {
  readonly id: SessionId
  readonly blank?: boolean
  readonly origin?: string | undefined
}

/** Is one row an ordinary session (addressable by the management remote)?
 * @param row - the session list row to classify.
 * @returns true when the row is a real, addressable ordinary session. */
export function isOrdinary(row: OrdinarySessionRow): boolean {
  return row.blank !== true && row.origin !== 'subagent'
}

/**
 * Project a sessions-list map onto the ordinary-session facts used for target resolution.
 * Blank and subagent rows are excluded: a management query addresses a real
 * ordinary session, never the host global registry on a cold/blank selection.
 * @param byId - the list store's row map.
 * @param current - the list store's current selection.
 * @returns known ids and the current ordinary id.
 */
export function ordinarySessionsOf(
  byId: Readonly<Record<string, OrdinarySessionRow>>,
  current: SessionId | undefined,
): { known: ReadonlySet<SessionId>; currentOrdinary: SessionId | undefined } {
  const known = new Set<SessionId>()
  for (const id of Object.keys(byId)) {
    const row = byId[id]
    if (row === undefined) continue
    if (isOrdinary(row)) known.add(row.id)
  }
  const currentRow = current === undefined ? undefined : byId[String(current)]
  const currentOrdinary = currentRow !== undefined && isOrdinary(currentRow) ? current : undefined
  return { known, currentOrdinary }
}

/**
 * Resolve the target to address: a
 * deliberately adopted session wins while it still exists; otherwise follow
 * the current ordinary session; otherwise render the empty state.
 * @param adopted - the feature store's adopted session (undefined = following).
 * @param known - the currently-existing ordinary session ids.
 * @param currentOrdinary - the current ordinary session, or undefined.
 * @returns the resolved target.
 */
export function resolveTarget(
  adopted: SessionId | undefined,
  known: ReadonlySet<SessionId>,
  currentOrdinary: SessionId | undefined,
): SkillsTarget {
  if (adopted !== undefined && known.has(adopted)) return { mode: 'explicit', sessionId: adopted }
  if (currentOrdinary !== undefined) return { mode: 'following', sessionId: currentOrdinary }
  return { mode: 'none' }
}
