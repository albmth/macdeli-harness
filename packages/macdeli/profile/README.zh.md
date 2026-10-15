---
description: "在一个 dsh 配置中组合 MacDeli 使命、累计预算和隔离研究工具。"
kind: "package-bundle"
---

# @macdeli/dsh-quant

[English](README.md) | 中文

## 概述

通过已批准的 DeepSeek 路由、受信任的量化工具及远端 Linux 文件与子进程提供方运行自主研究使命。

上层 MacDeliFund 启动器拥有部署准备，并通过普通 `dsh` 配置路径选择此组合包。

## 目录

- [组合](#composition)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="composition"></a>
## 组合

[配置补丁](cordis.patch.yml)挂载[预算](../budget/README.zh.md)和[使命](../mission/README.zh.md)，然后选择原生 SSH 提供方与固定的 Python MCP 服务。

[包 manifest（元数据清单）](package.json)声明组合层及其依赖；上层应用提供已准备的工作机和 Host 控制目录。

<a id="model-experience"></a>
## 模型体验

### 研究配置

#### 模型看到的内容

配置提供持续研究使命、原生 `bash` 与文件系统工具和有界量化证据工具；[补丁](cordis.patch.yml)拥有相关组合。

#### Token 影响

各选定提供方拥有自己的工具声明、指令和结果；此组合包不独立调用模型。

#### KV Cache 影响

使命的持久 Session 保留此前上下文，原生消费方追加新指令和工具结果。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 部署需要已准备的 MacDeli Linux 工作机和固定的 Host 运行时路径。
- 此配置提供研究授权，不提供真实交易授权。

<a id="dev-note"></a>
### 开发备注

运行验证和生成的实验证据属于上层 MacDeliFund 实现报告。
