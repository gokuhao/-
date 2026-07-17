import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SystemRepository } from "../dist-electron/systemRepository.js";
import { TaskRepository } from "../dist-electron/taskRepository.js";
import { FocusRepository } from "../dist-electron/focusRepository.js";
import { RewardRepository } from "../dist-electron/rewardRepository.js";
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
  { x: 1827, y: 370 },
);
assert.deepEqual(
  resolveDraggedWindowPosition(
    { screenX: 0, screenY: 500 },
    { offsetX: 120, offsetY: 130 },
    collapsedSize,
    workArea,
    true,
  ),
  { x: -146, y: 370 },
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
  { x: 1827, y: 0 },
);

const directory = mkdtempSync(path.join(tmpdir(), "stepbeast-system-"));
const databasePath = path.join(directory, "pet.db");
const tasks = new TaskRepository(databasePath);
const focus = new FocusRepository(databasePath);
const system = new SystemRepository(databasePath);
const rewards = new RewardRepository(databasePath);
try {
  assert.equal(system.getSettings().activityTrackingEnabled, false);
  assert.equal(system.getSettings().edgeInteractionMode, "standard");
  const updated = system.updateSettings({ ...system.getSettings(), morningReminderEnabled: true, activeMode: 4, petScale: 1.25, panelScale: 0.9, edgeInteractionMode: "lively" });
  assert.equal(updated.morningReminderEnabled, true);
  assert.equal(updated.activeMode, 4);
  assert.equal(updated.petScale, 1.25);
  assert.equal(updated.panelScale, 0.9);
  assert.equal(updated.edgeInteractionMode, "lively");
  assert.throws(() => system.updateSettings({ ...updated, morningTime: "25:70" }), /时间无效/);
  assert.throws(() => system.updateSettings({ ...updated, petScale: 2 }), /宠物大小无效/);
  assert.throws(() => system.updateSettings({ ...updated, panelScale: 0.5 }), /窗口大小无效/);
  assert.throws(() => system.updateSettings({ ...updated, edgeInteractionMode: "unknown" }), /边缘互动模式无效/);

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
  tasks.setTodayRole(task.id, "main");
  const completion = tasks.complete(task.id);
  assert.equal(completion.xpGained, 40);
  assert.equal(completion.coinsGained, 40);
  assert.equal(completion.profile.rewardCoins, 40);
  const withGoal = rewards.createGoal({ name: "测试奖励", category: "purchase", coinCost: 40, fundTargetYuan: 100 });
  const goalId = withGoal.goals[0].id;
  assert.throws(() => rewards.redeem(goalId), /资金进度/);
  assert.equal(rewards.updateFunding(goalId, 100).goals[0].fundCurrentYuan, 100);
  const redeemed = rewards.redeem(goalId);
  assert.equal(redeemed.profile.rewardCoins, 0);
  assert.equal(redeemed.goals[0].status, "redeemed");
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
  rewards.close();
  tasks.close();
}

const inspection = new DatabaseSync(databasePath);
assert.equal(inspection.prepare("SELECT name FROM schema_migrations WHERE version = 8").get()?.name, "add_settings_activity_reviews");
assert.equal(inspection.prepare("SELECT name FROM schema_migrations WHERE version = 9").get()?.name, "add_reward_economy");
assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM daily_reviews").get().count, 1);
assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM reward_redemptions").get().count, 1);
inspection.close();
rmSync(directory, { recursive: true, force: true });
console.log("设置、活动统计、每日事实和复盘幂等测试通过");
