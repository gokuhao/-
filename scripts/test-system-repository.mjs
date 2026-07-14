import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SystemRepository } from "../dist-electron/systemRepository.js";
import { TaskRepository } from "../dist-electron/taskRepository.js";
import { FocusRepository } from "../dist-electron/focusRepository.js";
import { classifyApplication } from "../dist-electron/activityClassifier.js";
import { constrainCollapsedPosition, resolveDraggedWindowPosition } from "../dist-electron/windowPosition.js";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const collapsedSize = { width: 240, height: 260 };
assert.deepEqual(
  resolveDraggedWindowPosition(
    { screenX: 1919, screenY: 500 },
    { offsetX: 120, offsetY: 130 },
    collapsedSize,
    workArea,
    true,
  ),
  { x: 1840, y: 370 },
);
assert.deepEqual(
  resolveDraggedWindowPosition(
    { screenX: 0, screenY: 500 },
    { offsetX: 120, offsetY: 130 },
    collapsedSize,
    workArea,
    true,
  ),
  { x: -160, y: 370 },
);
assert.deepEqual(
  resolveDraggedWindowPosition(
    { screenX: 1919, screenY: 1200 },
    { offsetX: 120, offsetY: 130 },
    { width: 430, height: 720 },
    workArea,
    false,
  ),
  { x: 1490, y: 320 },
);
assert.deepEqual(
  constrainCollapsedPosition({ x: 5000, y: -200 }, collapsedSize, workArea),
  { x: 1840, y: 0 },
);

const directory = mkdtempSync(path.join(tmpdir(), "stepbeast-system-"));
const databasePath = path.join(directory, "pet.db");
const tasks = new TaskRepository(databasePath);
const focus = new FocusRepository(databasePath);
const system = new SystemRepository(databasePath);
try {
  assert.equal(system.getSettings().activityTrackingEnabled, false);
  const updated = system.updateSettings({ ...system.getSettings(), morningReminderEnabled: true, activeMode: 4 });
  assert.equal(updated.morningReminderEnabled, true);
  assert.equal(updated.activeMode, 4);
  assert.throws(() => system.updateSettings({ ...updated, morningTime: "25:70" }), /时间无效/);

  system.recordUsage("Visual Studio Code", "work", 30);
  system.recordUsage("Visual Studio Code", "work", 30);
  const usage = system.getUsageSummary(7);
  assert.equal(usage.totalSeconds, 60);
  assert.equal(usage.byCategory.work, 60);
  assert.equal(classifyApplication("Code.exe"), "work");
  assert.equal(classifyApplication("chrome.exe"), "other");

  const task = tasks.create({ title: "临时测试任务", estimatedMinutes: 25 });
  assert.throws(() => focus.start(task.id, 4 * 60), /5 到 180 分钟/);
  assert.throws(() => focus.start(task.id, 181 * 60), /5 到 180 分钟/);
  const session = focus.start(task.id, 25 * 60);
  assert.equal(session.taskId, task.id);
  assert.equal(session.plannedSeconds, 25 * 60);
  assert.equal(focus.pause(session.id).status, "paused");
  assert.equal(focus.resume(session.id).status, "active");
  const stopped = focus.finish(session.id);
  assert.equal(stopped.status, "completed");
  assert.equal(stopped.endedAt !== null, true);
  assert.equal(focus.getCurrent(), null);
  tasks.complete(task.id);
  const facts = system.getDailyFacts();
  assert.equal(facts.completedTasks.some((item) => item.id === task.id), true);

  const input = {
    proposalId: "review-test-1",
    reviewDate: facts.date,
    targetPath: `07 复盘与计划/步步兽/${facts.date}.md`,
    summary: "测试复盘",
  };
  const first = system.confirmReview(input);
  const second = system.confirmReview(input);
  assert.equal(second.id, first.id);
  assert.equal(system.listReviews().length, 1);
} finally {
  system.close();
  focus.close();
  tasks.close();
}

const inspection = new DatabaseSync(databasePath);
assert.equal(inspection.prepare("SELECT name FROM schema_migrations WHERE version = 8").get()?.name, "add_settings_activity_reviews");
assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM daily_reviews").get().count, 1);
inspection.close();
rmSync(directory, { recursive: true, force: true });
console.log("设置、活动统计、每日事实和复盘幂等测试通过");
