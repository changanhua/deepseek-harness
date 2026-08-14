/**
 * Service-level mutation FIFO and the faulted resolution protocol (§4.2).
 *
 * Every durable mutation (enqueue, batch, inbox import, settlement, cancel
 * intent, retry, notification ack) is serialized through one promise chain keyed
 * by the owning service instance, mirroring `schedule`'s
 * `runScheduleTransaction`. An append/fsync failure is NOT proof a transfer did
 * not happen, so the FIFO transitions the service to `faulted`, then re-reads
 * the active log and decides by committed seq whether the change landed:
 *
 *  - committed (seq + canonical payload match) → replay, exit faulted, succeed;
 *  - uncommitted and the prior line's tail is intact → truly not transferred,
 *    keep faulted off, preserve the original I/O error;
 *  - undecidable (log unreadable / line corrupt) → stay fail-closed, no auto
 *    resume.
 *
 * The running-publication special case lets the scheduler retry the same
 * canonical `running` payload under the next seq without a second spawn.
 * @module @deepseek-ai/dsh-task-queue-local/fifo
 */

const tails = new WeakMap<object, Promise<void>>()

/**
 * Serialize one operation after its owning service's prior operation.
 * @param owner - the exact service instance acting as the serialization key.
 * @param operation - the complete mutation to run exclusively.
 * @returns the operation's result after exclusive execution.
 */
export async function runMutationTransaction<T>(
  owner: object,
  operation: () => Promise<T>,
): Promise<T> {
  const prior = tails.get(owner) ?? Promise.resolve()
  const run = prior.then(operation)
  const tail = run.then(() => undefined, () => undefined)
  tails.set(owner, tail)
  try {
    return await run
  } finally {
    if (tails.get(owner) === tail) tails.delete(owner)
  }
}

/** Outcome classes for the post-failure committed/uncommitted determination. */
export type FaultDetermination =
  | { kind: 'committed' }
  | { kind: 'uncommitted'; original: unknown }
  | { kind: 'undecidable'; reason: string }

/** Error raised and surfaced by `stats()` and every rejected new mutation while faulted. */
export class FaultedError extends Error {
  constructor(message = 'task queue is faulted; operator recovery or restart required') {
    super(message)
    this.name = 'FaultedError'
  }
}

/**
 * Fold the durable log and classify a just-attempted change by seq and payload.
 *
 * The backend's store exposes `foldCommitted()` and `canonical change` helpers;
 * this thin wrapper keeps the FIFO's decision logic independent of the store's
 * parsing internals. `expectedSeq`/`expectedCanonical` describe the change the
 * failed mutation was trying to append; `committedSeq` is the log's current
 * high-water; `logIntact` is false when the read itself failed or a corrupt
 * line was observed (which the store reports as a `FaultedError` instead).
 *
 * @param committed - whether the attempted change is present at its expected seq with matching payload.
 * @param tailIntact - whether the previously-committed line's tail is intact (transfer truly absent).
 * @param original - the I/O error the mutation raised (preserved on `uncommitted`).
 * @param reason - description when the determination is impossible.
 * @returns the classified determination for the faulted mutation.
 */
export function determineFault(
  committed: boolean,
  tailIntact: boolean,
  original: unknown,
  reason?: string,
): FaultDetermination {
  if (committed) return { kind: 'committed' }
  if (!tailIntact) return { kind: 'undecidable', reason: reason ?? 'log tail corrupt' }
  return { kind: 'uncommitted', original }
}
