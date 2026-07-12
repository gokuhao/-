import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Electron 打包后使用本地文件协议，需要相对资源路径。
  base: "./",
});
