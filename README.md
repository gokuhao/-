# 步步兽（StepBeast）

步步兽是一款 Windows 本地 AI 桌面宠物。它用宠物作为人格化入口，把任务、专注、成长反馈、Hermes 助理与 Obsidian 长期记忆逐步连接成个人执行系统。

当前状态：**Milestone 0 已完成：Electron + React + TypeScript + Vite 基础窗口可运行。**

## 已确定的系统分工

- 桌面宠物：展示、交互、提醒与陪伴。
- SQLite：保存任务、计时、经验和宠物状态等高频实时数据。
- Hermes：负责理解、规划、工具调度和 AI 对话。
- Obsidian：保存项目、复盘、重要决策和长期知识。
- Codex：负责按里程碑开发、测试和维护系统。

## V0.1 验证问题

> 一只常驻桌面的宠物，能否降低开始任务的阻力，并帮助用户完成当天最重要的一件事？

V0.1 只实现透明桌宠、任务管理、1+2 今日计划、专注倒计时、经验成长、情绪反馈和本地存储。Hermes、Obsidian、电脑行为感知均留到后续版本。

## 文档入口

- [产品需求](prd.md)
- [技术架构](docs/architecture.md)
- [数据库设计](docs/database-schema.md)
- [Agent 设计](docs/agent-system.md)
- [Hermes 与 MCP](docs/hermes-mcp.md)
- [开发路线](docs/development-plan.md)
- [规格确认清单](docs/spec-approval.md)

## 开发状态

规格已经确认。当前只推进 V0.1，并按照一个小功能、一次测试、一次提交的节奏开发。
