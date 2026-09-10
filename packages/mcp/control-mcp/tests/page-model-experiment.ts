/** Controller-owned experiment checks. No verdict is derived from an assistant's reply. */
export interface CollectionEntry { readonly title: string; readonly link: string }
interface EntryClick { readonly sessionId: string; readonly mountId: string; readonly documentId: string; readonly entry: CollectionEntry }
interface CollectionEvidence {
  readonly expected: readonly CollectionEntry[]
  readonly beforeStop: unknown
  readonly afterStop: unknown
  readonly clicks: readonly EntryClick[]
  readonly sessionId: string
  readonly mountId: string
  readonly documentId: string
  readonly cleanup: unknown
  readonly remaining: number
  readonly subjectStopped: boolean
  readonly intervention: boolean
  readonly statePreserved: boolean
  readonly sampleCorrect: boolean
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function equalCollection(value: unknown, expected: readonly CollectionEntry[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((entry: unknown, index) => {
    const row = object(entry)
    return row?.title === expected[index]?.title && row?.link === expected[index]?.link
  })
}

export function verifyCollection(input: CollectionEvidence): { status: 'verified' | 'failed'; failures: string[] } {
  const failures: string[] = []
  if (input.expected.length !== 3 || new Set(input.expected.map(entry => entry.link)).size !== 3
    || input.expected.some(entry => !entry.title.trim() || !/^https?:\/\//u.test(entry.link))) throw new Error('invalid_expected_collection')
  if (!equalCollection(input.beforeStop, input.expected)) failures.push('collection_mismatch')
  if (!equalCollection(input.afterStop, input.expected)) failures.push('results_lost_on_stop')
  if (input.expected.some(entry => !input.clicks.some(click => click.sessionId === input.sessionId
    && click.mountId === input.mountId && click.documentId === input.documentId
    && click.entry.title === entry.title && click.entry.link === entry.link))) failures.push('missing_entry_event')
  const cleanup = object(input.cleanup)
  const value = object(cleanup?.value)
  if (cleanup?.outcome !== 'observed' || value?.unmounted !== true || value.remaining !== 0) failures.push('cleanup_unverified')
  if (input.remaining !== 0) failures.push('page_residue')
  if (!input.subjectStopped) failures.push('subject_did_not_stop')
  if (input.intervention) failures.push('intervention')
  if (!input.statePreserved) failures.push('collected_state_lost')
  if (!input.sampleCorrect) failures.push('binding_sample_mismatch')
  return { status: failures.length === 0 ? 'verified' : 'failed', failures }
}

const SCALE = 1_000_000
function cost(value: number, allowZero = false): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)
    || !Number.isSafeInteger(Math.ceil(value * SCALE))) throw new Error('invalid_cost')
  return Math.ceil(value * SCALE)
}

/** One total allocation shared by every model and sample in this experiment. */
export class ExperimentBudget {
  private readonly total: number
  private charged = 0
  private reserved = 0
  private closed = false
  private readonly runs = new Set<string>()

  constructor(totalRmb: number) { this.total = cost(totalRmb) }

  snapshot() {
    return { chargedRmb: this.charged / SCALE, reservedRmb: this.reserved / SCALE,
      remainingRmb: Math.max(0, this.total - this.charged - this.reserved) / SCALE, closed: this.closed }
  }

  start(runId: string, maxRunRmb: number) {
    if (!runId || this.runs.has(runId)) throw new Error('duplicate_run')
    const maxRun = cost(maxRunRmb)
    if (maxRun > this.total) throw new Error('run_budget_exceeds_total')
    this.runs.add(runId)
    let modelRequests = 0, browserOperations = 0, cleanupOperations = 0, runAllocated = 0, failed = false
    const reserve = (maxRequestRmb: number) => {
      if (failed) throw new Error('run_terminal')
      if (modelRequests >= 12) { failed = true; throw new Error('model_budget_exhausted') }
      const amount = cost(maxRequestRmb)
      if (this.closed || this.charged + this.reserved + amount > this.total || runAllocated + amount > maxRun) {
        failed = true
        throw new Error('cost_budget_exhausted')
      }
      modelRequests++
      runAllocated += amount
      this.reserved += amount
      let settled = false
      return { settle: (actualRmb: number) => {
        if (settled) throw new Error('request_already_settled')
        const actual = cost(actualRmb, true)
        if (actual > amount) { this.closed = true; failed = true; throw new Error('cost_exceeded_reservation') }
        settled = true
        this.reserved -= amount
        this.charged += actual
        runAllocated -= amount - actual
      } }
    }
    return {
      request: reserve,
      browser: (_operation: 'execute' | 'prepare' | 'executePrepared', cleanup = false) => {
        if (cleanup) { cleanupOperations++; return }
        if (failed) throw new Error('run_terminal')
        if (browserOperations >= 40) { failed = true; throw new Error('browser_budget_exhausted') }
        browserOperations++
      },
      snapshot: () => ({ runId, modelRequests, browserOperations, cleanupOperations, failed, allocatedRmb: runAllocated / SCALE }),
    }
  }
}

/** Abort of the subject must not cancel the controller's bounded resource recovery. */
export async function withExperimentCleanup<T>(task: () => Promise<T>, cleanup: (signal: AbortSignal) => Promise<void>): Promise<T> {
  let result: T | undefined
  let taskError: unknown
  let failed = false
  try { result = await task() } catch (error) { failed = true; taskError = error }
  try { await cleanup(AbortSignal.timeout(5_000)) } catch (cleanupError) {
    if (failed) throw new AggregateError([taskError, cleanupError], 'experiment_and_cleanup_failed')
    throw cleanupError
  }
  if (failed) throw taskError
  return result as T
}
