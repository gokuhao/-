# 步步兽数据库 Schema 设计

版本：v0.1-spec  
数据库：SQLite  
状态：V0.1 已实现，V0.3 迁移至版本 7

## 1. 设计原则

- SQLite 是运行时状态的唯一真源。
- 时间统一保存为带时区的 ISO 8601 UTC 字符串，展示时转换为本地时区。
- 主键使用 UUID 字符串，避免未来同步时重新编号。
- 删除优先使用状态或 `deleted_at`，避免破坏成长与复盘历史。
- 任务完成、经验奖励和事件日志必须在同一事务中提交。

## 2. 当前表关系

```text
projects 1 ─── * tasks
projects 1 ─── * obsidian_task_imports * ─── 1 tasks
tasks    1 ─── * focus_sessions
tasks    1 ─── * daily_plan_items * ─── 1 daily_plans
tasks    1 ─── * growth_events
pet_profiles 1 ─── * growth_events
settings
events
schema_migrations
```

## 3. 表定义

### projects

V0.1 只提供轻量项目归类，不做完整项目管理。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| name | TEXT | NOT NULL | 项目名称 |
| status | TEXT | NOT NULL | active/testing/paused/completed/archived |
| category | TEXT | NOT NULL | current/support/paused |
| goal | TEXT | NULL | 从项目主页提取的目标摘要 |
| current_stage | TEXT | NULL | 当前阶段摘要 |
| source_note_path | TEXT | UNIQUE, NOT NULL | Obsidian 项目主页相对路径 |
| source_modified_at | TEXT | NOT NULL | 来源笔记修改时间 |
| created_at | TEXT | NOT NULL | 创建时间 |
| updated_at | TEXT | NOT NULL | 更新时间 |

Task 6.2 的项目记录只由用户确认过的 Obsidian 提案写入。来源笔记消失时不自动删除本地项目，避免一次索引异常造成数据丢失。

### project_sync_proposals

只保存用户已经确认的项目同步提案，用于幂等、审计和候选来源校验。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| proposal_id | TEXT | PK | 本次提案 ID |
| project_index_path | TEXT | NOT NULL | 项目总览相对路径 |
| summary | TEXT | NOT NULL | 提案摘要 |
| payload_json | TEXT | NOT NULL | 已确认项目和候选快照 |
| selected_candidate_keys_json | TEXT | NOT NULL | 用户选择的候选键 |
| confirmed_at | TEXT | NOT NULL | 确认时间 |

### obsidian_task_imports

记录 Obsidian 明确行动与本地任务的稳定映射，防止重新索引后重复创建。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| candidate_key | TEXT | PK | 来源项目路径和行动文本的 SHA-256 摘要 |
| proposal_id | TEXT | FK, NOT NULL | 首次确认该候选的提案 |
| project_id | TEXT | FK, NOT NULL | 所属本地项目 |
| task_id | TEXT | UNIQUE, FK, NOT NULL | 创建出的本地任务 |
| source_note_path | TEXT | NOT NULL | 行动所在笔记路径 |
| created_at | TEXT | NOT NULL | 创建时间 |

### tasks

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| parent_task_id | TEXT | FK, NULL | AI 拆解后的父任务；顶层任务为空 |
| proposal_id | TEXT | FK, NULL | 创建该子任务的确认提案，用于幂等 |
| project_id | TEXT | FK, NULL | 所属项目 |
| title | TEXT | NOT NULL | 任务标题 |
| description | TEXT | NULL | 补充说明 |
| status | TEXT | NOT NULL | todo/doing/completed/cancelled |
| estimated_minutes | INTEGER | NULL, CHECK > 0 | 预计分钟 |
| actual_minutes | INTEGER | NOT NULL DEFAULT 0 | 已记录分钟 |
| next_action | TEXT | NULL | 最小下一步 |
| evidence | TEXT | NULL | 完成标准或证据 |
| reward_xp | INTEGER | NOT NULL DEFAULT 10 | 经验奖励 |
| source | TEXT | NOT NULL DEFAULT 'manual' | manual/obsidian/hermes |
| created_at | TEXT | NOT NULL | 创建时间 |
| updated_at | TEXT | NOT NULL | 更新时间 |
| completed_at | TEXT | NULL | 完成时间 |
| deleted_at | TEXT | NULL | 软删除时间 |

任务不直接保存 `main/support`，因为角色属于某一天，而不是任务永久属性。

### task_proposals

只记录用户已经确认的 AI 拆解提案，不保存未确认草稿。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| proposal_id | TEXT | PK | StepBeast 本地生成的提案 ID |
| parent_task_id | TEXT | FK, NOT NULL | 被拆解的父任务 |
| summary | TEXT | NOT NULL | 提案摘要 |
| created_at | TEXT | NOT NULL | 用户确认时间 |

