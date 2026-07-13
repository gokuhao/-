import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("stepBeast", {
  platform: process.platform,
  window: {
    startDrag: (screenX: number, screenY: number) =>
      ipcRenderer.send("pet-window:drag-start", { screenX, screenY }),
    moveDrag: (screenX: number, screenY: number) =>
      ipcRenderer.send("pet-window:drag-move", { screenX, screenY }),
    endDrag: () => ipcRenderer.send("pet-window:drag-end"),
    setExpanded: (expanded: boolean) => ipcRenderer.send("pet-window:set-expanded", expanded),
    close: () => ipcRenderer.send("pet-window:close"),
  },
  tasks: {
    list: () => ipcRenderer.invoke("task:list"),
    create: (input: { title: string; estimatedMinutes?: number | null; nextAction?: string | null }) =>
      ipcRenderer.invoke("task:create", input),
    update: (id: string, input: { title: string; estimatedMinutes?: number | null; nextAction?: string | null }) =>
      ipcRenderer.invoke("task:update", id, input),
    complete: (id: string) => ipcRenderer.invoke("task:complete", id),
    delete: (id: string) => ipcRenderer.invoke("task:delete", id),
  },
  plan: {
    getToday: () => ipcRenderer.invoke("plan:get-today"),
    setRole: (taskId: string, role: "main" | "support" | null) =>
      ipcRenderer.invoke("plan:set-role", taskId, role),
  },
  focus: {
    getCurrent: () => ipcRenderer.invoke("focus:get-current"),
    start: (taskId: string, plannedSeconds: number) => ipcRenderer.invoke("focus:start", taskId, plannedSeconds),
    pause: (id: string) => ipcRenderer.invoke("focus:pause", id),
    resume: (id: string) => ipcRenderer.invoke("focus:resume", id),
    finish: (id: string) => ipcRenderer.invoke("focus:finish", id),
    abandon: (id: string) => ipcRenderer.invoke("focus:abandon", id),
  },
  pet: {
    getProfile: () => ipcRenderer.invoke("pet:get-profile"),
  },
});
