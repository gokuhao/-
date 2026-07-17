import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { FocusRepository } from "./focusRepository.js";
import { HermesClient, type DailyReviewProposal } from "./hermesClient.js";
import { ObsidianReader } from "./obsidianReader.js";
import { ObsidianWriter } from "./obsidianWriter.js";
import { ObsidianProjectService } from "./obsidianProjectService.js";
import { ProjectRepository } from "./projectRepository.js";
import { RewardRepository } from "./rewardRepository.js";
import { TaskRepository } from "./taskRepository.js";
import { RuntimeCoordinator } from "./runtimeCoordinator.js";
import { SystemRepository, type AppSettings } from "./systemRepository.js";
import {
  constrainCollapsedPosition,
  isPointWithinVisiblePet,
  resolveDraggedWindowPosition,
  resolvePetPeekPosition,
  type DockSide,
} from "./windowPosition.js";

const BASE_WINDOW_SIZES = {
  collapsed: { width: 240, height: 260 },
  panel: { width: 430, height: 720 },
  workbench: { width: 900, height: 720 },
} as const;

type SavedWindowState = { x: number; y: number };
type DragSession = {
  offsetX: number;
  offsetY: number;
  startScreenX: number;
  startScreenY: number;
  moved: boolean;
};
type WindowMode = keyof typeof BASE_WINDOW_SIZES;
type AppearanceSettings = Pick<AppSettings, "petScale" | "panelScale">;
type PeekState = { side: DockSide; dockedX: number; peekX: number; peeking: boolean };
type DockUiState = { side: DockSide | null; peeking: boolean };

const dragSessions = new Map<number, DragSession>();
const collapsedPositions = new Map<number, SavedWindowState>();
const windowModes = new Map<number, WindowMode>();
const peekStates = new Map<number, PeekState>();
const peekAnimations = new Map<number, ReturnType<typeof setInterval>>();
const peekHoverMonitors = new Map<number, ReturnType<typeof setInterval>>();
const dockUiStates = new Map<number, DockUiState>();
let appearanceSettings: AppearanceSettings = { petScale: 1, panelScale: 1 };
let taskRepository: TaskRepository | null = null;
let focusRepository: FocusRepository | null = null;
let hermesClient: HermesClient | null = null;
let obsidianReader: ObsidianReader | null = null;
let obsidianProjectService: ObsidianProjectService | null = null;
let projectRepository: ProjectRepository | null = null;
let rewardRepository: RewardRepository | null = null;
let systemRepository: SystemRepository | null = null;
let obsidianWriter: ObsidianWriter | null = null;
let runtimeCoordinator: RuntimeCoordinator | null = null;
let mainWindow: BrowserWindow | null = null;
const pendingReviews = new Map<string, DailyReviewProposal>();

function getWindowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState(): SavedWindowState | null {
  try {
    const value = JSON.parse(fs.readFileSync(getWindowStatePath(), "utf8")) as SavedWindowState;
    return Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
  } catch {
    return null;
  }
}

function saveWindowState(window: BrowserWindow): void {
  const { x, y, width, height } = window.getBounds();
  const collapsedSize = windowSizeForMode("collapsed");
  // 始终换算成收起状态坐标，避免展开面板后退出导致下次启动位置跳动。
  const collapsedPosition = {
    x: Math.round(x + (width - collapsedSize.width) / 2),
    y: y + height - collapsedSize.height,
  };
  collapsedPositions.set(window.id, collapsedPosition);
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(collapsedPosition), "utf8");
  } catch {
    // 位置记忆失败不应该影响桌宠继续运行。
  }
}

function getInitialPosition(): SavedWindowState {
  const collapsedSize = windowSizeForMode("collapsed");
  const saved = readWindowState();
  if (saved) {
    const workArea = screen.getDisplayMatching({ ...saved, ...collapsedSize }).workArea;
    return constrainCollapsedPosition(saved, collapsedSize, workArea);
  }

  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: workArea.x + workArea.width - collapsedSize.width - 28,
    y: workArea.y + workArea.height - collapsedSize.height - 28,
  };
}