同一个 `proposal_id` 重复确认时返回已经创建的子任务，不重复写入。

### daily_plans

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| plan_date | TEXT | UNIQUE, NOT NULL | 本地日期 YYYY-MM-DD |
| energy_level | INTEGER | NULL, CHECK 1..5 | 用户自评能量 |
| note | TEXT | NULL | 当天简短备注 |
| created_at | TEXT | NOT NULL | 创建时间 |
| updated_at | TEXT | NOT NULL | 更新时间 |

### daily_plan_items

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| daily_plan_id | TEXT | FK, NOT NULL | 今日计划 |
| task_id | TEXT | FK, NOT NULL | 任务 |
| role | TEXT | NOT NULL | main/support |
| sort_order | INTEGER | NOT NULL | 同角色排序 |
| created_at | TEXT | NOT NULL | 加入时间 |

唯一约束：`(daily_plan_id, task_id)`。主任务唯一和辅助任务上限由事务内业务规则保证，并用测试覆盖；SQLite trigger 可在稳定后补充。

### daily_plan_proposals

只保存用户已经确认的 Hermes 每日计划提案，未确认预览只存在于界面内存中。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| proposal_id | TEXT | PK | 本地生成的幂等提案 ID |
| request_id | TEXT | NOT NULL | 本次 Hermes 请求 ID |
| plan_date | TEXT | NOT NULL | 提案应用到的本地日期 |
| summary | TEXT | NOT NULL | 计划摘要 |
| reasoning | TEXT | NOT NULL | Hermes 排序理由 |
| main_task_id | TEXT | FK, NOT NULL | 主线任务 |
| support_task_ids_json | TEXT | NOT NULL | 0–2 个辅助任务 ID 的 JSON 数组 |
| confirmed_at | TEXT | NOT NULL | 用户确认时间 |

`proposal_id` 重复确认时直接返回已经应用的计划，不重复修改任务角色或写入审计事件。

### focus_sessions

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| task_id | TEXT | FK, NOT NULL | 对应任务 |
| planned_seconds | INTEGER | NOT NULL | 计划时长 |
| elapsed_seconds | INTEGER | NOT NULL DEFAULT 0 | 已累计时长 |
| status | TEXT | NOT NULL | active/paused/completed/abandoned |
| started_at | TEXT | NOT NULL | 开始时间 |
| active_since | TEXT | NULL | 本轮恢复计时的起点，用于重启后计算真实耗时 |
| paused_at | TEXT | NULL | 暂停时间 |
| ended_at | TEXT | NULL | 结束时间 |
| result_note | TEXT | NULL | 结果说明 |

数据库通过 partial unique index 保证最多一个未结束的 `active/paused` 记录：

```sql
CREATE UNIQUE INDEX one_open_focus_session
ON focus_sessions((1))
WHERE status IN ('active', 'paused');
```

### pet_profiles

V0.1 只有一个宠物档案，但保留主键方便未来切换形象。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| name | TEXT | NOT NULL | 宠物名 |
| level | INTEGER | NOT NULL DEFAULT 1 | 当前等级 |
| total_xp | INTEGER | NOT NULL DEFAULT 0 | 累计经验 |
| emotion | TEXT | NOT NULL DEFAULT 'idle' | 当前情绪 |
| active_mode | INTEGER | NOT NULL DEFAULT 3 | 主动等级 1..3 |
| created_at | TEXT | NOT NULL | 创建时间 |
| updated_at | TEXT | NOT NULL | 更新时间 |

等级是缓存值，可信依据仍为 `total_xp` 与确定性等级公式。

### growth_events

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| pet_id | TEXT | FK, NOT NULL | 宠物 |
| task_id | TEXT | FK, NULL | 来源任务 |
| event_type | TEXT | NOT NULL | task_completed/review_completed/manual_adjustment |
| xp_delta | INTEGER | NOT NULL | 经验变化 |
| reason | TEXT | NOT NULL | 变化原因 |
| created_at | TEXT | NOT NULL | 发生时间 |

V0.1 正常事件不产生负经验。`manual_adjustment` 仅用于数据修复并写入审计事件。
`task_completed` 对 `(task_id, event_type)` 建立唯一索引，防止同一任务重复领取经验。

### settings

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| key | TEXT | PK | 设置键 |
| value_json | TEXT | NOT NULL | JSON 值 |
| updated_at | TEXT | NOT NULL | 更新时间 |

