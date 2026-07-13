import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ObsidianProjectService } from "../dist-electron/obsidianProjectService.js";
import { ObsidianReader } from "../dist-electron/obsidianReader.js";

const directory = mkdtempSync(path.join(tmpdir(), "stepbeast-projects-"));
const vaultPath = path.join(directory, "TestVault");
mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });
mkdirSync(path.join(vaultPath, "02 项目", "当前项目", "01_项目状态"), { recursive: true });
mkdirSync(path.join(vaultPath, "01 个人"), { recursive: true });
mkdirSync(path.join(vaultPath, "02 项目", "暂停项目"), { recursive: true });

writeFileSync(path.join(vaultPath, "02 项目", "项目总览.md"), `---
type: project_index
---
# 项目总览
## 当前项目
- [[02 项目/当前项目/项目主页|当前业务]]
## 支撑系统
- [[01 个人/人生系统|人生系统]]
## 已暂停与保留项目
- [[02 项目/暂停项目/旧项目|旧项目]]
`, "utf8");
writeFileSync(path.join(vaultPath, "02 项目", "当前项目", "项目主页.md"), `---
type: project_overview
project: 当前业务
project_status: active
---
# 当前业务
## 项目目标
跑通真实业务闭环。
## 当前阶段
验证第一批用户反馈。
## 当前入口
- [[01_项目状态/当前进度|当前进度]]
`, "utf8");
writeFileSync(path.join(vaultPath, "02 项目", "当前项目", "01_项目状态", "当前进度.md"), `# 当前进度
## 最低有效动作
- 发布一条真实内容；
- [ ] 记录一条用户反馈
`, "utf8");
writeFileSync(path.join(vaultPath, "01 个人", "人生系统.md"), `# 人生系统
## 项目定位
维护长期目标和资源边界。
`, "utf8");
writeFileSync(path.join(vaultPath, "02 项目", "暂停项目", "旧项目.md"), `---
project: 旧项目
project_status: active
---
# 旧项目
## 关键动作
- 不应该创建任务
`, "utf8");

try {
  const reader = new ObsidianReader({ vaultPath });
  const service = new ObsidianProjectService(reader);
  const proposal = await service.generateProposal();
  assert.equal(proposal.projects.length, 3);
  assert.equal(proposal.projects[0].name, "当前业务");
  assert.equal(proposal.projects[0].status, "active");
  assert.equal(proposal.projects[0].goal, "跑通真实业务闭环。");
  assert.equal(proposal.projects[0].currentStage, "验证第一批用户反馈。");
  assert.equal(proposal.projects[1].category, "support");
  assert.equal(proposal.projects[2].status, "paused");
  assert.deepEqual(proposal.taskCandidates.map((candidate) => candidate.title), [
    "发布一条真实内容",
    "记录一条用户反馈",
  ]);
  assert(proposal.taskCandidates.every((candidate) => candidate.candidateKey.length === 32));
  assert(proposal.taskCandidates.every((candidate) => candidate.sourcePath.endsWith("当前进度.md")));
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("Obsidian 项目入口、状态、字段和任务候选解析测试通过");