function createMainWindow(): void {
  const position = getInitialPosition();
  const collapsedSize = windowSizeForMode("collapsed");
  mainWindow = new BrowserWindow({
    ...collapsedSize,
    ...position,
    title: "步步兽",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // 渲染页面不直接获得 Node.js 权限，后续本地能力统一通过 preload 暴露。
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const windowId = mainWindow.id;
  collapsedPositions.set(windowId, position);
  windowModes.set(windowId, "collapsed");
  mainWindow.webContents.on("did-finish-load", () => publishDockState(mainWindow));

  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.on("closed", () => {
    stopPeekAnimation(windowId);
    stopPeekHoverMonitor(windowId);
    peekStates.delete(windowId);
    dockUiStates.delete(windowId);
    collapsedPositions.delete(windowId);
    windowModes.delete(windowId);
    if (mainWindow?.id === windowId) mainWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function senderWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function windowSizeForMode(mode: WindowMode): { width: number; height: number } {
  const base = BASE_WINDOW_SIZES[mode];
  const scale = mode === "collapsed" ? appearanceSettings.petScale : appearanceSettings.panelScale;
  return { width: Math.round(base.width * scale), height: Math.round(base.height * scale) };
}

function resolveDockUiState(window: BrowserWindow | null): DockUiState {
  if (!window || window.isDestroyed() || windowModes.get(window.id) !== "collapsed") {
    return { side: null, peeking: false };
  }
  const peekState = peekStates.get(window.id);
  if (peekState) return { side: peekState.side, peeking: peekState.peeking };

  const bounds = window.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const docked = resolvePetPeekPosition(bounds, bounds, workArea);
  return { side: docked?.side ?? null, peeking: false };
}

function publishDockState(window: BrowserWindow | null, state = resolveDockUiState(window)): void {
  if (!window || window.isDestroyed()) return;
  const previous = dockUiStates.get(window.id);
  if (previous?.side === state.side && previous.peeking === state.peeking) return;
  dockUiStates.set(window.id, state);
  if (!window.webContents.isDestroyed()) window.webContents.send("pet-window:dock-state-changed", state);
}

function stopPeekAnimation(windowId: number): void {
  const timer = peekAnimations.get(windowId);
  if (timer) clearInterval(timer);
  peekAnimations.delete(windowId);
}

function stopPeekHoverMonitor(windowId: number): void {
  const timer = peekHoverMonitors.get(windowId);
  if (timer) clearInterval(timer);
  peekHoverMonitors.delete(windowId);
}

function retractPeek(window: BrowserWindow, state: PeekState): void {
  state.peeking = false;
  stopPeekHoverMonitor(window.id);
  publishDockState(window, { side: state.side, peeking: false });
  animateWindowX(window, state.dockedX, () => {
    if (!state.peeking) peekStates.delete(window.id);
  });
}

function startPeekHoverMonitor(window: BrowserWindow, state: PeekState): void {
  stopPeekHoverMonitor(window.id);
  let outsideSince: number | null = null;
  const timer = setInterval(() => {
    if (window.isDestroyed() || !state.peeking || peekStates.get(window.id) !== state) {
      stopPeekHoverMonitor(window.id);
      return;
    }
    const bounds = window.getBounds();
    const cursor = screen.getCursorScreenPoint();
    if (isPointWithinVisiblePet(cursor, bounds, bounds, 10)) {
      outsideSince = null;
      return;
    }
    outsideSince ??= Date.now();
    if (Date.now() - outsideSince >= 220) retractPeek(window, state);
  }, 50);
  peekHoverMonitors.set(window.id, timer);
}

function animateWindowX(window: BrowserWindow, targetX: number, onComplete?: () => void): void {
  stopPeekAnimation(window.id);
  const start = window.getBounds();
  if (start.x === targetX) {
    onComplete?.();
    return;
  }

  const startedAt = Date.now();
  const duration = 180;
  const timer = setInterval(() => {
    if (window.isDestroyed()) {
      stopPeekAnimation(window.id);
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    window.setPosition(Math.round(start.x + (targetX - start.x) * eased), start.y);
    if (progress >= 1) {
      stopPeekAnimation(window.id);
      onComplete?.();
    }
  }, 16);
  peekAnimations.set(window.id, timer);
}

function resizeWindowForAppearance(window: BrowserWindow): void {
  const mode = windowModes.get(window.id) ?? "collapsed";
  const current = window.getBounds();
  const workArea = screen.getDisplayMatching(current).workArea;
  const requested = windowSizeForMode(mode);
  const next = {
    width: Math.min(requested.width, workArea.width),
    height: Math.min(requested.height, workArea.height),
  };
  const proposed = {
    x: Math.round(current.x - (next.width - current.width) / 2),
    y: current.y + current.height - next.height,
  };
  const position = mode === "collapsed"
    ? constrainCollapsedPosition(proposed, next, workArea)
    : {
        x: Math.min(Math.max(proposed.x, workArea.x), workArea.x + workArea.width - next.width),
        y: Math.min(Math.max(proposed.y, workArea.y), workArea.y + workArea.height - next.height),
      };
  window.setBounds({ ...position, ...next });
  if (mode === "collapsed") {
    saveWindowState(window);
    publishDockState(window);
  }
}

ipcMain.on("pet-window:drag-start", (event, point: { screenX: number; screenY: number }) => {
  const window = senderWindow(event);
  if (!window || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) return;
  stopPeekAnimation(window.id);
  stopPeekHoverMonitor(window.id);
  const bounds = window.getBounds();
  dragSessions.set(window.id, {
    offsetX: point.screenX - bounds.x,
    offsetY: point.screenY - bounds.y,
    startScreenX: point.screenX,
    startScreenY: point.screenY,
    moved: false,
  });
});

ipcMain.on("pet-window:drag-move", (event, point: { screenX: number; screenY: number }) => {
  const window = senderWindow(event);
  const session = window ? dragSessions.get(window.id) : null;
  if (!window || !session || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) return;
  if (!session.moved) {
    const distance = Math.hypot(point.screenX - session.startScreenX, point.screenY - session.startScreenY);
    if (distance < 5) return;
    session.moved = true;
    peekStates.delete(window.id);
  }
  const bounds = window.getBounds();
  const collapsedSize = windowSizeForMode("collapsed");
  const workArea = screen.getDisplayNearestPoint({ x: point.screenX, y: point.screenY }).workArea;
  const next = resolveDraggedWindowPosition(
    point,
    session,
    bounds,
    workArea,
    bounds.width === collapsedSize.width && bounds.height === collapsedSize.height,
  );
  window.setPosition(next.x, next.y);
  const docked = resolvePetPeekPosition(next, bounds, workArea);
  publishDockState(window, { side: docked?.side ?? null, peeking: false });
});

ipcMain.on("pet-window:drag-end", (event) => {
  const window = senderWindow(event);
  if (!window) return;
  const session = dragSessions.get(window.id);
  dragSessions.delete(window.id);
  const peekState = peekStates.get(window.id);
  if (peekState && !session?.moved) {
    startPeekHoverMonitor(window, peekState);
    return;
  }
  saveWindowState(window);
  publishDockState(window);
});

ipcMain.on("pet-window:set-peeking", (event, peeking: boolean) => {
  const window = senderWindow(event);
  if (!window || windowModes.get(window.id) !== "collapsed" || dragSessions.has(window.id)) return;

  const currentState = peekStates.get(window.id);
  if (currentState) {
    if (!peeking && currentState.peeking) {
      const bounds = window.getBounds();
      if (isPointWithinVisiblePet(screen.getCursorScreenPoint(), bounds, bounds, 10)) return;
    }
    currentState.peeking = peeking;
    if (peeking) {
      publishDockState(window, { side: currentState.side, peeking: true });
      animateWindowX(window, currentState.peekX);
      startPeekHoverMonitor(window, currentState);
    } else {
      retractPeek(window, currentState);
    }
    return;
  }
  if (!peeking) return;

  const bounds = window.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const target = resolvePetPeekPosition(bounds, bounds, workArea);
  if (!target) return;

  const state: PeekState = { side: target.side, dockedX: bounds.x, peekX: target.x, peeking: true };
  peekStates.set(window.id, state);
  publishDockState(window, { side: state.side, peeking: true });
  animateWindowX(window, state.peekX);
  startPeekHoverMonitor(window, state);
});

ipcMain.on("pet-window:set-expanded", (event, expanded: boolean, mode: "panel" | "workbench" = "panel") => {
  const window = senderWindow(event);
  if (!window) return;
  const current = window.getBounds();
  const peekState = peekStates.get(window.id);
  stopPeekAnimation(window.id);
  stopPeekHoverMonitor(window.id);
  peekStates.delete(window.id);
  const workArea = screen.getDisplayMatching(current).workArea;
  const targetMode: WindowMode = expanded ? mode : "collapsed";
  const collapsedSize = windowSizeForMode("collapsed");
  const requested = windowSizeForMode(targetMode);
  const next = {
    width: Math.min(requested.width, workArea.width),
    height: Math.min(requested.height, workArea.height),
  };
  const isCollapsed = current.width === collapsedSize.width && current.height === collapsedSize.height;
  if (expanded && isCollapsed) {
    collapsedPositions.set(window.id, { x: peekState?.dockedX ?? current.x, y: current.y });
  }

  const remembered = !expanded ? collapsedPositions.get(window.id) : null;
  if (remembered) {
    const rememberedWorkArea = screen.getDisplayMatching({ ...remembered, ...collapsedSize }).workArea;
    window.setBounds({
      ...constrainCollapsedPosition(remembered, next, rememberedWorkArea),
      ...next,
    });
  } else {
    const proposedX = Math.round(current.x - (next.width - current.width) / 2);
    const proposedY = current.y - (next.height - current.height);
    window.setBounds({
      // 展开尺寸必须完整显示，只有收起的宠物允许左右裁边。
      x: Math.min(Math.max(proposedX, workArea.x), workArea.x + workArea.width - next.width),
      y: Math.min(Math.max(proposedY, workArea.y), workArea.y + workArea.height - next.height),
      ...next,
    });
  }
  windowModes.set(window.id, targetMode);
  if (!expanded) saveWindowState(window);
  publishDockState(window);
});

ipcMain.handle("pet-window:get-dock-state", (event) => resolveDockUiState(senderWindow(event)));

ipcMain.on("pet-window:close", (event) => {
  senderWindow(event)?.close();
});

ipcMain.handle("task:list", (event) => {
  if (!senderWindow(event)) throw new Error("无效的任务读取请求");
  return taskRepository?.list() ?? [];
});

ipcMain.handle("task:create", (event, input: { title: string; estimatedMinutes?: number | null; nextAction?: string | null }) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("任务系统尚未准备好");
  return taskRepository.create(input);
});

ipcMain.handle("task:update", (event, id: string, input: { title: string; estimatedMinutes?: number | null; nextAction?: string | null }) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("任务系统尚未准备好");
  return taskRepository.update(id, input);
});

ipcMain.handle("task:complete", (event, id: string) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("任务系统尚未准备好");
  return taskRepository.complete(id);
});

ipcMain.handle("task:delete", (event, id: string) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("任务系统尚未准备好");
  taskRepository.remove(id);
});

ipcMain.handle("task:confirm-decomposition", (event, parentTaskId: string, proposal) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("任务系统尚未准备好");
  return taskRepository.confirmDecomposition(parentTaskId, proposal);
});

ipcMain.handle("plan:get-today", (event) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("今日计划尚未准备好");
  return taskRepository.getTodayPlan();
});

