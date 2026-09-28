import type { DeliveryEvidenceView } from '@changanhua/dsh-delivery-remote'
import type { PlanningExecutionView } from '@changanhua/dsh-planning-remote/types'
import type { PlanningKey } from './locales.ts'

function textContent(evidence: DeliveryEvidenceView): string | undefined {
  if (!/^(text\/|application\/json$)/u.test(evidence.mediaType)) return undefined
  try {
    const bytes = Uint8Array.from(atob(evidence.contentBase64), value => value.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

/** Display Delivery facts and only Host-authorized packet evidence as inert text. */
export function PlanningExecution(props: {
  view: PlanningExecutionView
  revisionId: string
  evidence: DeliveryEvidenceView | undefined
  evidenceError: string | null
  evidencePending: boolean
  onReadEvidence: (id: string) => void
  t: (key: PlanningKey) => string
}) {
  if (props.view.handoffs.length === 0) return null
  const { t } = props
  return (
    <section aria-label={t('execution.title')}>
      <h3>{t('execution.title')}</h3>
      {props.view.handoffs.map(({ handoff, case: card }) => (
        <article key={handoff.key}>
          <strong>{t(handoff.phase === 'prepared' ? 'execution.prepared' : 'execution.linked')}</strong>
          {handoff.revisionId !== props.revisionId && <p>{t('execution.older')}</p>}
          {card === null ? (
            <p>{t('execution.missing')}</p>
          ) : (
            <>
              <p>
                {card.headRevision.title} · {t(`execution.${card.lane}`)}
              </p>
              {card.readiness.reasons.length > 0 && (
                <ul>
                  {card.readiness.reasons.map(reason => (
                    <li key={reason}>{t(`execution.${reason}`)}</li>
                  ))}
                </ul>
              )}
              {card.packets.map(packet => (
                <div key={packet.packet.id}>
                  <p>
                    {t('execution.verify')}: {packet.verificationVerdict?.status ?? t('execution.pending')}
                  </p>
                  <p>
                    {t('execution.accept')}: {packet.acceptanceDecision?.decision ?? t('execution.pending')}
                  </p>
                  {[
                    ...new Set([
                      ...(packet.completionClaim?.evidenceIds ?? []),
                      ...(packet.verificationVerdict?.evidenceIds ?? []),
                    ]),
                  ].map(id => (
                    <button
                      key={id}
                      type="button"
                      disabled={props.evidencePending}
                      onClick={() => {
                        props.onReadEvidence(String(id))
                      }}
                    >
                      {String(id)}
                    </button>
                  ))}
                </div>
              ))}
              <p>{t('execution.continue')}</p>
            </>
          )}
        </article>
      ))}
      {props.evidenceError !== null && <p role="alert">{props.evidenceError}</p>}
      {props.evidence !== undefined && <Evidence evidence={props.evidence} />}
    </section>
  )
}

function Evidence({ evidence }: { evidence: DeliveryEvidenceView }) {
  const text = textContent(evidence)
  return (
    <section>
      <p>{evidence.digest}</p>
      <pre>{JSON.stringify(evidence.provenance)}</pre>
      {text !== undefined && <pre>{text}</pre>}
    </section>
  )
}
