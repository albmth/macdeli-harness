---
description: "Compose the MacDeli mission, cumulative budget and isolated research tools in one dsh profile."
kind: "package-bundle"
---

# @macdeli/dsh-quant

English | [中文](README.zh.md)

## Summary

Run the autonomous research mission with the approved DeepSeek route, trusted quantitative tools and remote Linux file and subprocess providers.

The enclosing MacDeliFund launcher owns deployment preparation and selects this bundle through the normal `dsh` profile path.

## Table of Contents

- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="composition"></a>
## Composition

The [profile patch](cordis.patch.yml) mounts the [budget](../budget/README.md) and [mission](../mission/README.md), then selects native SSH providers and the fixed Python MCP service.

The [package manifest](package.json) declares the bundle layer and its dependencies; the enclosing application supplies the prepared worker and Host control directory.

<a id="model-experience"></a>
## Model Experience

### Research profile

#### What the model sees

The profile supplies the enduring research mission, native `bash` and filesystem tools and bounded quantitative evidence tools; the [patch](cordis.patch.yml) owns their composition.

#### Token effect

Each selected provider owns its tool declarations, instructions and results; this bundle issues no independent model calls.

#### KV Cache effect

The mission's persistent Session retains prior context while native consumers append new instructions and tool results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The deployment requires the prepared MacDeli Linux worker and fixed Host runtime paths.
- This profile provides research authority and no live trading authority.

<a id="dev-note"></a>
### Dev Note

Operational verification and generated experiment evidence belong to the enclosing MacDeliFund implementation report.