ipcMain.handle("plan:set-role", (event, taskId: string, role: "main" | "support" | null) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("今日计划尚未准备好");
  return taskRepository.setTodayRole(taskId, role);
});

ipcMain.handle("plan:confirm-proposal", (event, proposal) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("今日计划尚未准备好");
  return taskRepository.confirmDailyPlan(proposal);
});

ipcMain.handle("pet:get-profile", (event) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("宠物成长系统尚未准备好");
  return taskRepository.getPetProfile();
});

ipcMain.handle("hermes:get-status", (event) => {
  if (!senderWindow(event) || !hermesClient) throw new Error("Hermes Gateway 尚未准备好");
  return hermesClient.getStatus();
});

ipcMain.handle("hermes:decompose-task", (event, task) => {
  if (!senderWindow(event) || !hermesClient) throw new Error("Hermes Gateway 尚未准备好");
  return hermesClient.decomposeTask(task);
});

ipcMain.handle("hermes:generate-daily-plan", (event) => {
  if (!senderWindow(event) || !hermesClient || !taskRepository) {
    throw new Error("Hermes 每日计划尚未准备好");
  }
  return hermesClient.generateDailyPlan(taskRepository.getPlanningCandidates());
});

ipcMain.handle("obsidian:get-status", (event) => {
  if (!senderWindow(event) || !obsidianReader) throw new Error("Obsidian 读取器尚未准备好");
  return obsidianReader.getStatus();
});

