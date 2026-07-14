import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ObsidianWriter } from "../dist-electron/obsidianWriter.js";

const directory = mkdtempSync(path.join(tmpdir(), "stepbeast-writer-"));
const vaultPath = path.join(directory, "Vault");
mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });
const writer = new ObsidianWriter({ vaultPath });
try {
  const content = "# 今日复盘\n\n- 完成测试\n";
  const created = await writer.writeNewMarkdown("07 复盘与计划/步步兽/测试.md", content);
  assert.equal(created.created, true);
  assert.equal(readFileSync(path.join(vaultPath, created.relativePath), "utf8"), content);
  assert.equal((await writer.writeNewMarkdown(created.relativePath, content)).created, false);
  await assert.rejects(() => writer.writeNewMarkdown(created.relativePath, "# 不同内容"), /已经存在/);
  await assert.rejects(() => writer.writeNewMarkdown("../越界.md", content), /路径无效/);
  await assert.rejects(() => writer.writeNewMarkdown(".obsidian/危险.md", content), /程序目录/);
  writeFileSync(path.join(vaultPath, "普通文件.md"), "旧内容", "utf8");
  await assert.rejects(() => writer.writeNewMarkdown("普通文件.md", "新内容"), /已经存在/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("Obsidian 新文件、幂等、冲突和越界保护测试通过");
