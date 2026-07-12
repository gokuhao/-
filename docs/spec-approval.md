# 步步兽 V0.1 规格确认

版本：v0.1  
日期：2026-07-12  
状态：已确认

## 当前 Milestone

Milestone 0：初始化 Electron + React + TypeScript + Vite 项目，先得到一个可以在 Windows 启动的空白桌面窗口。

## 本轮只完成

- 初始化项目与开发脚本。
- 建立 Electron 主进程、preload 安全桥和 React 渲染进程。
- 显示一个可启动的基础窗口。
- 补齐 `.gitignore`、`COMMIT-LOG.md` 和基础测试/构建检查。

本轮不实现透明桌宠、任务、SQLite、Hermes、MCP、Obsidian 或电脑行为感知；这些按后续小任务逐步验收。

## 技术选择与原因

- Electron：Windows 桌面常驻、透明无边框、置顶和托盘能力成熟。
- React：适合把宠物、状态栏和任务面板拆成独立小组件。
- TypeScript：提前发现进程通信和数据结构中的类型错误，降低后期联调成本。
- Vite：步步兽是本地单页桌面 UI，不需要 Next.js 的服务端渲染；Vite 启动更轻。
- Tailwind CSS：保留为 UI 技术边界，但 Milestone 0 只做基础窗口，避免此时投入样式系统。
- SQLite：后续保存实时状态；Milestone 0 暂不接入，避免基础窗口与数据层同时排错。
- 不使用 Prisma：V0.1 的本地表结构可由轻量 repository 管理，避免额外生成器和打包复杂度。

## 默认产品选项

- 正式中文名暂用“步步兽”，英文名使用 `StepBeast`。
- Milestone 0 使用简单占位角色，正式动画素材延后。
- 开机启动默认关闭，用户在设置中主动开启。
- 晨间提醒默认 09:00，晚间复盘默认 21:30，均可关闭和修改。
- 项目目录确定为 `D:\repo\stepbeast`。

## 验收标准

1. 执行 `npm run dev` 能打开 Windows 桌面窗口。
2. Electron 主进程与 React 页面均能正常加载，没有启动报错。
3. 执行构建与类型检查通过。
4. 未提交 `.env`、`node_modules`、构建产物或本地数据库。

## 确认语句

用户已于 2026-07-12 确认开始生成，Milestone 0 代码初始化已启动。
