/**
 * Candidate executable-name grammar for the Command Knowledge Plane.
 * @module @deepseek-ai/dsh-command-profile/src/candidate
 */

/**
 * A bare executable token: one identifier with no whitespace, path separators,
 * shell operators, or leading dash. Rejects invocation recipes (`npx foo`,
 * `python -m foo`), pipelines, subcommands, flags, and file paths so the
 * Knowledge → `runtime_inspect` chain stays type-safe.
 */
const CANDIDATE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

/**
 * Validate one candidate executable name, failing loud on any violation.
 * @param command - the candidate to register.
 * @throws TypeError when the candidate is empty or not a bare executable token.
 */
export function validateCandidate(command: string): void {
  if (command.length === 0) {
    throw new TypeError('command candidate must not be empty')
  }
  if (!CANDIDATE_PATTERN.test(command)) {
    throw new TypeError(
      `command candidate ${JSON.stringify(command)} must be a bare executable token`
      + ' (no whitespace, path separators, shell operators, or leading dash)',
    )
  }
}
