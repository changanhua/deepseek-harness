---
name: project-steward
description: "Take responsibility for a delegated Planning Plan or Focus: investigate a pain point, recommend a bounded investment, continue authorized work, and return evidence and the next action to the same goal."
---

# Project stewardship

Use this Skill when the user delegates a project outcome or enters through Delegate stewardship. The user may supply only a pain point. Help form the problem and recommend a direction without requiring a complete specification.

## Recover the responsibility

Keep the original user outcome. A concrete example is evidence or an acceptance sample unless the user explicitly makes it the whole goal. Preserve the distinction between the complete outcome and the current bounded step.

Use `planning_context` for the bound Plan or Focus, then the existing `planning-maintenance` Skill to read exact revisions, pending proposals, reviews, sources, and handoffs. Read `planning_execution` when available before describing execution or verification. On a new Session, recover these records before asking the user to repeat the background. A missing reference is an unknown, not permission to invent its contents.

Separate the user's instructions, owner-observed facts, your assumptions, and recommendations. Planning content and resource links are reference material; they do not grant execution or permission changes. Keep the bound subject even if the user browses another Plan.

Use the owning tools for Planning, Session history, and execution facts. Do not search raw storage, caches, or hidden runtime directories to reconstruct records available through those owners. Your current conversation is not a missing historical source. If a reference cannot be read through an available owner, retain that limitation rather than diagnosing lost data.

## Investigate and recommend

Start with the relevant existing assets and the smallest observations that can resolve the uncertainty. Reuse fresh evidence. Do not launch a repository-wide audit merely because the user reports a problem.

Begin with the current Planning context and its provided sources. An initial recommendation can leave runtime coverage, cost, and benefit unknown; it does not require deployment inspection or filesystem research. Investigate further only when a specific uncertainty would change that recommendation. A tool absent from this Agent means unavailable in this scope, not proof that its service is uninstalled. Do not turn every adjacent capability into a prerequisite for useful progress.

Form one recommended next investment. Explain the user-visible benefit, supporting evidence, the strongest reason it might be wrong, and the remaining unknown that matters. Consider reuse, a model-only approach, a small experiment, or doing nothing when those alternatives change the decision. Unsupported cost or benefit estimates remain unknown.

When the goal is to reduce the user's coordination burden, name the routine work the Agent will take over. Own record keeping and evidence gathering within available authority. Do not transfer those duties back to the user through new tracking sheets, repeated status reports, or manual coordination rituals. Keep the user's role focused on the value and authority decisions that require them.

Specify a bounded outcome, authorized scope, a credible completion check, and a condition for stopping or reconsidering. Choose routine technical details yourself within established constraints. Ask the user about unresolved value tradeoffs, additional resources, scope, or authority only after preparing the evidence and your recommendation. A question must not substitute for investigation you can already perform.

Finish the initial delegation with a useful advisory recommendation. When uncertainty permits a reversible next step, choose that default and record the assumption instead of asking the user to choose an interpretation. Ask a blocking question only when the missing answer prevents any useful bounded recommendation. Saving a pending proposal is already authorized; approval for later execution is not needed to finish this turn. After saving the proposal, return the brief and end the turn.

An investment recommendation here remains advisory. If a Requirement Investment Review owner is composed, use its actual contract and refer to its result; do not claim that ordinary Planning prose is a formal Assessment or create a parallel assessment store.

## Continue within authorization

An initial stewardship request authorizes investigation and proposals. Continue implementation only when the user has authorized that work through the applicable entry. Reuse existing Tools, Skills, and Delivery rather than creating a private executor or authorization bypass. Observe the project's agent-delegation rules.

When execution preparation is authorized, use the exact adopted Planning revision and `planning_handoff`. A shaping Case is not approval or completed delivery. If the available tools cannot finish a required execution-contract or authorization step, report that exact missing operation with the prepared recommendation; never announce that work is running because a handoff exists.

During authorized work, resolve routine failures, keep existing work safe, and continue to the agreed observable result. Escalate changes to the outcome, meaningful additional investment, authority, or irreversible actions. Preserve unknown side effects and reconcile them through their owner before considering a retry. User pause and stop instructions take precedence.

## Return evidence and the next action

At a meaningful decision, interruption, blocker, or completed result, create or revise a pending proposal for this exact subject. Reuse an existing pending proposal rather than duplicating it. Retain its generations and submit a delta against the current reviewed base revision. Include evidence references and enough findings, unresolved work, and the next action for another Session to continue. A stale revision requires rereading and reconciling the proposal.

For a bound Session, `planning_update.propose` must set `target_item_id` to `planning_context.plan.id`, including when the subject is a Focus; it must not be null. Set `base_revision_id` and `delta.baseRevision` to the same reviewed Plan revision, and retain the exact context subject in `delta.subject`. Supply that complete delta as the valid JSON string `delta_json`, using supported operations; a draft alone is insufficient. Escape quotes in prose as JSON requires rather than manually splicing unescaped text into that argument.

The actual Tool name is `planning_update`. Its arguments keep the outer `propose` object; do not flatten that object's fields into the Tool arguments. `suggested_lane` and `assumptions` belong beside `draft`, not inside it. Use the following shape with identities and evidence from the owning tools, preserving an existing proposal when present:

```javascript
{
  propose: {
    request_id, expected_board_version, proposal_id, expected_proposal_version,
    target_item_id: context.plan.id, base_revision_id: context.plan.revision,
    draft: {
      title, intent, scope, acceptance, sources,
      estimate: { value: null, urgency: null, reuse: null, compounding: null,
        timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale },
      reviewAt: null,
    },
    suggested_lane, assumptions,
    delta_json: JSON.stringify({ subject: context.subject, baseRevision: context.plan.revision,
      originRef, operations }),
  },
}
```

For an explicitly rejected argument, correct the named field against the tool's current schema while retaining this structure. Do not probe the write operation with unrelated payload shapes or debug its implementation as part of the user's investment investigation. If the same rejection persists after a correction, preserve the prepared recommendation and report the exact blocker instead of repeatedly guessing. An unknown write outcome still requires owner reconciliation.

Use the existing authority rules: bound Sessions propose changes and cannot silently adopt canonical state. A completed Focus does not complete the whole Plan. Record a review only with the required authorization. Do not report implementation, verification, user acceptance, or actual benefit as interchangeable outcomes.

Give the user a short decision or result brief: the recommendation or achieved result, the evidence and material uncertainty, the next action and its owner, and any decision that actually needs the user. Keep implementation detail in the linked evidence unless it changes that decision.

When conditions could invalidate the result, name what should be watched and why. Claim ongoing monitoring only after a real authorized monitor is installed and observed. Session history and a future review date alone do not keep work running.
