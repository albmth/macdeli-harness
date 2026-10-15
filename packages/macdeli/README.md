---
description: "MacDeliFund owner-fork packages for autonomous research, cumulative model accounting and isolated execution."
kind: "package-group"
---

# macdeli/ - autonomous quant integration

English | [中文](README.zh.md)

## Summary

This owner fork extends the pinned DeepSeek Harness with autonomous research continuity, cumulative model accounting and a dedicated isolated execution profile.

Harness retains ownership of its agent loop, sessions, goals, scheduling and tool execution.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

Each package owns one part of the MacDeli deployment.

| Package | Purpose |
|---|---|
| [budget](budget/README.md) | Enforce the initial cumulative model allowance across physical requests and restarts. |
| [mission](mission/README.md) | Persist research work and continue through native goals and scheduled recovery. |
| [profile](profile/README.md) | Compose the approved model, trusted tools and isolated Linux worker. |

<a id="related-documentation"></a>
## Related documentation

The [persistence acknowledgement](../../docs/persistence-changes/2026-10-15-macdeli-mission-schedule.md) records reader compatibility for mission state and schedule occurrences.

The [core subsystem](../../docs/subsystems/core.md) owns the reused Agent and Session lifecycle.

The enclosing MacDeliFund repository pins this fork through its Git submodule and owns deployment identity, operating instructions and demonstration evidence.

<a id="dev-note"></a>
## Dev Note

None.
