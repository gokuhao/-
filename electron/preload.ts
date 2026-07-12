import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("stepBeast", {
  platform: process.platform,
});
