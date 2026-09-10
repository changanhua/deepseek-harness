/** Pending questions owned by one opt-in control Host; Session tool results own answer history. */
import { randomUUID } from 'node:crypto'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'

export interface ControlAttention {
  readonly attentionId: string
  readonly kind: 'user_question'
  readonly questions: readonly AskUserQuestionItem[]
}

interface Pending {
  readonly sessionId: string
  readonly value: ControlAttention
  readonly signal?: AbortSignal
  readonly settle: (answer?: AskUserQuestionAnswer, error?: unknown) => void
}

/** Answers settle the exact live request; cancellation and disposal retract it immediately. */
export class ControlAttentions {
  private readonly pending = new Map<string, Pending>()
  private readonly listeners = new Set<() => void>()
  private disposed = false

  list(sessionId: string): readonly ControlAttention[] {
    return [...this.pending.values()].filter(item => item.sessionId === sessionId)
      .map(item => structuredClone(item.value))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async ask(sessionId: string, request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (this.disposed) return Promise.reject(new Error('control Host disposed'))
    request.signal?.throwIfAborted()
    if (this.pending.size >= 32 || request.questions.length > 32
      || new Set(request.questions.map(question => question.id)).size !== request.questions.length
      || Buffer.byteLength(JSON.stringify(request.questions)) > 65_536) {
      return Promise.reject(new Error('control attention capacity exceeded'))
    }
    const value: ControlAttention = {
      attentionId: randomUUID(), kind: 'user_question', questions: structuredClone(request.questions),
    }
    const deferred = Promise.withResolvers<AskUserQuestionAnswer>()
    const abort = () => { settle(undefined, request.signal?.reason ?? new Error('question aborted')) }
    const settle = (answer?: AskUserQuestionAnswer, error?: unknown): void => {
      if (!this.pending.delete(value.attentionId)) return
      request.signal?.removeEventListener('abort', abort)
      if (answer === undefined) deferred.reject(error)
      else deferred.resolve(answer)
      this.changed()
    }
    this.pending.set(value.attentionId, {
      sessionId, value, settle,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    request.signal?.addEventListener('abort', abort, { once: true })
    this.changed()
    return deferred.promise
  }

  answer(sessionId: string, attentionId: string, answer: AskUserQuestionAnswer): { answered: true } {
    const item = this.pending.get(attentionId)
    if (item === undefined || item.sessionId !== sessionId || item.signal?.aborted) {
      throw new Error('attention is no longer pending for this Session')
    }
    validateAnswer(item.value.questions, answer)
    item.settle(structuredClone(answer))
    return { answered: true }
  }

  dispose(): void {
    this.disposed = true
    for (const item of [...this.pending.values()]) item.settle(undefined, new Error('control Host disposed'))
    this.listeners.clear()
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

function validateAnswer(questions: readonly AskUserQuestionItem[], answer: AskUserQuestionAnswer): void {
  const expected = new Map(questions.map(question => [question.id, question]))
  if (answer.answers.length !== expected.size) throw new Error('answer every question exactly once')
  for (const item of answer.answers) {
    const question = expected.get(item.id)
    if (question === undefined) throw new Error('answer contains an unknown or repeated question id')
    expected.delete(item.id)
    const labels = new Set(question.options?.map(option => option.label))
    if (new Set(item.selected).size !== item.selected.length || item.selected.some(label => !labels.has(label))) {
      throw new Error('selected answers must be distinct offered option labels')
    }
    if (!question.multiSelect && (item.selected.length > 1 || (item.custom !== undefined && item.selected.length > 0))) {
      throw new Error('a single-select answer accepts one option or custom text')
    }
  }
}
