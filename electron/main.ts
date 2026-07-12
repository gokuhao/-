import { app, BrowserWindow } from "electron";
import path from "node:path";

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 420,
    minHeight: 520,
    title: "步步兽",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // 渲染页面不直接获得 Node.js 权限，后续本地能力统一通过 preload 暴露。
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
