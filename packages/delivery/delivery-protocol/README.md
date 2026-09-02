# @deepseek-ai/dsh-delivery-protocol

English | [中文](README.zh.md)

Queue-independent durable records, strict runtime schemas, and canonical identities for [Personal Delivery](../../../docs/subsystems/delivery.md). This package freezes the data shared by Delivery persistence, Git workspace ownership, evidence storage, Queue bridges, verification, GitHub publication, and UI projection. It does not register a Queue `WorkKind`, publish an executor service, persist workflow status, or perform I/O.

## Public contract

The package root exports TypeScript declarations and strict Zod schemas for:

- `DeliveryCase`, `RequirementDecision`, `RequirementOrigin`, `IssuePublication`, canonical GitHub Issue URL helpers, `ContractRevision`, and derived `contractReadiness()`;
- `GitHubIssueRef`, `PublicationFailure`, and the `IssuePublication` phase discriminants;
- `VerificationCheck`, `VerificationPlan`, and `WorkPacket`;
- `VerificationPlanDocument`, `parseVerificationPlanDocument()`, and `resolveVerificationPlan()`;
- `DispatchBinding`, `CompletionClaim`, and `ResumeCapsuleContent`;
- `EvidenceRef`, `VerificationVerdict`, and `AcceptanceDecision`;
- `CodeChangeIntent`, `ResolvedCodeChange`, and `CodeChangeOutput`;
- `CodeVerifyIntent`, `ResolvedCodeVerify`, and `CodeVerifyOutput`.

The two Queue kind names are frozen as `CODE_CHANGE_KIND` (`code.change@1`) and `CODE_VERIFY_KIND` (`code.verify@1`). This package deliberately exports no Queue declaration-merging augmentation and no Prepared or live executor type. The Delivery/Queue bridge owns those runtime concerns.

Every durable object has `schemaVersion: 2`; schemas reject unknown properties and do not apply defaults. Opaque ids must be non-blank. Timestamps must be RFC 3339 UTC instants ending in `Z`. Git commit and blob ids must be complete lowercase 40-hex SHA-1 or 64-hex SHA-256 object ids. Content digests use lowercase `sha256:<64 hex>` form.

A `github-import` requirement origin binds its repository owner/name and positive safe-integer Issue number to a canonical `https://github.com/{owner}/{repository}/issues/{issueNumber}` URL. The schema rejects credentials, ports, alternate hosts or protocols, queries, fragments, trailing slashes, encoded coordinates, and coordinate mismatches. `canonicalGitHubIssueUrl()`, `parseCanonicalGitHubIssueUrl()`, and the owner/name predicates expose the same grammar to importer and publisher adapters instead of requiring another URL parser. A published `GitHubIssueRef` must name the canonical URL for its exact coordinates.

An `IssuePublication` has exactly one of five phases: `prepared`, `publishing`, `published`, `failed`, and `unknown`. A `failed` publication must prove its side effect never started (`not-started`); an `unknown` publication must retain an uncertain side effect (`unknown`). The schema enforces the phase-consistent `issue` and `failure` shapes, so no later consumer can confuse a proved non-creation with an uncertain outcome.

`contractReadiness()` requires an outcome, configured repository, non-empty scope, acceptance clauses, a base-selection rule, a verification source, and no open decision. It is a derived projection, never a writable Contract status.

```text
import {
  contractReadiness,
  contractRevisionSchema,
  workPacketSchema,
} from '@deepseek-ai/dsh-delivery-protocol'

const contract = contractRevisionSchema.parse(decodedContract)
if (!contractReadiness(contract).ready) throw new Error('Contract is not ready')

const packet = workPacketSchema.parse(decodedPacket)
```

## Canonical identities

`canonicalJson()` accepts only plain JSON-safe values. It sorts object keys recursively and rejects cycles, sparse arrays, accessors, hidden or symbol keys, non-finite numbers, class instances, and unsupported primitives. Its algorithm intentionally remains byte-for-byte compatible with Queue canonical JSON; a parity test guards that duplicated, runtime-independent implementation.

The package also exports:

- `canonicalDigest()` for canonical JSON;
- `githubIssueContentDigest()` over an imported Issue title/body snapshot;
- `verificationCheckDigest()` for command identity;
- `verificationPlanDigest()` over resolved checks and provenance;
- `workPacketDigest()` over semantic Packet content, excluding generated id, digest, and creation time;
- `evidenceBytesDigest()` and `evidenceBytesMatch()` for immutable evidence bytes.

`verificationPlanSchema` and `workPacketSchema` verify their self-contained digests during parsing. Consumers must compute these values with the exported functions instead of maintaining another canonicalizer.

## Paths and fixed commands

