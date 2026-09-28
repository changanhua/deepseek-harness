# Downstream feature placement policy

English | [中文](feature-placement.zh.md)

## Summary

Place every personal change at the first layer that can own its real lifecycle, authority, facts, and failure semantics. Reuse official behavior before adding configuration, plugins, personal packages, bundles, adapters, general upstream seams, or private core patches. This policy prevents convenience changes from turning into permanent fork-wide coupling.

## Table of Contents

- [Mandatory placement order](#mandatory-placement-order)
- [Layer tests](#layer-tests)
- [Fact and authority rules](#fact-and-authority-rules)
- [Current personal increment matrix](#current-personal-increment-matrix)
- [Admission record](#admission-record)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

<a id="mandatory-placement-order"></a>

## Mandatory placement order

Evaluate one feature in this order and stop at the first layer that satisfies the complete need:

```text
official capability（官版能力） → configuration/Profile（配置/Profile） → Plugin/Slot → @changanhua package（@changanhua 包） → Bundle → Compatibility Adapter → general upstream seam（通用上游 seam） → private core patch（私人 core patch）
```

Code size is not the deciding factor. Compare the user outcome, input and result, authority, lifecycle, side effects, fact ownership, composition, recovery, and verification. A wrapper is not an adapter when it must recreate persistence, retries, authorization, cleanup, or a domain state machine.

<a id="layer-tests"></a>

## Layer tests

| Layer | Use it when | It must not become |
|---|---|---|
| Official capability | Existing source and a composed provider already own the required semantics. Add only caller or Profile selection. | A copied implementation or personal alias with no behavioral difference. |
| Configuration/Profile | The behavior exists and only a value, provider choice, scope, or ordered composition changes. | Hidden code, durable facts, or a second policy engine encoded as data. |
| Plugin/Slot | A documented event, service, tool registry, command, Remote, or browser slot can contribute and dispose the behavior. | A patch to its host merely because contribution order is inconvenient. |
| `@changanhua` package | A personal product domain, provider, Consumer, or UI occupant has independent ownership and tests. | A generic `common` package combining unrelated lifecycle and facts. |
| Bundle | Existing plugins need one installable, ordered deployment selection. | A scheduler, store, executor, verifier, parser, or domain decision owner. |
| Compatibility adapter | Two existing interfaces need bounded field, framing, or protocol translation while their domains stay independent. | An owner of business facts, authority, retries, persistence, or acceptance. |
| General upstream seam | No documented extension point can express behavior that is useful beyond the personal product. Keep the change minimal and independently testable. | Personal naming, policy, data model, UI workflow, or a permanent downstream-only switch in shared core. |
| Private core patch | Every lower layer fails a named non-negotiable semantic and the remaining edit is inherently fork policy or shared-core behavior. | An unregistered convenience edit without budget, evidence, expiry, and exit route. |

<a id="fact-and-authority-rules"></a>

## Fact and authority rules

One domain fact has one owner. Queue continues to own Work, Attempt, result, lease, and retry lifecycle; Delivery owns Cases, Contract revisions, dispatch bindings, and human acceptance; repository workspace owns verified Git state; evidence storage owns immutable evidence bytes. A bridge or UI may reference those records but cannot copy them into a competing state machine.

A Bundle selects providers and Consumers but owns no runtime fact. A compatibility adapter declares `factOwnershipEffect: "none"`. A browser projection is read-only unless a separately authorized command or Remote owns the mutation. A capability visible to a person does not automatically enter an Agent's tool schema, discovery scope, or modification authority; each Consumer must register and scope those surfaces explicitly.

Package provenance and core-patch governance remain separate. `downstream/package-identities.json` alone classifies personal npm packages and publication policy. `core-patches.json` alone inventories retained edits to upstream-owned code. The matrix below explains their current product role and does not create a third registry.

<a id="current-personal-increment-matrix"></a>

## Current personal increment matrix

| Capability or asset | Primary classification | Current placement and fact owner | Removal or upstream route |
|---|---|---|---|
| Session, Agent, tools, Profiles, Cordis composition | Official native | Reused from `@deepseek-ai/*`; the owning official services and event log retain facts. | Follow official updates; do not fork equivalent personal services. |
| Queue (`packages/task-queue/*`, `ui-task-queue`) | Personal product + independent plugins | `@changanhua` Service Definition, providers, Consumers, command, Remote, and UI; `ctx.taskQueue` owns Work and Attempt facts. | Delete personal adapters when an official Queue has equivalent durability, authority, idempotency, and recovery; contribute general fixes separately. |
| Personal Delivery (`packages/delivery/*`) | Personal product + independent plugins | `ctx.delivery`, evidence, repository workspace, runner, verifier, GitHub, Queue bridge, Remote, and UI remain separate owners; Delivery never copies Queue lifecycle or evidence bytes. | Keep product semantics personal; upstream only generally useful seams or reliability fixes. |
| Runtime Facts (`runtime-facts*`, `tool-runtime-inspect`) | Personal product + independent plugins | `ctx.runtimeFacts` owns scoped secret-free declarations; Host and tool packages are projections or Consumers. | Remove compatibility rows when official scoped fact registration and projection are equivalent. |
| Capability and Skills views | Personal product + independent UI plugins | Host gateway reads live Skills, Tools, and MCP registries; UI packages occupy slots and expose no hidden mutation path. | Replace with official read-only projection and slots when scope and secret redaction match. |
| Personal UI modules and workbench views | Independent `@changanhua` plugins | Queue, Delivery, Capability, Architecture, and Observatory packages occupy `shell.view`, sidebar, and settings slots; domain services retain authoritative state. | Delete upstream-owned layout patches when official slots preserve conversation lifecycle and navigation. |
| `personal-delivery` | Bundle | Static patch carrier selecting Delivery, evidence, Git workspace, Queue bridge, Remote, and UI providers. | Remove when Profile or an official downstream overlay composes the same rows without editing official bundles. |
| Parent-free Codex execution | Compatibility adapter | The patch extends the existing Codex provider with explicit cwd, cancellation, and quiescence; it owns no Delivery or Queue facts. | Remove when the official provider exposes equivalent invocation semantics. |
| Web provider and settings integration | Compatibility adapter | Existing Web providers consume settings, credentials, and runtime facts without a provider-specific policy store. | Remove after official providers consume the same contracts. |
| Windows-first fork CI and repository trust policy | Unavoidable core patch | Fork-owned workflows control repository permissions and make hosted Windows blocking while Linux stays advisory. No runtime product state is created. | Delete when official workflows expose a repository-safe downstream mode with equivalent Windows routing. |
| Client module ring and upstream package composition edits | Unavoidable core patch, removable | Narrow edits to official layout, sidebar, base, headless, and Web bundles expose or select personal plugins. | Replace with an official general slot or downstream overlay; never move UI/domain facts into the patch. |
| Process, cancellation, and authority hardening | Upstream-contributable | Registered `upstream-candidate` patches stay in shared packages only while the personal product needs the fix. | Contribute minimal general fixes and delete the private delta after equivalent official tests pass. |
| Repository documentation and downstream governance gates | Unavoidable core patch, removable | Root instructions, workflow tests, patch checks, and bilingual policy remain repository control rather than runtime services. | Remove local differences when official governance supports the same downstream ownership and review semantics. |

<a id="admission-record"></a>

## Admission record

Every non-trivial feature change records the need, candidates inspected, selected layer, rejected lower layers, fact owner, authority boundary, state and side effects, tests, rollback, and removal or upstream condition in its Feature Charter, Agent Note, or existing owner document. A private core patch additionally updates `core-patches.json` and must remain inside its count and risk budgets.

Do not create a new durable placement database. The record explains one decision; package identity, Git baseline, core-patch inventory, and domain records stay with their existing machine owners.

<a id="further-exploration"></a>

## Further Exploration

- [Upstream synchronization SOP](upstream-sync.md)
- [Downstream core patch registry](core-patch-registry.md)
- [Capability seams](../capability-seams.md)
- [Package groups](../../packages/README.md)

## Dev Note

This matrix covers the personal increments relevant to current fork maintenance. `downstream/package-identities.json` remains the exhaustive package list.
