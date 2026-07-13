import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { TaskRepository } from "./taskRepository.js";

const COLLAPSED_SIZE = { width: 240, height: 260 };
const EXPANDED_SIZE = { width: 380, height: 620 };

type SavedWindowState = { x: number; y: number };
type DragSession = { offsetX: number; offsetY: number };

const dragSessions = new Map<number, DragSession>();
let taskRepository: TaskRepository | null = null;

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
  // 始终换算成收起状态坐标，避免展开面板后退出导致下次启动位置跳动。
  const collapsedPosition = {
    x: Math.round(x + (width - COLLAPSED_SIZE.width) / 2),
    y: y + height - COLLAPSED_SIZE.height,
  };
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(collapsedPosition), "utf8");
  } catch {
    // 位置记忆失败不应该影响桌宠继续运行。
  }
}

function getInitialPosition(): SavedWindowState {
  const saved = readWindowState();
  if (saved) return saved;

  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: workArea.x + workArea.width - COLLAPSED_SIZE.width - 28,
    y: workArea.y + workArea.height - COLLAPSED_SIZE.height - 28,
  };
}

function createMainWindow(): void {
  const position = getInitialPosition();
  const mainWindow = new BrowserWindow({
    ...COLLAPSED_SIZE,
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

  mainWindow.setAlwaysOnTop(true, "floating");

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

ipcMain.on("pet-window:drag-start", (event, point: { screenX: number; screenY: number }) => {
  const window = senderWindow(event);
  if (!window || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) return;
  const bounds = window.getBounds();
  dragSessions.set(window.id, {
    offsetX: point.screenX - bounds.x,
    offsetY: point.screenY - bounds.y,
  });
});

ipcMain.on("pet-window:drag-move", (event, point: { screenX: number; screenY: number }) => {
  const window = senderWindow(event);
  const session = window ? dragSessions.get(window.id) : null;
  if (!window || !session || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) return;
  window.setPosition(
    Math.round(point.screenX - session.offsetX),
    Math.round(point.screenY - session.offsetY),
  );
});

ipcMain.on("pet-window:drag-end", (event) => {
  const window = senderWindow(event);
  if (!window) return;
  dragSessions.delete(window.id);
  saveWindowState(window);
});

ipcMain.on("pet-window:set-expanded", (event, expanded: boolean) => {
  const window = senderWindow(event);
  if (!window) return;
  const current = window.getBounds();
  const next = expanded ? EXPANDED_SIZE : COLLAPSED_SIZE;
  window.setBounds({
    x: Math.round(current.x - (next.width - current.width) / 2),
    y: current.y - (next.height - current.height),
    ...next,
  });
  saveWindowState(window);
});

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

ipcMain.handle("plan:get-today", (event) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("今日计划尚未准备好");
  return taskRepository.getTodayPlan();
});

ipcMain.handle("plan:set-role", (event, taskId: string, role: "main" | "support" | null) => {
  if (!senderWindow(event) || !taskRepository) throw new Error("今日计划尚未准备好");
  return taskRepository.setTodayRole(taskId, role);
});

app.whenReady().then(() => {
  taskRepository = new TaskRepository(path.join(app.getPath("userData"), "pet.db"));
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  taskRepository?.close();
  taskRepository = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
