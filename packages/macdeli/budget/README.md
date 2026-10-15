---
description: "Enforce the initial cumulative model allowance across physical requests and restarts."
kind: "package-reference"
---

# @macdeli/dsh-budget

English | [中文](README.zh.md)

## Summary

This trusted Host plugin enforces the initial cumulative $5 allowance across physical Messages requests, retries, direct calls, compaction, sessions and releases.

It exposes no model-facing configuration or top-up tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Accounting](#accounting)
- [Verification](#verification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The fixed control directory is `/Users/abxnah/DEV_THINGS/TheMacDeliFund/.quant/control`.

`budget-authority.json` records the one-time identity; `budget.sqlite` is authoritative cumulative accounting; `budget-tariff.json` records independently verified public pricing.

All three remain outside release/session rollback and worker access.

A missing or corrupt initialized ledger blocks paid calls.

Never replace it from an older backup or rerun initialization to obtain another allowance.

After verifying the official pricing and model limits, initialize once with the pinned Node runtime:

```sh
node --import tsx/esm --input-type=module -e "import { initializeBudget } from './packages/macdeli/budget/src/ledger.ts'; initializeBudget('<actual-verification-ISO-timestamp>')"
```

`refreshTariff(timestamp)` records a later independent check of the unchanged approved tariff without changing spending.

Verification expires after one hour; the plugin performs no paid refresh call or automatic top-up.

`readBudgetStatus()` reads status without acquiring the Host writer lease.

Mount `@macdeli/dsh-budget` with empty configuration alongside the native provider.

The shared `llm/stream` hook restricts routes and rejects image/file inputs before upload.

The native `deepseek/physical-attempt` hook runs after defaults and request extensions resolve and before each HTTP POST.

It validates the exact endpoint, model, output cap, thinking settings and ordinary text/tool request fields.

Provider-native search and unknown request extensions are refused.

The profile must disable other paid providers, automatic titles and paid search.

<a id="accounting"></a>
## Accounting

Admission uses SQLite `BEGIN IMMEDIATE`, `synchronous=FULL`, one live Host writer and one request in flight.

Every physical attempt reserves 1,048,576 input tokens at $0.30/M plus its effective output cap, at most 8,192 tokens at $1.20/M.

The maximum reservation is 324,404 micro-USD.

The upstream token meter uses a characters/4 heuristic, so it cannot replace this enforceable provider capacity bound.

Completed calls reconcile all reported input/cache categories at peak miss price and generated output, including thinking, at peak output price.

Raw provider identity and cumulative usage are retained in SQLite; conservative accounting is not a provider invoice.

Only absent or `standard` service-tier metadata is accepted; priority, batch and unknown usage categories block admission.

The owner may stop the Host, verify a saved complete receipt against the official pricing contract, and call the ledger's `reviewCompleted(attempt, receiptDigest, reason)` for a narrowly explained settlement.

The review retains the original outcome, charge, reservation and receipt in the audit record; it cannot settle unknown usage categories or reset the allowance.

The [DeepSeek Anthropic guide](https://api-docs.deepseek.com/guides/anthropic_api/) and [Claude service tiers](https://platform.claude.com/docs/en/api/service-tiers) describe the provider metadata.

Interrupted, timed-out and crashed requests retain their full reservations.

A restarted Host can continue within remaining headroom while prior unresolved charges remain intact.

Unexpected returned model, usage category or token bounds permanently blocks further admission and retains the reservation.

The stable terminal code is `MACDELI_BUDGET_BLOCKED`; mission recovery must save state and stop paid continuation without spending a final explanatory call.

<a id="verification"></a>
## Verification

Targeted verification:

```sh
node node_modules/typescript/bin/tsc -b packages/macdeli/budget/tsconfig.json
node node_modules/vitest/vitest.mjs run packages/macdeli/budget/tests/budget.spec.ts packages/llm/llm-deepseek/tests/stream.spec.ts packages/llm/llm-deepseek/tests/adapter.spec.ts
```

The fixtures exercise real SQLite transactions, last-headroom refusal, exclusive admission, abrupt process exit and restart, uncertain charges, tariff expiry, identity loss, every auxiliary-call route and native HTTP attempt interception without provider credentials.

<a id="model-experience"></a>
## Model Experience

### Paid request admission

#### What the model sees

The plugin adds no prompt or tool; rejected paid requests end with `MACDELI_BUDGET_BLOCKED`, which the [mission](../mission/README.md) handles without a paid explanation.

#### Token effect

The plugin makes no model calls and adds no input tokens; it accounts for every admitted physical attempt.

#### KV Cache effect

The plugin preserves request content and does not change the provider's cache prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The accounting guarantee assumes the independently verified provider tariff and token contract.
- Privileged Host compromise and provider misbilling remain outside the client-side guarantee.
- Existing independent Trader clients do not use this ledger.

<a id="dev-note"></a>
### Dev Note

The [ledger](src/ledger.ts) owns accounting and the [physical request guard](src/gate.ts) owns serialized request validation.
