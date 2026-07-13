# 步步兽数据库 Schema 设计

版本：v0.1-spec  
数据库：SQLite  
状态：待确认

## 1. 设计原则

- SQLite 是运行时状态的唯一真源。
- 时间统一保存为带时区的 ISO 8601 UTC 字符串，展示时转换为本地时区。
- 主键使用 UUID 字符串，避免未来同步时重新编号。
- 删除优先使用状态或 `deleted_at`，避免破坏成长与复盘历史。
- 任务完成、经验奖励和事件日志必须在同一事务中提交。

## 2. V0.1 表关系

```text
projects 1 ─── * tasks
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
| color | TEXT | NULL | UI 标识色 |
| created_at | TEXT | NOT NULL | 创建时间 |
| updated_at | TEXT | NOT NULL | 更新时间 |
| deleted_at | TEXT | NULL | 软删除时间 |

### tasks

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT | PK | UUID |
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
5. 更新 `pet_profiles.total_xp/level/emotion`。
6. 插入 `events`。
7. 任一步失败则全部回滚。

### 设置今日角色

1. 创建或读取当天 `daily_plans`。
2. 若设置 `main`，先明确替换原主任务。
3. 若设置 `support`，校验当前少于两个。
4. 写入 `daily_plan_items` 和事件日志。

## 5. 等级与奖励

V0.1 使用易理解的固定阶梯：

```text
升级所需累计经验 = 100 × (level - 1) × level / 2
```

建议奖励：

- 15 分钟以内：10 XP
- 16—45 分钟：20 XP
- 46—90 分钟：35 XP
- 90 分钟以上：50 XP

用户可修改建议值，但不允许通过重复完成同一任务重复领奖。

## 6. 备份与迁移

- 数据文件默认位于 Electron `userData` 目录，而不是仓库。
- 启动迁移前自动创建一份轮换备份。
- 仅保留最近 5 份自动备份，避免长期占用磁盘。
- 导出功能生成用户可选择位置的 SQLite 备份或 JSON；不得静默写入 Obsidian。

## 7. V0.2 以后新增表

后续按实际需要新增 `conversations`、`reviews`、`sync_jobs` 与 `tool_permissions`。V0.1 不提前创建空表。
