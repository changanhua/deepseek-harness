# Initiative v0 implementation record

Baseline: master a977e66735f6074220979d408aed918270cca269. Specification: PR #82 at 0f3f50e94f5de1ca928bea12654102d5ea88c8ae. Branch: dot/initiative-loop-v0.

## Section 17: before implementation

1. Planning.execute with kind=propose creates a pending Proposal without changing canonical items or Plan revisions. It increments the aggregate Board CAS version. See packages/planning/planning-local/src/store.ts, propose branch. No new Planning API is needed.
2. RIR has a specification but no provider in this baseline. Candidate core and Human promotion without an Assessment can ship independently. Real RIR assessment and drift integration remain blocked.
3. Human authority comes from the Commands-owned unfinished command/run event: source=user, exact commandId and args, Session id and event sequence. No model-provided actor is trusted.
4. Tools pass the exact initiating Agent. The provider checks live Agent, Session, registered Workspace and current turn, and derives Agent/Session identity. Input cannot supply proposer or actor.
5. initiative defines the Candidate contract; initiative-local owns canonical Candidate persistence in Storage Domain initiative_candidates.
6. A single local owner serializes mutations. Record and head versions fence writes. Durable receipts bind request keys to normalized payload digests and actors; changed payloads conflict.
7. The existing opaque ResourceRef is Planning-owned. A minimal Candidate locator avoids a reverse owner dependency. It records owner, identity, optional revision/digest and explicit verification state, never artifact bytes.
8. The provider does not start Agents, call models or execute Tools. Investigations only record facts; existing runtime authority and budget remain unchanged. Registry visibility and absence of downstream mutations are tested.
9. The read projection names the exact Candidate revision and current head drift. RIR availability is explicitly unavailable; no fake Assessment or scorer is provided.
10. Promotion rejects Agent callers and calls only Planning propose with null item/base ids. It never calls accept, canonical mutation, Delivery or Queue.
11. Candidate history and receipts live in one atomic Workspace record. A prepared promotion freezes its exact Candidate revision and Planning request before side effects; recovery replays that request and links the original Proposal. Terminal receipts replay before stale-version checks.
12. Negative tests cover forged Human inputs, direct Agent promotion/disposition, stale scopes, CAS, repeated requests, restart, legal lifecycle, pending-only promotion, and unchanged canonical Planning/Delivery state.

## Verification scope

The opt-in composition requires real Commands and Tools entry integration, Loader activation, durable restart/retry and fault injection around promotion commits. These keyless entry tests are not proof of a spontaneous live-model Case B. That case and real RIR remain unverified until their real dependencies are available. No default profile activation, second runtime, new credential, automatic acceptance or dispatch is included.

## Delivered core and reproducible evidence

The four packages are initiative (Definition), initiative-local (canonical durable provider and narrow Planning bridge), command-initiative (trusted Human entry) and tool-initiative (scoped Agent entry). The opt-in personal-planning/initiative.patch.yml and bilingual package-group tutorial provide startup and copyable Human commands; defaults are unchanged.

The final focused suite contains 14 tests, exercising real Loader, Commands, Tools, JSON Storage Domain and Planning providers. It covers both proposer kinds, immutable origin, old revision reads, evidence/counter-evidence separation, lineage, lifecycle, CAS, identity spoofing and revocation, cancellation, restart/retry, concurrent promotions, definite downstream CAS retry, pre-prepare/Planning/link failures, already-dismissed Proposal recovery, reserved idempotency keys and settlement capacity, detached query DTOs, full single-revision read-size admission, and registration disposal/reload. The model guidance and tool schemas are pinned in an owner-local golden. The provider's 48 KiB complete single-revision view cap keeps accepted views readable through default 64 KiB entry output bounds.

Passed commands on this implementation:

- node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json
- ./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host
- ./node_modules/.bin/tsc -b tsconfig.client.json
- ./node_modules/.bin/vitest run packages/initiative/initiative-local/tests/initiative.spec.ts (14/14)
- node --import tsx scripts/run-oxlint.ts packages/initiative scripts/gen-tool-catalog.ts scripts/gen-cordis-catalog.ts
- git diff --check

The Cordis and Tool catalog generators ran successfully. Persistence catalog generation was unchanged because Candidate facts are not Session event types. Config catalog regeneration remains blocked by six existing missing-JSDoc errors in mcp-gateway; the exact six errors also reproduce on an independently extracted master baseline. Workspace constraints and package invariant gate output are byte-identical to the baseline; no unrelated failures were fixed. Other broad documentation gates report existing unrelated violations; changed Initiative docs are checked separately for new diagnostics.

Native test setup: this cloud Node distribution lacked development headers. Node v24.19.0 headers were downloaded from the official nodejs.org distribution; the repository's unchanged stable Node-API v8 flock source was compiled into its ignored native build output. No native source or security behavior was changed.

## Explicitly unverified acceptance

- RIR owner does not exist on the base; real Assessment creation, selected Assessment promotion and RIR-specific baseline drift are blocked. No scoring substitute or mocked Assessment was added.
- DEEPSEEK_API_KEY is absent. The live-model spontaneous Case B and a provider-recorded Session scenario were not run. The inert-Agent Loader integration and model-contract golden are not substitutes for that evidence.
- No browser GUI flow, full Web/desktop packaging, deployment or remote CI was performed. The feature adds a command entry rather than a dedicated GUI.
- Restart tests dispose/recreate the full owning Context over the same durable storage. Abrupt process SIGKILL recovery was not run; the OS lock and partial-commit fault windows were tested separately.

The independent source review found no remaining major authority or crash-consistency blocker after the read DTO and size-admission corrections. Test results above are the implementation runner's actual results, not an independent rerun.
