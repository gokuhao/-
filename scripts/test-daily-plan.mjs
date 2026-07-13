import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HermesClient } from "../dist-electron/hermesClient.js";
import { TaskRepository } from "../dist-electron/taskRepository.js";

function proposal(mainTaskId, supportTaskIds = []) {
  return {
    proposalId: randomUUID(),
    requestId: randomUUID(),
    summary: "测试计划",
    reasoning: "验证原子确认和数量限制",
    mainTaskId,
    supportTaskIds,
  };
}

function taskIds(plan) {
  return plan.items.map((item) => `${item.role}:${item.task.id}`);
}

async function testRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), "stepbeast-daily-plan-"));
  const databasePath = path.join(directory, "test.db");
  const repository = new TaskRepository(databasePath);
  try {
    const oldMain = repository.create({ title: "旧主线" });
    const oldSupport = repository.create({ title: "旧辅助" });
    const newMain = repository.create({ title: "新主线" });
    const newSupportA = repository.create({ title: "新辅助 A" });
    const newSupportB = repository.create({ title: "新辅助 B" });
    const completed = repository.create({ title: "已完成" });
    const deleted = repository.create({ title: "已删除" });
    repository.complete(completed.id);
    repository.remove(deleted.id);

    repository.confirmDailyPlan(proposal(oldMain.id, [oldSupport.id]));

    const confirmedProposal = proposal(newMain.id, [newSupportA.id, newSupportB.id]);
    const confirmed = repository.confirmDailyPlan(confirmedProposal);
    assert.deepEqual(taskIds(confirmed), [
      `main:${newMain.id}`,
      `support:${newSupportA.id}`,
      `support:${newSupportB.id}`,
    ]);
    assert.deepEqual(taskIds(repository.confirmDailyPlan(confirmedProposal)), taskIds(confirmed));

    assert.throws(
      () => repository.confirmDailyPlan(proposal(newMain.id, [newSupportA.id, newSupportB.id, oldMain.id])),
      /最多只能有两个辅助任务/,
    );
    assert.throws(() => repository.confirmDailyPlan(proposal("unknown-task")), /没有找到这个任务/);
    assert.throws(() => repository.confirmDailyPlan(proposal(completed.id)), /只能包含未完成任务/);
    assert.throws(() => repository.confirmDailyPlan(proposal(deleted.id)), /没有找到这个任务/);
    assert.throws(
      () => repository.confirmDailyPlan(proposal(newMain.id, [newMain.id])),
      /不能重复选择任务/,
    );

    repository.confirmDailyPlan(proposal(oldMain.id, [oldSupport.id]));
    const triggerDatabase = new DatabaseSync(databasePath);
    triggerDatabase.exec(`
      CREATE TRIGGER fail_daily_plan_test
      BEFORE INSERT ON daily_plan_items
      WHEN NEW.task_id = '${newSupportA.id}'
      BEGIN
        SELECT RAISE(ABORT, 'injected test failure');
      END;
    `);
    triggerDatabase.close();
    assert.throws(
      () => repository.confirmDailyPlan(proposal(newMain.id, [newSupportA.id])),
      /injected test failure/,
    );
    assert.deepEqual(taskIds(repository.getTodayPlan()), [
      `main:${oldMain.id}`,
      `support:${oldSupport.id}`,
    ]);
  } finally {
    repository.close();
  }

  const inspection = new DatabaseSync(databasePath);
  const migration = inspection.prepare("SELECT name FROM schema_migrations WHERE version = 6").get();
  inspection.close();
  assert.equal(migration?.name, "add_daily_plan_proposals");
  rmSync(directory, { recursive: true, force: true });
}

async function withMockHermes(responses, run) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ authorization: request.headers.authorization, body });
      const content = responses[Math.min(requests.length - 1, responses.length - 1)];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const client = new HermesClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: "test-only-key",
    chatTimeoutMs: 2_000,
  });
  try {
    await run(client, requests);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function testHermesValidation() {
  const candidates = [
    { id: "task-a", title: "任务 A", estimatedMinutes: 25, nextAction: null, dailyRole: null },
    { id: "task-b", title: "任务 B", estimatedMinutes: 15, nextAction: "完成第一步", dailyRole: "support" },
  ];
  const valid = JSON.stringify({
    summary: "先完成 A",
    reasoning: "A 是当前最重要结果",
    main_task_id: "task-a",
    support_task_ids: ["task-b"],
  });
  await withMockHermes(["not json", valid], async (client, requests) => {
    const result = await client.generateDailyPlan(candidates);
    assert.equal(result.attempts, 2);
    assert.equal(result.mainTaskId, "task-a");
    assert.deepEqual(result.supportTaskIds, ["task-b"]);
    assert.equal(requests.length, 2);
    assert(requests.every((request) => request.authorization === "Bearer test-only-key"));
  });

  const unknown = JSON.stringify({
    summary: "未知任务",
    reasoning: "用于测试",
    main_task_id: "unknown-task",
    support_task_ids: [],
  });
  await withMockHermes([unknown], async (client, requests) => {
    await assert.rejects(() => client.generateDailyPlan(candidates), /main_task_id 不在候选任务中/);
    assert.equal(requests.length, 2);
  });

  const duplicate = JSON.stringify({
    summary: "重复任务",
    reasoning: "用于测试",
    main_task_id: "task-a",
    support_task_ids: ["task-a"],
  });
  await withMockHermes([duplicate], async (client, requests) => {
    await assert.rejects(() => client.generateDailyPlan(candidates), /计划中存在重复任务/);
    assert.equal(requests.length, 2);
  });
}

await testRepository();
await testHermesValidation();
console.log("每日计划数据库与 Hermes 校验测试通过");
