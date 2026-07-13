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
});