ipcMain.handle("obsidian:list-notes", (event) => {
  if (!senderWindow(event) || !obsidianReader) throw new Error("Obsidian 读取器尚未准备好");
  return obsidianReader.listNotes();
});

ipcMain.handle("obsidian:read-note", (event, relativePath: string) => {
  if (!senderWindow(event) || !obsidianReader) throw new Error("Obsidian 读取器尚未准备好");
  return obsidianReader.readNote(relativePath);
});

ipcMain.handle("obsidian:propose-project-sync", (event) => {
  if (!senderWindow(event) || !obsidianProjectService) throw new Error("Obsidian 项目读取器尚未准备好");
  return obsidianProjectService.generateProposal();
});

ipcMain.handle("project:list", (event) => {
  if (!senderWindow(event) || !projectRepository) throw new Error("项目系统尚未准备好");
  return projectRepository.list();
});

ipcMain.handle("project:confirm-sync", (event, proposal, selectedCandidateKeys: string[]) => {
  if (!senderWindow(event) || !projectRepository) throw new Error("项目系统尚未准备好");
  return projectRepository.confirmSync({ proposal, selectedCandidateKeys });
});

ipcMain.handle("reward:get-summary", (event) => {
  if (!senderWindow(event) || !rewardRepository) throw new Error("成长奖励系统尚未准备好");
  return rewardRepository.getSummary();
});

