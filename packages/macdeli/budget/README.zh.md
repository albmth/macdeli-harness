---
description: "跨实际请求和重启执行初始模型累计额度。"
kind: "package-reference"
---

# @macdeli/dsh-budget

[English](README.md) | 中文

## 概述

此受信任 Host 插件跨实际 Messages 请求、重试、直接调用、压缩、会话和发布执行初始累计 $5 额度。

它不提供模型可用的配置或充值工具。

## 目录

- [使用此包](#use-this-package)
- [记账](#accounting)
- [验证](#verification)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

固定控制目录为 `/Users/abxnah/DEV_THINGS/TheMacDeliFund/.quant/control`。

`budget-authority.json` 记录一次性身份；`budget.sqlite` 是权威累计账本；`budget-tariff.json` 记录独立核实的公开价格。

这三个文件均不受发布或会话回滚影响，且工作机无法访问。

已初始化的账本缺失或损坏会阻止付费调用。

绝不使用旧备份替换账本，也不通过重新初始化获得另一份额度。

核实官方价格与模型限制后，使用固定的 Node 运行时初始化一次：

```sh
node --import tsx/esm --input-type=module -e "import { initializeBudget } from './packages/macdeli/budget/src/ledger.ts'; initializeBudget('<actual-verification-ISO-timestamp>')"
```

`refreshTariff(timestamp)` 记录对未改变的已批准价格的后续独立核查，不改变支出。

核查在一小时后过期；插件不执行付费刷新调用或自动充值。

`readBudgetStatus()` 读取状态，不获取 Host 写入租约。

将 `@macdeli/dsh-budget` 以空配置挂载在原生提供方旁。

共享的 `llm/stream` 钩子限制路由，并在上传前拒绝图片或文件输入。

原生 `deepseek/physical-attempt` 钩子在默认值和请求扩展解析后、每次 HTTP POST 前运行。

它校验确切端点、模型、输出上限、思考设置和普通文本或工具请求字段。

提供方原生搜索与未知请求扩展均被拒绝。

配置必须禁用其他付费提供方、自动标题和付费搜索。

<a id="accounting"></a>
## 记账

准入使用 SQLite `BEGIN IMMEDIATE`、`synchronous=FULL`，同时只允许一个活跃 Host 写入方和一个进行中的请求。

每次实际请求按 $0.30/M 预留 1,048,576 个输入 token，并按 $1.20/M 预留其生效输出上限，最多 8,192 个 token。

最大预留金额为 324,404 微美元。

上游 token 计量使用字符数除以 4 的启发式算法，因此不能替代这个可执行的提供方容量上限。

已完成调用将所有报告的输入或缓存类别按最高未命中价格结算，将包括思考的生成输出按最高输出价格结算。

SQLite 保留原始提供方身份和累计用量；保守记账不是提供方发票。

仅接受缺失或 `standard` 服务层级元数据；priority、batch 和未知用量类别均阻止准入。

所有者可停止 Host，对照官方价格约定核实已保存的完整回执，然后调用账本的 `reviewCompleted(attempt, receiptDigest, reason)`，针对明确解释的情况进行结算。

复核将原始结果、费用、预留金额和回执保留在审计记录中；它不能结算未知用量类别，也不能重置额度。

[DeepSeek Anthropic 指南](https://api-docs.deepseek.com/guides/anthropic_api/)与 [Claude 服务层级](https://platform.claude.com/docs/en/api/service-tiers)说明了提供方元数据。

被中断、超时或崩溃的请求保留全部预留金额。

重启的 Host 可在剩余额度内继续，同时保留此前未确定的费用。

返回意外模型、用量类别或 token 范围时，永久阻止后续准入并保留预留金额。

稳定的终止代码为 `MACDELI_BUDGET_BLOCKED`；使命恢复必须保存状态并停止付费继续执行，不为最后的解释另花一次调用。

<a id="verification"></a>
## 验证

针对性验证：

```sh
node node_modules/typescript/bin/tsc -b packages/macdeli/budget/tsconfig.json
node node_modules/vitest/vitest.mjs run packages/macdeli/budget/tests/budget.spec.ts packages/llm/llm-deepseek/tests/stream.spec.ts packages/llm/llm-deepseek/tests/adapter.spec.ts
```

这些 fixture（测试前置数据）在不使用提供方凭据的情况下覆盖真实 SQLite 事务、最后剩余额度拒绝、独占准入、进程突然退出与重启、不确定费用、价格核查过期、身份丢失、各辅助调用路由和原生 HTTP 请求拦截。

<a id="model-experience"></a>
## 模型体验

### 付费请求准入

#### 模型看到的内容

插件不添加提示或工具；被拒绝的付费请求以 `MACDELI_BUDGET_BLOCKED` 结束，由[使命](../mission/README.zh.md)处理，不付费生成解释。

#### Token 影响

插件不调用模型，也不增加输入 token；它为每次获准的实际请求记账。

#### KV Cache 影响

插件保留请求内容，不改变提供方的缓存前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 记账保证依赖独立核实的提供方价格与 token 约定。
- Host 特权被攻破与提供方错误计费不在客户端保证范围内。
- 现有独立 Trader 客户端不使用此账本。

<a id="dev-note"></a>
### 开发备注

[账本](src/ledger.ts)拥有记账逻辑，[实际请求守卫](src/gate.ts)拥有序列化请求校验。
