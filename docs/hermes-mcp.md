# Hermes 与 MCP 工具调用设计

版本：v0.1-spec  
启用阶段：V0.2 起  
状态：Task 5.1 已确认并实现

## 0. 本机 Hermes 能力审计（2026-07-14）

- 已安装版本：Hermes Agent v0.15.1。
- Gateway 后台进程正常运行。
- 原生 API Server Adapter 已包含在 Hermes 中，无需自建 FastAPI 服务。
- 默认监听：`http://127.0.0.1:8642`。
- 健康检查：`GET /health`，无需认证。
- 普通对话：`POST /v1/chat/completions`，OpenAI-compatible 格式。
- 长任务：`POST /v1/runs`，进度通过 SSE 读取。
- 认证：`Authorization: Bearer API_SERVER_KEY`；即使只监听 loopback 也必须配置 Key。
- 当前外部状态：Gateway、API Server 和 Bearer 认证均已启用，StepBeast 显示 `Hermes 已连接`。

StepBeast 使用 `STEPBEAST_HERMES_URL` 和 `STEPBEAST_HERMES_API_KEY` 读取连接配置；真实密钥只保存在 `.env`，不得提交 Git。

最小对话连通测试已成功返回 Hermes 回复，但模型没有严格遵循“只输出固定标记”的要求。因此任务拆解和每日规划必须采用结构化 JSON 校验、有限重试和提案确认，不能把未经验证的自然语言直接写入 SQLite。

## 1. 系统职责

```text
桌宠：交互与反馈
Hermes：理解、规划、编排与长任务执行
MCP/工具适配层：受权限控制的具体能力
SQLite：实时任务真源
Obsidian：长期记忆真源
```

Hermes 不直接接管桌宠数据库，也不把自己的内部记忆复制成步步兽数据库。双方通过稳定协议交换任务上下文、提案和执行结果。

## 2. 通信方案

- 普通请求：localhost HTTP。原因是实现简单、容易测试和重试。
- 流式回复与长任务进度：WebSocket 或 SSE。具体采用 Hermes 当前已有接口，避免重复实现网关。
- 进程发现：设置页配置地址并提供健康检查；V0.2 不默认自动下载或修改 Hermes。

原生端点：

```text
GET  /health
POST /v1/chat/completions
POST /v1/responses
POST /v1/runs
GET  /v1/runs/{run_id}
GET  /v1/runs/{run_id}/events
```

所有请求携带 `request_id`，写操作提案携带 `proposal_id`，避免重试造成重复创建。

## 3. 工具分类

### Task Tools（V0.2）

- `task.list`
- `task.get`
- `task.propose_create`
- `task.create_confirmed`
- `task.propose_update`
- `task.update_confirmed`
- `plan.get_today`

Hermes 先生成 proposal；桌宠展示差异；用户确认后才调用 confirmed 工具。

### Pet Tools（V0.2）

- `pet.get_status`
- `pet.set_mode`
- `pet.propose_message`

经验增加只能由可信业务事件触发，Hermes 不能任意发放经验。

### Obsidian Tools（V0.3）

- `obsidian.search_notes`
- `obsidian.read_note`
- `obsidian.propose_patch`
- `obsidian.apply_confirmed_patch`

必须配置 vault 与允许访问的子目录。工具使用相对路径，经过规范化后验证仍在白名单目录内。

### System Tools（V1.0）

- `system.get_active_app`
- `system.get_usage_summary`
- `system.propose_open_app`
- `system.open_app_confirmed`

V1.0 不提供通用 shell 工具给模型，不读取键盘输入，不默认截屏。

## 4. 权限等级

| 等级 | 规则 | 示例 |
|---|---|---|
| P0 | 本地自动读取 | 查询今日任务、宠物状态 |
| P1 | 首次授权后读取 | 读取指定 Obsidian 目录 |
| P2 | 每次确认 | 创建任务、写复盘、打开应用 |
| P3 | 强确认并展示影响 | 批量修改、覆盖、删除、外部发送 |