ipcMain.handle("reward:create-goal", (event, input) => {
  if (!senderWindow(event) || !rewardRepository) throw new Error("成长奖励系统尚未准备好");
  return rewardRepository.createGoal(input);
});

ipcMain.handle("reward:update-funding", (event, goalId: string, fundCurrentYuan: number) => {
  if (!senderWindow(event) || !rewardRepository) throw new Error("成长奖励系统尚未准备好");
  return rewardRepository.updateFunding(goalId, fundCurrentYuan);
});

ipcMain.handle("reward:redeem", (event, goalId: string) => {
  if (!senderWindow(event) || !rewardRepository) throw new Error("成长奖励系统尚未准备好");
  return rewardRepository.redeem(goalId);
});

ipcMain.handle("settings:get", (event) => {
  if (!senderWindow(event) || !systemRepository) throw new Error("设置系统尚未准备好");
  return systemRepository.getSettings();
});

ipcMain.handle("settings:update", (event, input) => {
  const window = senderWindow(event);
  if (!window || !systemRepository) throw new Error("设置系统尚未准备好");
  const settings = systemRepository.updateSettings(input);
  appearanceSettings = { petScale: settings.petScale, panelScale: settings.panelScale };
  resizeWindowForAppearance(window);
  window.webContents.send("settings:changed", settings);
  // 开发模式不写 Windows 开机启动项，避免调试版本污染系统设置。
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.autoLaunch });
  return settings;
});

ipcMain.handle("activity:get-summary", (event, days: number) => {
  if (!senderWindow(event) || !systemRepository) throw new Error("活动统计尚未准备好");
  return systemRepository.getUsageSummary(days);
});

ipcMain.handle("review:propose", async (event) => {
  if (!senderWindow(event) || !systemRepository || !hermesClient) throw new Error("每日复盘尚未准备好");
  const proposal = await hermesClient.generateDailyReview(systemRepository.getDailyFacts());
  pendingReviews.set(proposal.proposalId, proposal);
  return proposal;
});

ipcMain.handle("review:confirm", async (event, proposalId: string) => {
  if (!senderWindow(event) || !systemRepository || !obsidianWriter) throw new Error("每日复盘尚未准备好");
  const proposal = pendingReviews.get(proposalId);
  if (!proposal) throw new Error("复盘提案已失效，请重新生成并预览");
  const writeResult = await obsidianWriter.writeNewMarkdown(proposal.targetPath, proposal.content);
  const review = systemRepository.confirmReview({
    proposalId: proposal.proposalId,
    reviewDate: proposal.reviewDate,
    targetPath: proposal.targetPath,
    summary: proposal.summary,
  });
  pendingReviews.delete(proposalId);
  return { review, writeResult };
});

ipcMain.handle("review:list", (event) => {
  if (!senderWindow(event) || !systemRepository) throw new Error("每日复盘尚未准备好");
  return systemRepository.listReviews();
});

