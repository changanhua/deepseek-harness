# Personal Delivery example

Narrative outside the marked YAML fence is supporting context only.

<!-- dsh-delivery-work-brief@1 -->
```yaml
format: dsh-delivery-work-brief@1
outcome: Users can move from Overview to Focus and Leaf views and return.
context: Keep the interaction entirely mock-backed while the data APIs remain out of scope.
allowedScope:
  - Reader semantic-zoom UI and mock fixtures
forbiddenScope:
  - Database, migration, API, and parser changes
acceptanceClauses:
  - id: overview-to-focus
    text: A user can open one Focus view from Overview.
  - id: focus-to-leaf
    text: A user can open one Leaf view and return to its parent.
openDecisions: []
baseSelectionRule:
  kind: ref-head
  ref: refs/heads/main
verificationSource:
  kind: contract-field
  checks:
    - id: typecheck
      name: TypeScript host check
      argv: [pnpm, exec, tsc, -b, tsconfig.host.json]
      cwd: .
      timeoutMs: 120000
      severity: required
      expectedExitCodes: [0]
referenceLinks: []
```
