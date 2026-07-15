import { contextBridge, ipcRenderer } from "electron";

type DecompositionProposal = {
  proposalId: string;
  requestId: string;
  taskId: string;
  summary: string;
  steps: Array<{ title: string; estimatedMinutes: number; doneWhen: string }>;
  attempts: number;
};

type DailyPlanProposal = {
  proposalId: string;
  requestId: string;
  summary: string;
  reasoning: string;
  mainTaskId: string;
  supportTaskIds: string[];
  attempts: number;
};

type ObsidianProjectProposal = {
  proposalId: string;
  projectIndexPath: string;
  summary: string;
  projects: Array<{
    sourcePath: string;
    name: string;
    status: "active" | "testing" | "paused" | "completed" | "archived";
    category: "current" | "support" | "paused";
    goal: string | null;
    currentStage: string | null;
    sourceModifiedAt: string;
  }>;
  taskCandidates: Array<{
    candidateKey: string;
    projectSourcePath: string;
    projectName: string;
    title: string;
    estimatedMinutes: number;
    sourcePath: string;
  }>;
};

contextBridge.exposeInMainWorld("stepBeast", {
  platform: process.platform,
  window: {
    startDrag: (screenX: number, screenY: number) =>
      ipcRenderer.send("pet-window:drag-start", { screenX, screenY }),
    moveDrag: (screenX: number, screenY: number) =>
      ipcRenderer.send("pet-window:drag-move", { screenX, screenY }),
    endDrag: () => ipcRenderer.send("pet-window:drag-end"),
    setPeeking: (peeking: boolean) => ipcRenderer.send("pet-window:set-peeking", peeking),
    setExpanded: (expanded: boolean, mode: "panel" | "workbench" = "panel") =>
      ipcRenderer.send("pet-window:set-expanded", expanded, mode),
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
    confirmDecomposition: (parentTaskId: string, proposal: DecompositionProposal) =>
      ipcRenderer.invoke("task:confirm-decomposition", parentTaskId, proposal),
  },
  plan: {
    getToday: () => ipcRenderer.invoke("plan:get-today"),
    setRole: (taskId: string, role: "main" | "support" | null) =>
      ipcRenderer.invoke("plan:set-role", taskId, role),
    confirmProposal: (proposal: DailyPlanProposal) =>
      ipcRenderer.invoke("plan:confirm-proposal", proposal),
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
  hermes: {
    getStatus: () => ipcRenderer.invoke("hermes:get-status"),
    decomposeTask: (task: { id: string; title: string; estimatedMinutes: number | null; nextAction: string | null }) =>
      ipcRenderer.invoke("hermes:decompose-task", task),
    generateDailyPlan: () => ipcRenderer.invoke("hermes:generate-daily-plan"),
  },
  obsidian: {
    getStatus: () => ipcRenderer.invoke("obsidian:get-status"),
    listNotes: () => ipcRenderer.invoke("obsidian:list-notes"),
    readNote: (relativePath: string) => ipcRenderer.invoke("obsidian:read-note", relativePath),
    proposeProjectSync: () => ipcRenderer.invoke("obsidian:propose-project-sync"),
  },
  projects: {
    list: () => ipcRenderer.invoke("project:list"),
    confirmSync: (proposal: ObsidianProjectProposal, selectedCandidateKeys: string[]) =>
      ipcRenderer.invoke("project:confirm-sync", proposal, selectedCandidateKeys),
  },
  rewards: {
    getSummary: () => ipcRenderer.invoke("reward:get-summary"),
    createGoal: (input: unknown) => ipcRenderer.invoke("reward:create-goal", input),
    updateFunding: (goalId: string, fundCurrentYuan: number) =>
      ipcRenderer.invoke("reward:update-funding", goalId, fundCurrentYuan),
    redeem: (goalId: string) => ipcRenderer.invoke("reward:redeem", goalId),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (input: unknown) => ipcRenderer.invoke("settings:update", input),
    onChanged: (callback: (settings: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: unknown) => callback(settings);
      ipcRenderer.on("settings:changed", listener);
      return () => ipcRenderer.removeListener("settings:changed", listener);
    },
  },
  activity: {
    getSummary: (days = 7) => ipcRenderer.invoke("activity:get-summary", days),
  },
  reviews: {
    propose: () => ipcRenderer.invoke("review:propose"),
    confirm: (proposalId: string) => ipcRenderer.invoke("review:confirm", proposalId),
    list: () => ipcRenderer.invoke("review:list"),
  },
  chat: {
    send: (message: string) => ipcRenderer.invoke("chat:send", message),
  },
  coo: {
    analyze: () => ipcRenderer.invoke("coo:analyze"),
  },
  runtime: {
    onReminder: (callback: (message: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
      ipcRenderer.on("runtime:reminder", listener);
      return () => ipcRenderer.removeListener("runtime:reminder", listener);
    },
  },
});
