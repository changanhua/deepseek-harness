# DSH evidence matrix

Read the applicable row while planning a completion claim. The matrix selects the smallest evidence that can falsify the promised behavior; it is not a command checklist or a reason to run every lane.

| Change or claim | Required layers | Preferred evidence | Add this when | Insufficient on its own |
| --- | --- | --- | --- | --- |
| Private pure helper, local algorithm, non-exported type | source-contract | Owning focused Vitest test, edge and negative cases; selected coverage when the source gate applies | It contributes a durable event, config parse, or public contract | Test passing through the same implementation assertion |
| Public API, `Context` merge, `@Remote`, config schema, package export, generated catalog | source-contract, generated-declaration | Owning tests plus exact generator/verifier; build when consumer uses emitted declarations | Host/Client projection, public `lib`, or config catalog changes | Source typecheck or manually viewed generated file |
| Cordis plugin, Bundle row, Profile patch, profile-level Tool/Skill registration | source-contract, composed | REAL Loader/Profile test; named-export negative control; preflighted `dsh --profile <name> --dump-config` where it is the actual selected Profile | Shipped action, HMR, or visible model/tool/UI behavior | Hand-built `ctx.plugin`, package installation, or a source-only unit test |
| Agent/Preset/Session/Remote Tool or Skill visibility, scope, or authority | source-contract, composed, runtime-observed | Loader/Profile proof plus a live observation in the exact Agent/Preset/Session/Remote scope; assert allowed and denied paths | HMR, model-visible schemas, durable grants, or user-visible behavior | A global service lookup, profile config, or an unscoped unit test |
| HMR-safe registration | source-contract, composed, runtime-observed | Dispose owner fiber, assert removal; reload then assert exactly one contribution and no stale listener | Claim covers the shipping live Profile | A test that only sees registration after initial mount |
| Durable Session event/projection or model-visible context | source-contract, composed, runtime-observed, behavior-verified | Event/projection test plus recorded Session snapshot through shipped Profile; inspect restored log/projection | Format/version, SDK projection, or restart claim | A struct/unit test or model output self-report |
| Queue WorkKind, reservation, cancel/retry, recovery | source-contract, composed, runtime-observed, behavior-verified | Typed admission and Handler tests; real persistence/restart scenario; externally check result and no duplicate side effect | Cross-process worker, resource limits, human approval | FIFO ordering test, in-memory queue, or only final status field |
| Agent/Tool/Workflow/Goal semantic behavior | source-contract, composed, behavior-verified | Real composition with external state assertion; keyless Session snapshot for transcript/model-visible behavior | Persistence, recovery, with-key Provider behavior | Agent says “done”, or an assertion only on its reply text |
| Host/Client Remote, dynamic Client extension, Web bundle | source-contract, generated-declaration, composed, behavior-verified | Fresh complete `pnpm run build`; generated declaration verifier; built Host/Client consumer or browser test | GUI copy/layout, live server, dynamic bundle path | `build:web` alone, source Vite test, or stale `lib` import |
| Product-visible GUI | source-contract, composed, behavior-verified | Built server plus browser assertion; affected locale evidence for copy; real model flow and GIF for a GUI PR | HMR, persisted view, browser-specific behavior | Component rendering only, fixture GIF when real flow is promised |
| Provider model mapping, reasoning, usage, error policy | source-contract, composed, behavior-verified | Mock/contract tests plus a credentialed model-specific real request; record non-secret model/config and outcome | Cost/usage accounting, streamed cancellation, multi-provider routing | A configuration file, test mock, or generic provider health check |
| Process, worker, `bin`, SDK runtime or ACP behavior | source-contract, generated-declaration when applicable, composed, behavior-verified | Complete build then run built entry through `dsh`/published launcher; assert protocol/output externally | Restart, cancellation, platform behavior | tsx source run, direct import, or package-local executable shortcut |
| Restart, lease, recovery, migration, persistent state | source-contract, composed, runtime-observed, behavior-verified | Exact injected failure point; stop/restart real owner; re-read durable state and assert idempotency | Cross-version format or platform-specific storage | In-memory test, clean happy path, or a raw data-file inspection alone |
| DSH self-hosting: controller/executor changes DSH, or a runtime/verification Skill changes itself | source-contract, composed, runtime-observed when live state is claimed, behavior-verified | Before subject startup, freeze a controller-owned immutable Verifier plan outside the subject worktree; record its identity and digests for assertions, commands, checker/parser, fixtures, golden/expected artifacts, and allowed environment inputs. A known-good/previously approved verifier reads subject artifacts under that snapshot and independently checks a protocol/browser/external-provider result | The changed surface governs launch, verification, or runtime authority | Subject unit tests, subject-written reports, `git diff`, or subject workspace artifacts alone; shared `DSH_HOME`/port state; or a success report emitted only by the changed Skill |

## Common command families

Choose exact owners rather than copying this list into every change.

```powershell
# Focused source behavior; name owning tests and affected source scope.
pnpm exec vitest run <owning-tests> --coverage --coverage.include='<affected-source-glob>'

# Current generated declarations/catalogs/config after applicable source change.
pnpm run verify-cordis-api
pnpm run verify-cordis-catalog
pnpm run verify-client-catalog

# Built artifacts and Host/Client aggregate when the claim consumes them.
pnpm run build

# Assembled recorded-session behavior.
pnpm run test:snapshot

# Real provider behavior when credentials are available; each suite self-skips without its key.
pnpm run test:e2e

# Browser behavior; this lane builds first.
pnpm run test:web

# Inspect the layered configuration only after reading the exact launcher, `DSH_HOME`, and existing Profile. `pnpm dsh` is source-checkout evidence, not installed-runtime evidence.
pnpm dsh --profile <profile> --dump-config
```

Do not present the command family as a universal baseline. Tie every command to one matrix row and one observable claim.

## Failure classification

| Highest passing layer | Next failing/missing layer | Report as |
| --- | --- | --- |
| source-contract | generated-declaration | Source behavior proven; generated seam unverified or broken |
| generated-declaration | composed | Contract/artifact proven; selected Profile composition unverified or broken |
| composed | runtime-observed | Startup composition proven; live lifecycle/state claim unverified or broken |
| runtime-observed | behavior-verified | Runtime state proven; shipped entry/user-visible behavior unverified or broken |
| behavior-verified | later environment condition | Observed scenario passes; scope the result to tree, configuration, environment, and time |

For unavailable credentials, browser, or permission to restart, report `not run` and the missing prerequisite. Never transform that into `not applicable`.

## Self-hosting identity preflight


Before a DSH process evaluates DSH, write down controller, executor, subject checkout/build/runtime, and verifier identities. Before the subject starts, the controller freezes a Verifier plan outside the subject worktree and records its immutable identity plus digests for assertions, commands, checker/parser, input fixtures, golden/expected artifacts, and allowed environment inputs. The verifier should be a known-good or previously approved installation/check-out, use a distinct Profile home and ports from the subject, and execute that plan read-only against subject artifacts. Subject tests, subject-written reports, Git diff, and workspace artifacts are candidate evidence only; none is independent world evidence alone. The final assertion must use the plan to independently check a protocol/browser/external-provider result rather than only reading a changed verifier's report. If this separation is unavailable, retain lower-layer evidence but mark independent behavior acceptance `not run`.
