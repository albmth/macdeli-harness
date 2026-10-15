---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-15-macdeli-mission-schedule

English | [中文](2026-10-15-macdeli-mission-schedule.zh.md)

## Summary

Adds the required quant/mission event for durable research authority and optional typed schedule occurrences in persisted user-message sources. Session format V4 remains unchanged.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-macdeli-mission-schedule
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "a5fb06b833a23517ecbb65cf7ea865334b16dd31a650520591a59b94ad0d0241"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "f3ae7d02607ae5606e645347d3e82813f7a0d5f561cad3d35fafd69ac32e8add"
    decision: same-version
  - root: "event:quant/mission"
    previous: null
    after: "5fbc43b13bcfb5b150a318ca39c8ba02cd9b549dd1dfb07e00757f596cf5a0e4"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "cbac444061754adfb90a793b610ad4f5fdde8c78b9d2976a78a882279ae58db3"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "e8fb0ddc17a55636897f16d5d3e7a7ce770f593b8584824621539a031dbd9abe"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing sessions without quant/mission remain readable; the mission projection starts empty and the configured mission initializes its own session explicitly. Mission records remain required, without ignorable: true. Older readers whose generated vocabulary lacks quant/mission refuse these records before execution or write recovery, rather than silently discarding pause, authority or work state. The generated known-event vocabulary includes the new event for this fork. Optional schedule occurrences are retained attribution metadata inside existing source objects; absence preserves historical message meaning and older readers can preserve the opaque fields without using duplicate suppression. The four affected message-container roots retain their existing payload alternatives. The Host task-store deliveryRetry field is outside Session persistence types. No header, event envelope or migration generation changes.

<a id="verification"></a>
## Verification

The mission state and SessionController agent suites passed 20 tests with vitest --project thread-safe. They cover durable provider probes, paused timed waits, occurrence admission, projection replay and remote workspace preparation. The current-event-admission and V4 codec suites passed 23 tests, including unknown-required-event refusal without truncating stored bytes. The scheduler owner reran the complete schedule and tool-schedule suites after correcting an asynchronous teardown race in the new restart test: 849/849 tests passed across 19 files. TypeScript builds for mission and SessionController passed. These checks do not claim a paid autonomous experiment or exactly-once external effects. After a real pre-model workspace failure exposed zero-round rearming, the mission suite passed 6 tests including terminal setup-failure refusal across restart; no persistence type changed.

<a id="dev-note"></a>
## Dev Note

None.
