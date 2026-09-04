# Runtime Composition Triage Map

Use the earliest relevant row first. Keep observations tied to the same **subject** checkout, build, Profile/home/ports, process, and scope; mixing a source worktree with an unrelated running service is itself an `unverified` condition.

## Self-hosted identity boundary

| Identity | Record before tracing | Do not substitute |
| --- | --- | --- |
| Diagnostic DSH | checkout/build, Profile/home/ports, process, Agent authority | its source/build/runtime for the subject's evidence |
| Controller/executor DSH | Profile/home/ports, process, work authority, if it launched or changed the target | orchestration success for target behavior |
| Subject DSH | checkout/tree, built artifact, Profile/home/ports, target process and scope | another running DSH with a similar package name |
| Independent verifier | known-good or previously approved checkout/Profile/toolchain, where final proof is needed | the changed runtime/debug/verification Skill's self-report |

Give diagnostic, subject, and verifier distinct homes and non-overlapping ports when more than one is started. If target identity cannot be established safely, stop at `unverified`; do not run a dump/status against whichever DSH happens to answer.

| Layer | Read-only evidence | Proves | First-divergence class | Do not infer |
| --- | --- | --- | --- | --- |
| source-contract | named export/type/config and focused source test | source owns intended contract | `contract-absent` | generated output or runtime composition |
| generated-declaration | generator/verifier output, generated declaration/catalog/manifest identity | artifacts declare this source capability | `generated-stale` | a Profile selects it |
| Profile/Bundle composition | final layered config and manifest inspection; use `dsh --profile <name> --dump-config` only after confirming the exact launcher, existing Profile, and its `DSH_HOME`/data root are safe to inspect | exact Profile selects intended contributor/default | `composition-missing` | Loader successfully activated it |
| Loader activation | startup/status logs and lifecycle/config error evidence from the named Profile | actual process resolved and activated contributor | `activation-failed` | Client artifact or Agent visibility |
| built Host/Client artifacts | build identity, served asset/declaration/dynamic extension identity, process start location | live artifact derives from intended tree | `artifact-stale` | business behavior is correct |
| runtime scope | active Agent/Preset/Session/Remote projection and authority evidence | mounted capability is visible to target caller | `scope-mismatch` | invocation result is correct |
| real behavior | independent result from shipped entry path, Session snapshot, browser, API, or provider record | user-visible contract holds or fails | `behavior-defect` | any unobserved lower layer |

## Safe observation sequence

1. Identify diagnostic, controller/executor, and subject DSH identities; inspect the subject Git tree/dirty state and capture its actual launch/Profile/home/ports.
2. Read source and its immediate generated seam.
3. Inspect final Profile/Bundle config rather than a package-local example. Before a config dump, confirm the exact launcher, that the Profile exists, and the `DSH_HOME`/data root it will read. If any is unknown, statically inspect Bundle/manifest/config layers instead; run a dump only after authorization with an isolated home.
4. Read logs/status of the existing process; do not stop or relaunch it without authorization.
5. Compare served/built artifacts with the inspected tree. A `build:web` result is insufficient evidence for dynamic Client bundle freshness after Host/Client changes.
6. Inspect target Agent/Preset/Session scope and authority.
7. Exercise real behavior only when it is already safe and authorized; real Provider calls may consume credentials/cost.

## Common false shortcuts

- "The TypeScript test passed" skips every layer after source-contract.
- "The package is present" skips composition and activation.
- "The config file mentions it" skips layered Profile resolution and Loader errors.
- "The browser refreshed" does not prove dynamic Client bundles were rebuilt.
- "The Host sees it" does not prove a particular Agent/Preset/Session can invoke it.
- "A second process works" does not explain the first process's data root, profile, artifact, or scope.
- "The diagnostic Agent can see it" says nothing about the subject unless their exact runtime identity is proven; for a changed diagnostic/verification Skill it still cannot be sole acceptance.