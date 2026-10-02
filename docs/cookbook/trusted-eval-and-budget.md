# Configure trusted Eval sources and resource budgets

English | [中文](trusted-eval-and-budget.zh.md)

Use this guide in a checkout that includes the [Eval](../../packages/eval/README.md) and [Budget](../../packages/budget/README.md) packages. Configure a separate Host composition before sending a model request. These packages do not restart or change an already running personal instance.

## 1. Configure the budget owner

The [tested headless overlay](../../packages/budget/budget-local/tests/fixtures/profile/budget.patch.yml) shows Storage Domain routing, private SQLite, the budget owner and the Agent/LLM bridges. Use the appropriate realm of the existing profile: the base storage realm is `web-host`, including headless. Route `resource_budget` to a backend configured with `ownership: exclusive`, `journalMode: delete`, `synchronous: full` and `privateDirectory: true`. Choose explicit ledger bounds.

Mount `command-budget` beside Commands. Before asking the Agent to work, issue a Human command with every limit stated:

```text
/budget {"action":"set","scope":"session","limits":{"requests":4,"inputTokens":100000,"outputTokens":20000,"totalTokens":120000,"wallTimeMs":600000},"onExhausted":"pause"}
/budget {"action":"read","scope":"session"}
```

Use `scope: "goal"` after a Goal and its Session budget exist. A Goal budget inherits the Session budget. For Workflow, configure `budget-workflow.workflows` with an exact workflow name, limits and exhaustion policy. Requests also need a positive output cap in their model configuration. Null Token ceilings inherit without adding a local limit; they do not remove a parent's ceiling.

Scope definitions are immutable. An identical set is idempotent; changed limits require a new authorized scope or Session. `revoke` permanently denies the selected scope. `receipt` reads a request/attempt receipt; `reconcile` additionally requires operator-verified input/output counts and only settles unknown usage. No command silently converts missing usage to zero.

## 2. Review a Plan and Suite

The [example Plan](../../packages/eval/eval-plans-local/examples/minimal-v1.plan.json) references a [versioned Suite](../../packages/eval/eval-plans-local/examples/minimal-v1.suite.json) with ten deterministic cases and two route binding positions. Each route has its own authored Session recording under the [headless corpus](../../snapshots/session/headless.snapshot.ts). Replay proves the harness and deterministic checker path; it does not measure a live model's quality.

Copy or edit the Plan/Suite through normal project files. Keep fixture paths relative and contained. Plan route parameters accept `maxTokens`, `temperature`, `reasoningEffort` and `stop`; credential values, cwd overrides and Queue payloads are not accepted there. Pin a full repository commit. The Suite source revision and selected route identities must match the Plan.

Parse the Suite and compute `evalContractDigest(parsedSuite)`, place that identity in `suiteRef`, then parse and hash the entire Plan. The [example approval value](../../packages/eval/eval-plans-local/examples/minimal-v1.approval.json) illustrates the resulting id/version/digest. Review and copy that value into Host-owned configuration. An approval file in a writable project is not itself authorization.

## 3. Mount the source and inspect preflight

The [tested Plan overlay](../../packages/eval/eval-plans-local/tests/fixtures/profile/plans.patch.yml) shows the complete source shape. Set a trusted absolute `root`, relative `planFile` and `suiteFile`, the approved identity, explicit file/cell bounds, required artifact identities, and a credential mode. `workspaceId: null` selects the registered Workspace at that exact root; a non-null id also pins its registry identity. Route `eval_plan_admissions` to a private synchronous backend.

Keep keyless replay and live calls separate in Host configuration. `mode: live` requires matching configured credential authority, `budget.required: true` with an exact Budget-owner reference, and a positive integer `maxTokens` for every route. The budget ancestor chain must contain a finite resource ceiling and a non-expired deadline; revocation, unknown usage or exhausted ancestors block admission. Only keyless replay may use a Host-pinned budget exemption. Host approval of Plan contents never substitutes for live spending authority.

Mount `command-eval-plan` with an explicit Host-selected `entrypoint` and `maxOutputBytes`. Use the same Plan id/version from discovery:

```text
/eval-plan {"action":"discover"}
/eval-plan {"action":"preflight","id":"trusted-plan-example","version":"1"}
/eval-plan {"action":"admit","id":"trusted-plan-example","version":"1","requestId":"reviewed-run-1"}
```

Preflight reports source identity, Workspace policy, entrypoint permission, Provider/model and Preset availability, required Tool/Skill identities, credentials and budget status. Preset digests hash composition text after CRLF-to-LF normalization. Tool identities cover their registered contract; Skill identities include provider/source and instruction content. Missing owners, content drift, unavailable grants and exhausted budgets block admission. Fix the named owner or update the reviewed Host pin, then resolve again.

Admission rechecks the owner-issued resolution and retains one run identity for an identical request. It starts no Queue work or model request. Reload publishes a complete source generation; stale resolution objects and caller-created JSON cannot be admitted. Executor, verifier, GateDecision and automatic Activation remain separate responsibilities.
