---
description: "Shared pre-Planning Candidate intake without execution authority."
kind: "package-group"
---

# packages/initiative

English | [中文](README.zh.md)

## Summary

Human commands and scoped Agent tools create the same durable Candidate. Initiative owns immutable origin, revisions, investigation facts and promotion relations. It does not investigate, score investments, run Agents or dispatch work. See the [Initiative subsystem](../../docs/subsystems/initiative.md).

## Packages

- [initiative](initiative/README.md): service definition, strict schemas and branded Candidate identities.
- [initiative-local](initiative-local/README.md): single-Host Storage Domain provider, trusted identities and pending-only Planning promotion.
- [command-initiative](command-initiative/README.md): direct Human command, including disposition and promotion.
- [tool-initiative](tool-initiative/README.md): Agent propose, investigate and read tools, with no settlement authority.

## Tutorial: opt-in Web composition

Prerequisites: a built source checkout, the existing Web/base services, and a registered Workspace selected in the Web UI. This is a local single-operator feature; set `operatorId` in a copied patch if the Host needs another stable human label. The label does not authenticate a remote account. All Hosts using the same Candidate storage must use the same ownership directory.

```sh
pnpm run build
pnpm dsh web --patch "$PWD/packages/bundle/personal-planning/cordis.patch.yml" --patch "$PWD/packages/bundle/personal-planning/initiative.patch.yml"
```

The overlay is optional and adds two scoped model tools and `/initiative`. It does not change shipped defaults. Human composer commands other than assess do not invoke a model; assess uses the configured RIR provider and model. Compose the investment-review overlay and its owner/review provider when assessment is required.

```text
/initiative {"action":"propose","key":"audit-delta-1","kind":"simplify","trigger":"The pinned audit ages","facts":{"claim":"Investigate a lighter current-state delta"}}
/initiative {"action":"read"}
```

Copy the returned `id`, `recordVersion` and `headVersion` into the next command. The following placeholders must be replaced with those exact values:

```text
/initiative {"action":"investigate","key":"audit-probe-1","id":"CANDIDATE_ID","expectedRecordVersion":1,"expectedVersion":1,"facts":{"claim":"Compare a current-state delta with the existing snapshot audit","uncertainties":["Does repeated maintenance justify new code?"],"evidenceRefs":[{"owner":"repository","kind":"document","id":"docs/audits/2026-10-01-dsh-system-gap-audit.zh.md","verification":"unverified"}],"counterEvidenceRefs":[{"owner":"repository","kind":"document","id":"docs/audits/2026-10-01-dsh-system-gap-audit.zh.md","verification":"unverified","excerpt":"The audit explicitly describes a snapshot."}]},"completion":"complete"}
/initiative {"action":"read","id":"CANDIDATE_ID","version":2}
/initiative {"action":"promote","key":"audit-human-promotion-1","id":"CANDIDATE_ID","expectedRecordVersion":2,"expectedVersion":2,"rationale":"I want to review this exact hypothesis as a pending Planning Proposal"}
```

Read the returned Proposal in Planning. It remains pending until a separate Planning decision. The Board aggregate CAS version increases; canonical items/revisions, lanes and Delivery handoffs do not change. On a failed or interrupted promotion, repeat the identical command and key. A prepared promotion freezes the Candidate against edits until that operation recovers. A definite Planning CAS conflict records a new frozen attempt and asks for the same-key retry.

To defer/drop, use `action: disposition`, the exact Candidate versions, `status: DEFERRED` or `DROPPED`, a new key and a rationale. Reopen a deferred Candidate with `status: INVESTIGATING`. Agent tools can recommend those outcomes but cannot settle them. Agents may call `initiative_record` in a live turn when they observe useful work; no background trigger is installed. Their available tools, credentials and budget remain unchanged.

## Verification boundaries

Loader/Commands/Tools integration tests exercise durable owners and restart recovery. Optional Human assess uses `{action:"assess",key,id,version}` for an exact immutable revision; promote accepts optional assessmentId and freezes its validated complete baseline. Same-key replays do not evaluate again. Assessment routes remain advisory. RIR availability is unavailable when its owner is absent or closed. Source locators and excerpts remain unverified/unknown/unavailable; supplied digests do not certify evidence. Never place credentials, secrets or raw provider payloads in a Candidate. The real-provider acceptance fixture retains requests, Tool events and independent owner reads; its keyless variant proves composition only.
