import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ObsidianProjectService } from "../dist-electron/obsidianProjectService.js";
import { ObsidianReader } from "../dist-electron/obsidianReader.js";
import { ProjectRepository } from "../dist-electron/projectRepository.js";
import { TaskRepository } from "../dist-electron/taskRepository.js";

function key(sourcePath, title) {
  return createHash("sha256").update(`${sourcePath}\n${title}`, "utf8").digest("hex").slice(0, 32);
}

const directory = mkdtempSync(path.join(tmpdir(), "stepbeast-project-sync-"));
const vaultPath = path.join(directory, "Vault");
const databasePath = path.join(directory, "pet.db");
mkdirSync(path.join(vaultPath, ".obsidian"), { recursive: true });
mkdirSync(path.join(vaultPath, "02 项目", "当前"), { recursive: true });
writeFileSync(path.join(vaultPath, "02 项目", "项目总览.md"), `---
type: project_index
---
## 当前项目
- [[02 项目/当前/主页|现金流项目]]
`, "utf8");
writeFileSync(path.join(vaultPath, "02 项目", "当前", "主页.md"), `---
project: 现金流项目
project_status: active
---
## 项目目标
跑通第一笔收入。
## 当前阶段
验证客户需求。
## 下一步行动
- 完成客户方案初稿
`, "utf8");

const taskRepository = new TaskRepository(databasePath);
const projectRepository = new ProjectRepository(databasePath);
try {
  const service = new ObsidianProjectService(new ObsidianReader({ vaultPath }));
  const proposal = await service.generateProposal();
  const candidate = proposal.taskCandidates[0];
  const result = projectRepository.confirmSync({
    proposal,
    selectedCandidateKeys: [candidate.candidateKey],
  });
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].name, "现金流项目");
  assert.equal(result.projects[0].goal, "跑通第一笔收入。");
  assert.equal(result.createdTaskIds.length, 1);
  assert.equal(taskRepository.list().length, 1);
  assert.equal(taskRepository.list()[0].title, "完成客户方案初稿");

  const repeated = projectRepository.confirmSync({
    proposal,
    selectedCandidateKeys: [candidate.candidateKey],
  });
  assert.deepEqual(repeated.createdTaskIds, result.createdTaskIds);
  assert.equal(taskRepository.list().length, 1);

  const refreshedProposal = await service.generateProposal();
  projectRepository.confirmSync({
    proposal: refreshedProposal,
    selectedCandidateKeys: [refreshedProposal.taskCandidates[0].candidateKey],
  });
  assert.equal(taskRepository.list().length, 1);

  assert.throws(
    () => projectRepository.confirmSync({ proposal: { ...proposal, proposalId: randomUUID() }, selectedCandidateKeys: ["unknown"] }),
    /选择的任务候选无效/,
  );

  const pausedSource = "02 项目/暂停/主页.md";
  const pausedTitle = "不应创建的任务";
  const pausedProposal = {
    proposalId: randomUUID(),
    projectIndexPath: "02 项目/项目总览.md",
    summary: "暂停项目测试",
    projects: [{
      sourcePath: pausedSource,
      name: "暂停项目",
      status: "paused",
      category: "paused",
      goal: null,
      currentStage: null,
      sourceModifiedAt: new Date().toISOString(),
    }],
    taskCandidates: [{
      candidateKey: key(pausedSource, pausedTitle),
      projectSourcePath: pausedSource,
      projectName: "暂停项目",
      title: pausedTitle,
      estimatedMinutes: 25,
      sourcePath: pausedSource,
    }],
  };
  assert.throws(
    () => projectRepository.confirmSync({ proposal: pausedProposal, selectedCandidateKeys: [] }),
    /只能来自当前进行中的项目/,
  );

  const rollbackSource = "02 项目/当前/回滚测试.md";
  const rollbackTitle = "触发回滚任务";
  const rollbackProposal = {
    proposalId: randomUUID(),
    projectIndexPath: "02 项目/项目总览.md",
    summary: "事务回滚测试",
    projects: [{
      sourcePath: rollbackSource,
      name: "回滚测试项目",
      status: "active",
      category: "current",
      goal: "验证事务",
      currentStage: "测试",
      sourceModifiedAt: new Date().toISOString(),
    }],
    taskCandidates: [{
      candidateKey: key(rollbackSource, rollbackTitle),
      projectSourcePath: rollbackSource,
      projectName: "回滚测试项目",
      title: rollbackTitle,
      estimatedMinutes: 25,
      sourcePath: rollbackSource,
    }],
  };
  const triggerDatabase = new DatabaseSync(databasePath);
  triggerDatabase.exec(`
    CREATE TRIGGER fail_project_task_test
    BEFORE INSERT ON tasks
    WHEN NEW.title = '${rollbackTitle}'
    BEGIN
      SELECT RAISE(ABORT, 'injected project sync failure');
    END;
  `);
  triggerDatabase.close();
  assert.throws(
    () => projectRepository.confirmSync({
      proposal: rollbackProposal,
      selectedCandidateKeys: [rollbackProposal.taskCandidates[0].candidateKey],
    }),
    /injected project sync failure/,
  );
  assert.equal(projectRepository.list().some((project) => project.name === "回滚测试项目"), false);
  assert.equal(taskRepository.list().length, 1);
} finally {
  projectRepository.close();
  taskRepository.close();
}

const inspection = new DatabaseSync(databasePath);
assert.equal(
  inspection.prepare("SELECT name FROM schema_migrations WHERE version = 7").get()?.name,
  "add_obsidian_project_sync",
);
assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM projects").get().count, 1);
assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM tasks WHERE source = 'obsidian'").get().count, 1);
assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM project_sync_proposals").get().count, 2);
inspection.close();
rmSync(directory, { recursive: true, force: true });

console.log("Obsidian 项目同步、任务候选幂等和事务回滚测试通过");