ipcMain.handle("chat:send", (event, message: string) => {
  if (!senderWindow(event) || !hermesClient || !taskRepository || !projectRepository || !systemRepository) {
    throw new Error("步步兽对话尚未准备好");
  }
  const tasks = taskRepository.list().filter((task) => task.status === "todo" || task.status === "doing").slice(0, 20);
  const projects = projectRepository.list().slice(0, 15);
  return hermesClient.chat(message, {
    activeTasks: tasks.map((task) => ({ title: task.title, status: task.status })),
    projects: projects.map((project) => ({ name: project.name, status: project.status, currentStage: project.currentStage })),
    recentReview: systemRepository.listReviews(1)[0]?.summary ?? null,
  });
});

ipcMain.handle("coo:analyze", (event) => {
  if (!senderWindow(event) || !hermesClient || !taskRepository || !projectRepository || !systemRepository) {
    throw new Error("AI COO 尚未准备好");
  }
  const tasks = taskRepository.list();
  const facts = systemRepository.getDailyFacts();
  const usage = systemRepository.getUsageSummary(7);
  return hermesClient.analyzeCoo({
    completedTaskCount: tasks.filter((task) => task.status === "completed").length,
    unfinishedTaskCount: tasks.filter((task) => task.status === "todo" || task.status === "doing").length,
    focusMinutes: facts.focusMinutes,
    usageByCategory: usage.byCategory,
    projects: projectRepository.list().map((project) => ({
      name: project.name,
      status: project.status,
      category: project.category,
      currentStage: project.currentStage,
    })),
  });
});

ipcMain.handle("focus:get-current", (event) => {
  if (!senderWindow(event) || !focusRepository) throw new Error("专注系统尚未准备好");
  return focusRepository.getCurrent();
});

ipcMain.handle("focus:start", (event, taskId: string, plannedSeconds: number) => {
  if (!senderWindow(event) || !focusRepository) throw new Error("专注系统尚未准备好");
  return focusRepository.start(taskId, plannedSeconds);
});

ipcMain.handle("focus:pause", (event, id: string) => {
  if (!senderWindow(event) || !focusRepository) throw new Error("专注系统尚未准备好");
  return focusRepository.pause(id);
});

ipcMain.handle("focus:resume", (event, id: string) => {
  if (!senderWindow(event) || !focusRepository) throw new Error("专注系统尚未准备好");
  return focusRepository.resume(id);
});

ipcMain.handle("focus:finish", (event, id: string) => {
  if (!senderWindow(event) || !focusRepository) throw new Error("专注系统尚未准备好");
  return focusRepository.finish(id);
});

ipcMain.handle("focus:abandon", (event, id: string) => {
  if (!senderWindow(event) || !focusRepository) throw new Error("专注系统尚未准备好");
  return focusRepository.abandon(id);
});

app.whenReady().then(() => {
  try {
    process.loadEnvFile(path.join(app.getAppPath(), ".env"));
  } catch {
    // .env 是可选的；没有 AI 配置时本地任务、专注和成长仍然可用。
  }
  const databasePath = path.join(app.getPath("userData"), "pet.db");
  taskRepository = new TaskRepository(databasePath);
  focusRepository = new FocusRepository(databasePath);
  hermesClient = new HermesClient();
  obsidianReader = new ObsidianReader();
  obsidianProjectService = new ObsidianProjectService(obsidianReader);
  projectRepository = new ProjectRepository(databasePath);
  systemRepository = new SystemRepository(databasePath);
  rewardRepository = new RewardRepository(databasePath);
  const settings = systemRepository.getSettings();
  appearanceSettings = { petScale: settings.petScale, panelScale: settings.panelScale };
  obsidianWriter = new ObsidianWriter();
  createMainWindow();
  runtimeCoordinator = new RuntimeCoordinator({
    repository: systemRepository,
    onReminder: (message) => mainWindow?.webContents.send("runtime:reminder", message),
  });
  runtimeCoordinator.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  runtimeCoordinator?.stop();
  runtimeCoordinator = null;
  pendingReviews.clear();
  obsidianWriter = null;
  rewardRepository?.close();
  rewardRepository = null;
  systemRepository?.close();
  systemRepository = null;
  projectRepository?.close();
  projectRepository = null;
  obsidianProjectService = null;
  obsidianReader = null;
  hermesClient = null;
  focusRepository?.close();
  focusRepository = null;
  taskRepository?.close();
  taskRepository = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
