---
description: "MacDeliFund 所有者 fork 包，提供自主研究、累计模型记账和隔离执行。"
kind: "package-group"
---

# macdeli/ - 自主量化集成

[English](README.md) | 中文

## 概述

此所有者 fork 在固定的 DeepSeek Harness 上扩展自主研究连续性、累计模型记账和专用隔离执行配置。

Harness 仍拥有 agent loop（智能体循环）、会话、目标、调度和工具执行。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

每个包拥有 MacDeli 部署的一项职责。

| 包 | 用途 |
|---|---|
| [budget](budget/README.zh.md) | 跨实际请求和重启执行初始模型累计额度。 |
| [mission](mission/README.zh.md) | 持久保存研究工作，通过原生目标和计划恢复继续执行。 |
| [profile](profile/README.zh.md) | 组合已批准模型、受信任工具和隔离的 Linux 工作机。 |

<a id="related-documentation"></a>
## 相关文档

[持久化确认记录](../../docs/persistence-changes/2026-10-15-macdeli-mission-schedule.zh.md)记录使命状态与计划发生信息的读取兼容性。

[核心子系统](../../docs/subsystems/core.zh.md)拥有复用的 Agent 与 Session 生命周期。

上层 MacDeliFund 仓库通过 Git 子模块固定此 fork，并拥有部署身份、运行说明和演示证据。

<a id="dev-note"></a>
## 开发备注

无。
