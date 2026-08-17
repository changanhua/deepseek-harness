# Agent Note: task queue startup preserves execution readiness

Status: implemented

English | [中文](2026-08-17-task-queue-startup-execution.zh.md)

## Problem

`LocalTaskQueue` started its scheduler while asynchronous recovery was still reading the durable log. An admission or claim could update the in-memory fold and then be erased when the older recovery result arrived, leaving the durable task in `starting` with no spawn or settlement. The service also used `ctx.subprocess` without declaring that plugin dependency, so the spawn path could wait for service resolution in the task-queue plugin fiber.

## Decision

`LocalTaskQueue` declares `static inject = ['subprocess']`, so Cordis loads it only with a usable subprocess provider. The service starts boot recovery before registering its lifecycle scheduler and stores the operation as `bootPromise`. The scheduler starts only after that promise settles successfully enough for the existing fault handling to decide service state. Tool enqueue, cancel, retry, and notification acknowledgement await the same promise before performing durable mutations; a boot failure therefore reaches the existing `faulted` admission check instead of racing recovery.

The lifecycle regression test delays the return of a real `TaskQueueStore.recover()` after it has read the old log, requests an enqueue during that interval, and runs the task through `LocalSubprocessRuntime` to a terminal success. The original behavior fails by leaving the task in `starting`; the shipped behavior keeps the task and completes the subprocess.

## Alternatives considered

**Start the scheduler after recovery but allow mutations immediately.** This still lets an early enqueue update memory before the delayed recovery result is installed, so it does not close the overwrite race.

**Adopt whichever recovery result has the higher sequence number.** This does not safely define the initial in-memory state when durable records already exist and new mutations are requested before hydration; readiness ordering is the simpler owner of that lifecycle obligation.

**Make `spawnAndMark` retry or treat a missing task as a failure.** That handles the symptom after the task has already been erased and can lose the intended execution; it does not preserve the durable admission or fix subprocess dependency resolution.

## Consequences

Initial durable mutations wait for queue recovery, and the queue cannot schedule work before recovery has established its in-memory state. A missing subprocess provider prevents the task-queue plugin from becoming usable. The existing sticky `faulted` protocol remains responsible for recovery and storage failures. Focused task-queue-local tests cover the new lifecycle path; the standalone real-component reproduction passes after rebuilding the host artifact.