权限按工具和作用域保存。用户可以随时撤销，不提供“永久允许所有文件”选项。

## 5. 标准工具结果

```json
{
  "request_id": "uuid",
  "ok": true,
  "data": {},
  "error": null,
  "audit": {
    "tool": "task.list",
    "permission": "P0",
    "duration_ms": 12
  }
}
```

工具错误必须区分：`UNAVAILABLE`、`UNAUTHORIZED`、`INVALID_INPUT`、`CONFLICT`、`TIMEOUT` 和 `INTERNAL_ERROR`。

## 6. 典型流程

### “今天应该做什么？”

1. 桌宠读取 SQLite 的任务候选和今日可用时间。
2. Hermes 按需读取允许的活跃项目摘要。
3. Hermes 返回 1+2 计划提案、原因和预计总时长。
4. 用户确认后，桌宠写入 `daily_plan_items`。

### “总结今天”

1. 读取当天任务、专注记录和用户补充感受。
2. Hermes 生成事实与建议分开的复盘草稿。
3. 桌宠展示目标 Obsidian 路径和完整差异。
4. 用户确认后写入；写入结果记录到审计日志。

### “开始写脚本”

1. 用户选择已有任务或确认新任务草案。
2. 桌宠开始计时。
3. 如用户允许，Hermes 提议打开指定应用。
4. 专注期间不继续调用规划工具。

## 7. Obsidian 同步策略

- SQLite → Obsidian：每日复盘、项目阶段变化、重要决策。
- Obsidian → SQLite：活跃项目及明确标记的下一步，仅生成候选，不静默覆盖本地任务。
- 冲突处理：同时变化时保留两份，显示差异，由用户选择。
- 每条同步记录来源路径、内容摘要哈希和同步时间。

## 8. 安全要求

- Gateway 只监听 loopback，除非用户明确配置局域网访问。
- 使用短期 token 或 OS 安全存储，不把凭证写进普通配置文件。
- 对 prompt injection：外部笔记内容标记为数据，不允许其改变系统规则或工具权限。
- 工具输入做 Schema 校验、路径校验、超时和大小限制。
- 工具调用日志不保存 API Key、完整敏感正文或无关个人信息。

## 9. 失败降级

- Hermes 离线：任务、计时和成长继续使用，AI 入口显示离线状态。
- Obsidian 不可访问：保留待同步草稿，不阻塞本地复盘。
- AI 返回格式错误：保留原回复并提示重试，不执行任何工具。
- 长任务超时：允许取消，不能让桌宠窗口冻结。

## 10. 实现顺序

1. 对当前 Hermes 安装做只读能力审计。
2. 实现健康检查和最小 chat adapter。
3. 接入只读 Task Tools。
4. 加入 proposal/confirm 写入闭环。
5. 最后接入 Obsidian 白名单读写。

## 11. Task 5.2 任务拆解契约

输入只发送当前任务的必要字段，不发送数据库文件、历史聊天或无关笔记：

```json
{
  "request_id": "uuid",
  "task": {
    "id": "uuid",
    "title": "完成视频脚本",
    "estimated_minutes": 45,
    "next_action": null
  }
}
```

Hermes 必须返回提案，不能直接修改任务：

```json
{
  "proposal_id": "uuid",
  "summary": "把脚本拆成四个连续动作",
  "steps": [
    {
      "title": "确定主题和目标观众",
      "estimated_minutes": 10,
      "done_when": "写出一句主题和一句目标观众描述"
    }
  ]
}
```

StepBeast 校验：`steps` 为 1–8 项、每项标题非空、预计时间为 1–240 分钟、完成标准非空。校验失败最多重试一次；仍失败则只展示原始回复，不写入 SQLite。用户明确确认提案后才能创建子任务。

在第 1 步完成前，不提前确定 Hermes 的端口、认证格式或 WebSocket 协议。
