import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ObsidianReader } from "../dist-electron/obsidianReader.js";

const directory = mkdtempSync(path.join(tmpdir(), "stepbeast-obsidian-"));
const vaultPath = path.join(directory, "TestVault");
mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });
mkdirSync(path.join(vaultPath, "项目"), { recursive: true });
mkdirSync(path.join(vaultPath, ".trash"), { recursive: true });
writeFileSync(path.join(vaultPath, "首页.md"), "# 我的首页\n\n这里有一个 #入口 标签。", "utf8");
writeFileSync(
  path.join(vaultPath, "项目", "步步兽.md"),
  "---\ntitle: 步步兽项目\ntags: [项目, AI]\nstatus: active\n---\n\n# 被 frontmatter 覆盖的标题\n",
  "utf8",
);
writeFileSync(path.join(vaultPath, ".trash", "已删除.md"), "# 不应被索引", "utf8");
writeFileSync(path.join(vaultPath, "不是笔记.txt"), "忽略", "utf8");

try {
  const reader = new ObsidianReader({ vaultPath });
  const status = await reader.getStatus();
  assert.equal(status.state, "ready");
  assert.equal(status.markdownCount, 2);

  const notes = await reader.listNotes();
  assert.equal(notes.length, 2);
  const project = notes.find((note) => note.relativePath === "项目/步步兽.md");
  assert(project);
  assert.equal(project.title, "步步兽项目");
  assert.deepEqual(project.tags, ["项目", "AI"]);

  const note = await reader.readNote("项目/步步兽.md");
  assert.equal(note.frontmatter.status, "active");
  assert(note.content.includes("frontmatter"));
  await assert.rejects(() => reader.readNote("../越界.md"), /路径超出|路径无效/);

  const invalid = new ObsidianReader({ vaultPath: directory });
  assert.equal((await invalid.getStatus()).state, "invalid");
  const missing = new ObsidianReader({ vaultPath: path.join(directory, "missing") });
  assert.equal((await missing.getStatus()).state, "unavailable");
  const unconfigured = new ObsidianReader({ vaultPath: "" });
  assert.equal((await unconfigured.getStatus()).state, "not_configured");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Obsidian 只读索引、Markdown 元数据和路径边界测试通过");
