# 步步兽（StepBeast）

步步兽是一款 Windows 本地 AI 桌面宠物。它用宠物作为人格化入口，把任务、专注、成长反馈、Hermes 助理与 Obsidian 长期记忆逐步连接成个人执行系统。

当前状态：**Milestone 6 Task 6.1 已完成：Sprout Cat 已能安全只读索引 Obsidian Vault。**

## 当前可用功能

- Windows 透明无边框悬浮窗口，默认置顶且不占用任务栏。
- 拖动桌宠移动位置，并在下次启动时恢复。
- 使用 Codex v1 的 8×9 spritesheet 播放 Sprout Cat 原生动画。
- 拖动方向会切换左右移动反馈，双击会挥手，专注时会进入工作动作。
- 单击展开今日行动面板，支持 25 分钟专注的开始、暂停和继续。
- 支持创建、展示、修改、完成和软删除本地任务；任务保存在 Electron 用户数据目录的 `pet.db`。
- 支持每天设置 1 个今日主线和最多 2 个辅助任务，规则由 SQLite 事务统一保证。
- 专注计时保存在 SQLite，支持暂停、恢复和应用重启后继续，并累计任务实际专注分钟数。
- 完成任务按预计时长获得 10–50 XP，宠物会显示奖励反馈、等级和升级进度。
- 已连接 Hermes 原生 API Server；支持健康检查、Bearer 认证、离线降级和面板重试。
- 支持通过 Hermes 生成结构化任务拆解提案，用户确认后才以父子关系创建子任务。
- 支持让 Hermes 从未完成任务中生成“1 条主线 + 最多 2 条辅助”计划，预览理由并确认后才原子替换今日计划。
- 支持只读索引用户授权的完整 Obsidian Vault，解析 Markdown 标题、frontmatter、标签、目录、修改时间和文件大小。
- 面板同时显示 Hermes 与 Obsidian 连接状态，点击 Obsidian 状态可以手动重新索引。
- 尊重系统的“减少动态效果”设置。

## 宠物动画为什么使用 spritesheet

spritesheet 把多个动作帧放进一张透明图片，界面只需要改变 CSS `background-position` 就能播放动画。这样做沿用 Codex 桌宠的运行方式，资源读取次数少、透明窗口兼容性好，也不需要增加视频播放器或新的第三方依赖。

当前素材位于 `public/pets/sprout-cat/`。它是 v1 图集，包含 9 行标准动作；未来需要视线跟随时，再升级为带 16 个视线方向的 v2 图集。

## 已确定的系统分工

- 桌面宠物：展示、交互、提醒与陪伴。
- SQLite：保存任务、计时、经验和宠物状态等高频实时数据。
- Hermes：负责理解、规划、工具调度和 AI 对话。
- Obsidian：保存项目、复盘、重要决策和长期知识。
- Codex：负责按里程碑开发、测试和维护系统。

## V0.1 验证问题

> 一只常驻桌面的宠物，能否降低开始任务的阻力，并帮助用户完成当天最重要的一件事？

V0.1 已实现本地执行闭环，V0.2 已接入 Hermes 任务拆解和每日计划，当前进入 V0.3 Obsidian 阶段；电脑行为感知继续留在后续版本。

## 文档入口

- [产品需求](prd.md)
- [技术架构](docs/architecture.md)
- [数据库设计](docs/database-schema.md)
- [Agent 设计](docs/agent-system.md)
- [Hermes 与 MCP](docs/hermes-mcp.md)
- [开发路线](docs/development-plan.md)
- [规格确认清单](docs/spec-approval.md)

## 开发状态

规格已经确认。当前推进 V0.3，并按照一个小功能、一次测试、一次提交的节奏开发。
