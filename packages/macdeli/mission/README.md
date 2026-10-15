---
description: "Continue autonomous research through durable mission state, native goals and scheduled recovery."
kind: "package-reference"
---

# @macdeli/dsh-mission

English | [中文](README.zh.md)

## Summary

Preserve one enduring research mission across restarts and continue useful work through native Harness goals and schedules.

The owner controls pause and resume through the local Unix socket; status includes the actual tools visible to the mission Agent.

## Table of Contents

- [Use this package](#use-this-package)
- [Recovery](#recovery)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The [MacDeli profile](../profile/cordis.patch.yml) supplies the mission configuration and required budget service.

The [implementation](src/index.ts) uses native sessions, projections, goals and schedules without adding another agent loop or scheduler.

`work_select` records a bounded question, rationale, alternatives, expected result and stopping condition before binding its native goal.

`work_checkpoint` preserves the specification, command, input identities and progress.

`work_finish` records positive, negative, inconclusive or failed work through its conclusion and evidence references, then selects another useful direction.

Old work remains in append-only Session events even when the current projection selects a new task.

Published artifacts remain separate immutable evidence; a model conclusion is not evaluator certification.

Native goal rounds have a configurable initial allocation.

`work_extend` records a material reason and additional rounds in the same task, retaining its identity, evidence and extension history.

Reaching the allocation permits one explicit reconsideration round to finish, abandon or justify extension.

Failing to use that reconsideration abandons the bounded task and selects a new direction.

Worker process timeouts and the cumulative model allowance are enforced independently.

<a id="recovery"></a>
## Recovery

After native request retry declines a transient provider error, the plugin persists at most two scheduled probes, normally after five and thirty minutes.

Restart preserves the probe count and next wake.

Successful model output closes the incident.

Budget, authentication and configuration failures never schedule automatic probes.

Unhandled setup or plugin turn failures stop continuation with an owner fault, including failures before the first model round.

Owner resume clears the mission fault but does not change spending authority or the cumulative ledger.

Timed waits resume the same task when due.

Pause survives restart and suppresses model admission.

Schedule occurrence identities are committed before admission, preventing repeated reminders from admitting the same wake twice.

Startup reconciles interrupted work selection, goal binding and recorded extensions.

The base `session-checkpoint-policy` flushes native tool calls and model requests before effects; the mission additionally flushes its own state transitions.

<a id="model-experience"></a>
## Model Experience

### Mission tools and continuation

#### What the model sees

`work_status` and the mission tools return revisioned task state, checkpoints and evidence references, while native goals and reminders supply the next instruction; [source](src/index.ts) owns the declarations.

#### Token effect

Tool declarations, task responses and continuation messages consume context; durable waits and owner pause admit no deliberation requests.

#### KV Cache effect

New results and continuation messages append to Session history without replacing previous messages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Published artifact integrity does not certify a model's economic conclusion or numerical evaluation.
- Native round allocations are extendable; the independent cumulative financial allowance still applies.

<a id="dev-note"></a>
### Dev Note

The [state tests](tests/state.spec.ts) exercise durable probe exhaustion, non-retryable failures, paused timed waits, occurrence deduplication and projection replay.
