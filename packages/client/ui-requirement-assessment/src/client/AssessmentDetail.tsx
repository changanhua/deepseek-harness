import type { AssessmentView } from './face.ts'
import type { RirKey } from './locales.ts'
const lines = (values: readonly string[]) => <ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul>
/** Render the recorded judgment and its captured input, never today's subject as historical input. */
export function AssessmentDetail({ view, t }: { view: AssessmentView; t: (key: RirKey) => string }) {
  const a = view.assessment
  return <article>
    <h3>{a.subject.kind === 'manual' ? a.subject.title : a.subject.id}</h3>
    <p>{t('route')}: <strong>{a.evaluation.route}</strong> · {t(view.drift)}</p>
    <p>{a.evaluation.routeRationale}</p>
    <p>{t('baseline')}: {a.baseline.planRevision ?? a.baseline.workspace} {a.baseline.focusVersion ?? ''}</p>
    <p>{t('created')}: {a.createdAt} · {t('model')}: {a.baseline.evaluator.provider}/{a.baseline.evaluator.model}</p>
    {a.supersedes && <p>{t('supersedes')}: {a.supersedes}</p>}
    <h4>{t('allocation')}</h4>
    {(['SYSTEM_OWNED', 'MODEL_OWNED', 'EXPERIMENT'] as const).map(key => <section key={key}>
      <h5>{t(key)}</h5>
      <ul>{a.evaluation.allocation[key].map((item, index) => <li key={index}><strong>{item.component}</strong>: {item.rationale}</li>)}</ul>
    </section>)}
    <details><summary>{t('dimensions')}</summary>{a.evaluation.dimensions.map(d => <section key={d.dimension}>
      <h4>{t(`dimension.${d.dimension}`)}</h4><p>{t('level')}: {d.level} · {t('confidence')}: {d.confidence}</p><p>{d.claim}</p>
      <h5>{t('grounds')}</h5>{lines(d.grounds)}<h5>{t('counterArguments')}</h5>{lines(d.counterArguments)}<h5>{t('unknowns')}</h5>{lines(d.unknowns)}
    </section>)}</details>
    <details><summary>{t('stress')}</summary>{a.evaluation.stressTests.map(s => <section key={s.kind}>
      <h4>{t(`stress.${s.kind}`)}</h4>
      {s.kind === 'model_x2' && <><h5>{t('declines')}</h5>{lines(s.declines)}<h5>{t('remains')}</h5>{lines(s.remains)}<h5>{t('increases')}</h5>{lines(s.increases)}<h5>{t('durableCore')}</h5><p>{s.durableCore}</p></>}
      {s.kind === 'upstream_substitution' && <><h5>{t('deletable')}</h5>{lines(s.deletable)}<h5>{t('retained')}</h5>{lines(s.retained)}<h5>{t('avoidOverbuilding')}</h5><p>{s.avoidOverbuilding}</p></>}
      {s.kind === 'no_build' && <><h5>{t('workaround')}</h5><p>{s.workaround}</p><h5>{t('actualLoss')}</h5><p>{s.actualLoss}</p><h5>{t('investmentEvidence')}</h5><p>{s.investmentEvidence}</p><h5>{t('smallestExperiment')}</h5><p>{s.smallestExperiment}</p></>}
    </section>)}</details>
    <h4>{t('uncertainties')}</h4><ul>{a.evaluation.uncertainties.map((u, i) => <li key={i}>{u.question} — {u.consequence} — {u.nextEvidence}</li>)}</ul>
    <details><summary>{t('input')}</summary><pre>{JSON.stringify(a.actualInput, null, 2)}</pre></details>
    <details><summary>{t('baseline')}</summary><pre>{JSON.stringify(a.baseline, null, 2)}</pre></details>
    <details><summary>{t('raw')}</summary><pre>{a.rawOutput}</pre></details>
  </article>
}
