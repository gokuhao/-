# 步步兽技术架构设计

版本：v0.1-spec  
状态：待确认

## 1. 架构目标

- Windows 本地稳定运行，支持透明悬浮桌宠。
- 核心任务功能离线可用，AI 服务不可用时不影响计时与记录。
- 实时状态、AI 调度和长期知识各自独立，避免数据职责混乱。
- 每个阶段可以单独验收，不为了未来能力提前搭建复杂框架。

## 2. 技术选择及原因

### Electron

用于 Windows 桌面外壳。它原生支持透明无边框窗口、置顶、托盘、开机启动、IPC 和本地文件访问，能够最快验证桌宠交互。代价是安装包和内存比 Tauri 大，但 V0.1 更看重生态成熟和调试成本低。

### React + TypeScript

React 用于把宠物、任务面板、计时器和设置拆成小组件；TypeScript 在任务状态、IPC 消息和数据库字段变化时提供类型检查，减少运行期错误。

### Vite

本项目是本地单页桌面 UI，不需要 Next.js 的 SSR、路由服务和部署能力。Vite 启动快、配置少，适合作为 Electron renderer 的构建工具。

### Tailwind CSS

用于面板布局和状态样式，减少散落 CSS。宠物动画本身不依赖 Tailwind，避免视觉资产与 UI 框架耦合。

### SQLite

单用户、本地优先、无需后台数据库服务，且事务适合保证“完成任务、增加经验、记录事件”同时成功或同时失败。

### 暂不使用 ORM

V0.1 只有少量表。先用轻量数据库驱动和 repository 层能减少打包与 native module 复杂度。进入 V0.3 前根据查询复杂度重新评估 Drizzle，而不是预先引入 Prisma。

## 3. 进程边界

```text
Electron Main Process
├─ Window Manager       透明窗口、位置、置顶、托盘
├─ IPC Handlers         校验 renderer 请求
├─ Task Service         任务与今日计划业务规则
├─ Focus Service        计时状态与恢复
├─ Pet Service          经验、等级、情绪
└─ SQLite Repositories  数据持久化

Electron Renderer
├─ Pet Avatar
├─ Task Panel
├─ Focus Timer
├─ Growth Feedback
└─ Settings

Future Local Services
├─ Hermes Gateway Client
└─ Obsidian Sync Adapter
```

Renderer 不直接访问 Node.js、数据库或任意文件系统。所有本地能力通过 preload 暴露的白名单 API 调用 main process。

## 4. 推荐目录

```text
stepbeast/
├── electron/
│   ├── main/
│   │   ├── windows/
│   │   ├── ipc/
│   │   └── services/
│   └── preload/
├── src/
│   ├── components/
│   ├── features/
│   │   ├── pet/
│   │   ├── tasks/
│   │   ├── focus/
│   │   └── settings/
│   ├── lib/
│   └── styles/
├── data/                 # 本地运行数据，不提交
├── assets/
│   └── pet/
├── docs/
├── tests/
├── prd.md
├── README.md
├── AGENTS.md
├── COMMIT-LOG.md
├── start-frontend.bat
└── .env.example
```

Electron 应用没有独立 HTTP 后端，因此 V0.1 的 `start-frontend.bat` 负责启动整个开发应用，不创建无意义的 `start-backend.bat`。进入 Hermes 阶段后再增加后台服务启动脚本。

## 5. 核心模块

### Window Manager

- 创建透明无边框宠物窗口。
- 保存并恢复窗口位置。
- 防止窗口移动到已断开的屏幕之外。
- 控制置顶、任务栏显示与托盘行为。

### Task Service

- 创建、修改、取消和完成任务。
- 保证每天最多 1 个 `main`、2 个 `support`。
- 任务完成时在单个事务内更新任务、成长与事件。

### Focus Service

- 同一时间只允许一个 active session。
- 持久化 `started_at` 和 `remaining_seconds`，应用重启后可恢复。
- renderer 负责显示动画，main process 保存可信状态。

### Pet Service

- 根据成长事件计算经验和等级。
- 根据明确事件更新情绪，不使用不透明 AI 判断。
- 情绪规则可配置、可测试。

### Event Dispatcher

V0.1 使用进程内事件分发，不引入消息队列。事件用于解耦任务完成与成长反馈，但最终数据更新仍由数据库事务保证一致性。

## 6. IPC 设计原则

命名采用 `领域:动作`：

```text
task:list
task:create
task:update
task:complete
plan:getToday
plan:setRole
focus:start
focus:pause
focus:resume
focus:finish
pet:getStatus
settings:get
settings:update
```

所有输入必须在 main process 再校验一次。返回统一结果：

```ts
type AppResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

## 7. 安全边界

- `contextIsolation: true`。
- `nodeIntegration: false`。
- renderer 不获得通用 shell、文件和数据库权限。
- 外部链接交给系统浏览器，并校验协议。
- API Key 不进入 renderer、不写入日志、不提交 Git。
- V0.1 不监听键盘内容、不截屏、不采集浏览历史。

## 8. 数据流

### 完成任务

```text
用户确认完成
→ renderer 调用 task:complete
→ main 校验任务状态
→ SQLite 事务：任务完成 + 成长事件 + 审计事件
→ Pet Service 计算新状态
→ renderer 展示经验与动画
```

### 应用重启恢复计时

```text
应用启动
→ Focus Service 查询 active session
→ 根据 started_at、pause 状态与当前时间计算剩余秒数
→ 恢复计时或提示用户确认结束
```

## 9. 后续集成边界

### Hermes

通过 localhost HTTP 做请求响应，通过 WebSocket/SSE 接收长任务进度。桌宠不直接嵌入 Hermes 内部代码，避免两边升级互相锁死。

### Obsidian

通过 `STEPBEAST_OBSIDIAN_VAULT_PATH` 配置用户明确授权的 Vault。所有访问都经过独立 adapter；数据库层不依赖 Markdown 文件结构。

Task 6.1 已实现只读索引：

- 启动时验证根目录真实路径和 `.obsidian` 标记，避免把普通目录误当 Vault。
- 授权范围可以覆盖整个 Vault，但自动排除 `.obsidian`、`.trash`、`.git`、`.agents`、`.codex`、`.sync` 和 `node_modules`。
- 跳过符号链接；读取单篇笔记前同时校验规范化路径和 `realpath`，阻止 `../` 与链接越界。
- 只索引 `.md`，最多 5000 篇；摘要只读取前 64 KiB，单篇完整读取上限 2 MiB。
- 解析标题、简单 YAML frontmatter、标签、相对目录、修改时间和文件大小。
- Electron renderer 只能通过 preload 白名单调用只读 `getStatus/listNotes/readNote`，没有写文件接口。

后续写入复盘或项目状态时仍必须新增独立的 proposal/confirm 流程，Task 6.1 的“允许读取全部范围”不等于授权写入。

### 宠物动画

V0.1 可先用简单占位动画验证交互。正式 Codex-compatible 宠物资产作为独立制作任务，使用 v2 8×11 图集和独立 QA，不阻塞任务系统开发。

## 10. 测试策略

- 单元测试：1+2 规则、状态流转、经验计算、计时恢复。
- Repository 测试：使用临时 SQLite 数据库验证事务和迁移。
- Obsidian 测试：使用临时 Vault 验证 Markdown 元数据、忽略目录和路径越界保护。
- 组件测试：任务创建、计时按钮、错误提示。
- 冒烟测试：Windows 启动、透明窗口、拖动、重启恢复。
- 构建测试：每个 Milestone 完成前必须执行 production build。
