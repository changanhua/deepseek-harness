# Agent Note: Explicit creativity workflow

Status: implemented

English | [中文](2026-09-15-explicit-creativity-workflow.zh.md)

## Problem

A repository creativity workflow can help when a user explicitly wants divergent ideas, but an automatically triggered persona can override a concrete implementation, review, debugging, or evidence task. A slash name that differs from the Skill name also gives users an invocation that the repository does not provide.

## Decision

The repository carries `claude-creativity` as a manually invoked development Skill. Its frontmatter disables model-initiated invocation while keeping user invocation available, and its documented command is `/claude-creativity`. Intensity and output-style options shape an explicitly requested creative pass; they do not expand tool authority, implementation scope, or verification claims.

The Skill follows the active conversation language and higher-priority repository instructions. It loads persona and technique references only after invocation, and it stays restrained when the requested task has no meaningful alternative space.

## Alternatives considered

**Trigger creativity for every design or improvement task.** Rejected because ordinary implementation and review work often needs contract fidelity rather than unsolicited divergence, and the broad trigger made the Skill compete with debugging and verification workflows.

**Put a permanent creative persona in root agent instructions.** Rejected because a repository-wide persona would affect every task and could not be selected or omitted per request.

## Consequences

Users opt into the workflow by name and receive stable intensity and style controls. Agents do not advertise or load the workflow merely because a task mentions architecture, design, or improvement. The repository owns the workflow text and its referenced techniques as development guidance rather than a product runtime contract.
