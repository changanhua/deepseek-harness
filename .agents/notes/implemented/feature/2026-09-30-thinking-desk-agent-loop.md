# Agent Note: Thinking Desk Agent loop keeps Planning under human control

Status: implemented

English | [中文](2026-09-30-thinking-desk-agent-loop.zh.md)

## Problem

The first Design Case could retain a frozen layout but could not turn an explicit design question into durable, reviewable Agent output. Reusing ordinary Planning tools or a general execution Session would let the model create canonical changes before a person had reviewed the candidate and would lose the exact Planning and Case inputs that explain it after refresh or restart.

## Decision

The SBC Case owner persists a Thinking run in the existing Case record. A browser action prepares the run with one frozen Planning Context Pack, Case version, native Session identity, Planning binding command, and kickoff request. The Client resumes that record through the native Session create, binding, and prompt steps with the same identities; a blocked pre-binding revision change preserves the record and does not send the prompt. Run, result, Design Context, exploration note, submission receipt, and Proposal review snapshot remain bounded by the Case record limits.

The `thinking-desk` preset gives the run's live Agent child scope only `thinking_context` and `thinking_submit_result`. The owner derives authority from the live Agent, preset, bound Session, Workspace, and stored run; model input cannot choose those identities. The preset excludes `planning_update`, and the result tools only read the frozen Context Pack or persist a versioned candidate.

The browser renders the candidate before three separate human actions apply exploration notes, save Design Context, or submit a Proposal. Applying notes and context changes only the Case. Proposal submission uses the frozen subject, base revision, origin, evidence, and review snapshot; it does not advance canonical Planning. Adoption remains the existing human Planning action. Case drift requires a visible acknowledgement for an applicable output, while Planning drift rejects Proposal creation. Proposal review uses immutable state-entry material and the generation-bound Focus and resource snapshot; absent prior material blocks adoption.

## Alternatives considered

**Use ordinary Planning tools in the Thinking Session.** Their existing authority can create a Proposal from a bound Session, so prompt wording or a hidden button would not enforce the required human review boundary.

**Store Thinking state beside the Case.** A second record would require its own ownership, recovery, capacity, and consistency rules while duplicating the Case's frozen projection and local output lifecycle.

**Start a replacement Session or prompt after interruption.** A new identity could produce a second model request from a different Planning revision. The durable startup record instead makes each successful side effect recoverable by its original identity.

**Automatically rebase or adopt a delta.** Neither action can preserve the review meaning of a candidate whose Planning or Case inputs changed. The implementation retains the candidate and requires a person to choose the next action.

## Consequences

Thinking output is available through the native Agent loop without becoming canonical Planning data. The Context Pack remains the first preset's only research input, so it carries no repository or Web research capability. A human can apply each of the three outputs independently, and a later run receives saved Design Context from the same Case.

The focused Remote, tool, Client, and composed Web checks cover startup recovery, scope rejection, bounded results, independent output application, exact Proposal review, adoption, drift, and a second run's inherited Design Context. The real Web Agent test exercises native Thinking tools, all three outputs, human Proposal adoption, drift, and the second context read. This verifies the composed test environment; it does not claim deployment to a user's installed instance.