`RepositoryRelativePath()` rejects absolute paths, Windows drive paths, backslashes, NULs, empty segments, `.` segments, and `..` traversal. `repositoryPathMatchesRule()` makes `exact` match only one path and makes `subtree` include both its root and every slash-delimited descendant. `changedPathBoundaryFindings()` treats an empty allowlist as unrestricted, evaluates forbidden rules first, and emits one finding per distinct changed path. A Packet must contain at least one allowed or forbidden rule, so it cannot silently discard its path boundary.

A verification check may use `.` or a normalized repository-relative path as its explicit working directory. Every command is a non-empty argv with a positive timeout, declared severity, and a non-empty unique expected-exit-code set. There is no shell-string field, and the schema also rejects command-string modes such as `sh -c`, `bash -lc`, `pwsh -Command`, and `cmd /C`, including an `env` wrapper.

Lexical path validation is not physical containment. Before spawning a check, the verifier must use `lstat`/`realpath` to prove that the resolved physical cwd remains inside the active lease root and must reject any symlink traversal that escapes it.

`parseVerificationPlanDocument()` is the one executable parser for a Contract-owned Git blob. It rejects a UTF-8 BOM, malformed UTF-8 or JSON, unknown document fields, the wrong format, an empty check set, and duplicate check ids. `resolveVerificationPlan()` then constructs the strict plan and canonical digest for either provenance kind. Providers and edge adapters reuse these functions instead of copying the test fake's behavior.

Resolved Git-blob plan provenance pins the base commit, repository-relative path, and full blob id. Contract-field provenance pins the exact Contract revision and field. Packet and resolved verification schemas additionally require those provenance coordinates to match their own base commit or Contract revision. A Packet carries the resolved checks, their provenance, and their digest, so branch content cannot silently change what verification executes.

## Local and cross-object semantics

One strict record schema enforces every fact visible inside that record. For example, a `completed` claim requires a checkpoint commit and at least one evidence id; the other dispositions require their blocker, question, or scope delta. Every verification check result names evidence, and the Verdict manifest has exactly one integrity finding for every referenced id. A locally `passed` verdict additionally requires descendant ancestry, expected required checks, no path findings, intact required evidence findings, and no pending review reason.

Relationships that require another authoritative object remain explicit functions rather than hidden Zod lookups:

- `completionClaimEvidenceFindings()` checks that a completed claim names matching Git evidence from its producing Queue Work and Attempt;
- `changedPathBoundaryFindings()` derives forbidden and outside-allowlist findings with the frozen Packet path semantics;
- `verificationVerdictPlanFindings()` binds every result to the exact trusted check and plan digest;
- `acceptanceDecisionFindings()` checks verdict, Packet, target commit, and the rule that only a matching passed verdict may be accepted.

These functions return findings. The owning service decides whether to reject a write, project operator attention, or request human review; the protocol package does not invent lifecycle state.

## Golden fixtures

[`fixtures/valid.json`](fixtures/valid.json) is the stable V2 catalog for every durable record, the strict verification-plan document, and both WorkKind DTO families. Its `fixtureIds` map gives each reusable value a stable dotted id, such as `case.primary`, `contract.ready`, `decision.requirement-approved`, `publication.published`, `claim.completed`, and `work-kind.verify-output`. [`fixtures/invalid.json`](fixtures/invalid.json) contains stable case ids plus JSON-Patch-like mutations against that catalog. Tests prove that every valid value survives a JSON round trip and every invalid mutation is rejected. Consumers should cite fixture case ids when they depend on a protocol shape.

The fixture catalog contains fake repository, Queue, evidence, and human ids only. It carries no Session, process handle, host object, secret, or mutable host path.

## Model Experience

### Durable value contract

#### What the model sees

Nothing. `@deepseek-ai/dsh-delivery-protocol` contributes no prompt, tool, command, or model-visible diagnostic. A later authorized consumer may present a projection of these records.

#### Token effect

None. Parsing, canonicalization, and semantic checks run outside model context.

#### KV Cache effect

None. This package does not modify any model-visible prefix.

## Known Limitations and Deferred Work

- **MVP GitHub publication only** — the protocol models requirement origins for human authors and `github-import`; webhook synchronization and write-back are outside the MVP.
- **MVP work kinds only** — the protocol names `code.change@1` and `code.verify@1`, but their Queue registration and execution lifecycles belong to the bridge packages.
- **No byte access in schemas** — `EvidenceRef` validates metadata; the evidence provider must retrieve immutable bytes and call `evidenceBytesMatch()` before evidence can satisfy verification.
- **No cross-store lookup in schemas** — ancestry, repository identity, Queue existence, and human authority require their owning services. The exported cross-object findings cover only relationships whose complete inputs the caller supplies.
- **No migration compatibility** — V2 schemas reject every other `schemaVersion`; a future version needs an explicit migration and new golden fixtures rather than permissive parsing.