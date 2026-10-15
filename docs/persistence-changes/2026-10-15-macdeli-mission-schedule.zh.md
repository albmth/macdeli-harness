---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-15-macdeli-mission-schedule

[English](2026-10-15-macdeli-mission-schedule.md) | 中文

## 概述

新增必需的 quant/mission 事件以持久保存研究授权，并在已持久化的用户消息来源中加入可选的类型化计划发生信息。Session 格式仍为 V4。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

不含 quant/mission 的已有会话仍可读取；使命投影从空状态开始，由配置的使命明确初始化自己的会话。使命记录保持必需，不设置 ignorable: true。生成的事件列表不含 quant/mission 的旧读取器会在执行或写入恢复前拒绝这些记录，不会静默丢弃暂停、授权或工作状态。本 fork 生成的已知事件列表包含新事件。可选的计划 occurrences 是现有来源对象内保留的归属元数据；缺失时保留历史消息语义，旧读取器无需使用重复抑制即可保留不透明字段。受影响的四种消息容器保留已有的负载备选形式。Host 任务存储的 deliveryRetry 字段不属于 Session 持久化类型。头部、事件封装和迁移代际均未改变。

<a id="verification"></a>
## 验证

使命状态与 SessionController agent 测试使用 vitest --project thread-safe，20 个测试通过，覆盖持久提供方探测、暂停后的定时等待、发生准入、投影回放和远端工作目录准备。current-event-admission 与 V4 codec 测试有 23 个通过，包括拒绝未知必需事件且不截断已存储字节。调度器负责人修复新增重启测试中的异步清理竞态后，重跑完整的 schedule 与 tool-schedule 套件：19 个文件中的 849/849 个测试通过。mission 与 SessionController 的 TypeScript 构建通过。这些检查不声称完成付费自主实验，也不证明外部效果恰好发生一次。 真实的模型调用前工作目录失败暴露了零 Round 重新激活问题；修复后使命套件的 6 个测试通过，包括跨重启拒绝终止的设置失败；持久化类型未改变。

<a id="dev-note"></a>
## 开发备注

无。