首批设置：窗口位置、置顶、开机启动、主动提醒、晨间时间、晚间时间、默认专注分钟数。

### events

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
| event_type | TEXT | NOT NULL | 事件名称 |
| entity_type | TEXT | NULL | task/focus/pet/setting |
| entity_id | TEXT | NULL | 实体 ID |
| payload_json | TEXT | NOT NULL | 事件快照 |
| created_at | TEXT | NOT NULL | 发生时间 |

事件日志用于恢复、诊断和未来复盘，不作为消息队列，也不无限保存无价值 UI 点击。

### schema_migrations

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| version | INTEGER | PK | 迁移版本 |
| name | TEXT | NOT NULL | 迁移名称 |
| applied_at | TEXT | NOT NULL | 应用时间 |

## 4. 关键事务

### 完成任务

1. 校验任务未完成。
2. 更新 `tasks.status/completed_at`。
3. 汇总 focus 时长到 `actual_minutes`。
4. 插入 `growth_events`。
5. 更新 `pet_profiles.total_xp/level/reward_coins/emotion`。
6. 插入 `events`。
7. 任一步失败则全部回滚。

### 设置今日角色

1. 创建或读取当天 `daily_plans`。
2. 若设置 `main`，先明确替换原主任务。
3. 若设置 `support`，校验当前少于两个。
4. 写入 `daily_plan_items` 和事件日志。

### 确认 AI 每日计划

1. 校验主线和 0–2 个辅助任务 ID 不重复。
2. 校验所有任务仍存在、未删除且未完成。
3. 创建或读取当天 `daily_plans`，整体替换 `daily_plan_items`。
4. 写入 `daily_plan_proposals` 和 `DailyPlanConfirmed` 审计事件。
5. 任一步失败则回滚，保留确认前的完整计划。

### 确认 Obsidian 项目同步

1. 校验项目来源路径、状态、类别和候选稳定键。
2. 按 `source_note_path` 新增或更新项目，不自动删除缺失项目。
3. 只为用户勾选的候选创建任务，并通过 `candidate_key` 去重。
4. 保存确认提案和 `ObsidianProjectSyncConfirmed` 审计事件。
5. 项目、任务、映射或事件任一步失败则整体回滚。

## 5. 等级与奖励

V0.1 使用易理解的固定阶梯：

```text
升级所需累计经验 = 100 × (level - 1) × level / 2
```

基础奖励：

- 15 分钟以内：10 XP
- 16—45 分钟：20 XP
- 46—90 分钟：35 XP
- 90 分钟以上：50 XP

用户可修改建议值，但不允许通过重复完成同一任务重复领奖。

今日主线追加 20 XP，今日辅助追加 5 XP，项目关联追加 10 XP，每 15 分钟真实专注追加 5 XP；单任务最高 100 XP。有效 XP 同额发放步步币，XP 永不消费，步步币只在用户确认兑换现实奖励时扣除。

## 6. 备份与迁移

- 数据文件默认位于 Electron `userData` 目录，而不是仓库。
- 启动迁移前自动创建一份轮换备份。
- 仅保留最近 5 份自动备份，避免长期占用磁盘。
- 导出功能生成用户可选择位置的 SQLite 备份或 JSON；不得静默写入 Obsidian。

## 7. Migration 8：设置、活动与复盘

实现状态：已完成。

- `settings`：保存提醒时间、提醒开关、行为感知、开机启动和主动模式；所有高影响开关默认关闭。
- `activity_usage`：按日期、应用名和分类累计秒数，只保存应用名，不保存窗口标题或内容。
- `daily_reviews`：保存已确认复盘的提案 ID、日期、目标路径和摘要；`proposal_id` 唯一，重复确认不会重复记录。
- `DailyReviewWritten` 事件记录确认结果，不保存 Hermes API Key 或完整无关笔记。

Obsidian 文件与 SQLite 无法共享一个跨系统事务，因此确认采用可恢复顺序：先原子创建新 Markdown，再幂等写入数据库。若数据库暂时失败，重试会识别相同文件内容并继续确认；已有不同内容的文件绝不覆盖。

## 8. Migration 9：成长奖励经济

实现状态：已完成。

- `pet_profiles.reward_coins`：当前可消费步步币余额。
- `growth_events.coin_delta`：每次成长事件同时记录 XP 与步步币变化。
- `reward_goals`：保存奖励名称、类别、步步币门槛、资金目标、资金进度和兑换状态。
- `reward_redemptions`：保存一次性确认兑换记录；同一目标只能兑换一次。
- 大额奖励需要同时满足步步币和真实资金进度；兑换仅记录资格，不连接支付或自动购买。
