/**
 * Built-in Command Knowledge Plane profiles: canonical, verified product CLI
 * identities. Admission follows authoritative product documentation, never
 * local resolvability — knowledge correctness is independent of runtime
 * presence.
 * @module @deepseek-ai/dsh-command-profile/src/builtin
 */

import type { CommandProfileContribution } from './types.ts'

/** Contributor id of every built-in knowledge record. */
export const BUILTIN_CONTRIBUTOR_ID = 'dsh-command-profiles-builtin'

/** The V2 minimal built-in set, keyed by canonical product identity. */
export const BUILTIN_COMMAND_PROFILE_CONTRIBUTIONS: readonly CommandProfileContribution[] = [
  {
    contributorId: BUILTIN_CONTRIBUTOR_ID,
    source: 'builtin',
    profileId: 'github-cli',
    displayName: 'GitHub CLI',
    description: 'Official GitHub command-line interface',
    candidates: ['gh'],
  },
  {
    contributorId: BUILTIN_CONTRIBUTOR_ID,
    source: 'builtin',
    profileId: 'claude-code',
    displayName: 'Claude Code',
    description: 'Anthropic official command-line coding agent',
    candidates: ['claude'],
  },
  {
    contributorId: BUILTIN_CONTRIBUTOR_ID,
    source: 'builtin',
    profileId: 'codex-cli',
    displayName: 'Codex CLI',
    description: 'OpenAI official command-line coding agent',
    candidates: ['codex'],
  },
  {
    contributorId: BUILTIN_CONTRIBUTOR_ID,
    source: 'builtin',
    profileId: 'opencode-cli',
    displayName: 'OpenCode',
    description: 'Open-source AI coding agent command-line interface',
    candidates: ['opencode'],
  },
]
