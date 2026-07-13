import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type TaskStatus = "todo" | "doing" | "completed" | "cancelled";

export type TaskRecord = {
  id: string;
  parentTaskId: string | null;
  title: string;
  status: TaskStatus;
  estimatedMinutes: number | null;
  actualMinutes: number;
  nextAction: string | null;
  evidence: string | null;
  rewardXp: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreateTaskInput = {
  title: string;
  estimatedMinutes?: number | null;
  nextAction?: string | null;
  evidence?: string | null;
  parentTaskId?: string | null;
};

export type DecompositionStepInput = {
  title: string;
  estimatedMinutes: number;
  doneWhen: string;
};

export type ConfirmDecompositionInput = {
  proposalId: string;
  summary: string;
  steps: DecompositionStepInput[];
};

export type UpdateTaskInput = CreateTaskInput;
export type PlanRole = "main" | "support";

export type TodayPlanItem = {
  role: PlanRole;
  sortOrder: number;
  task: TaskRecord;
};

export type TodayPlan = {
  date: string;
  items: TodayPlanItem[];
};

export type PlanningCandidate = TaskRecord & {
  dailyRole: PlanRole | null;
};

export type ConfirmDailyPlanInput = {
  proposalId: string;
  requestId: string;
  summary: string;
  reasoning: string;
  mainTaskId: string;
  supportTaskIds: string[];
};

export type PetProfile = {
  id: string;
  name: string;
  level: number;
  totalXp: number;
  emotion: string;
  activeMode: number;
};

export type TaskCompletionResult = {
  task: TaskRecord;
  profile: PetProfile;
  xpGained: number;
};

type TaskRow = {
  id: string;
  parent_task_id: string | null;
  title: string;
  status: TaskStatus;
  estimated_minutes: number | null;
  actual_minutes: number;
  next_action: string | null;
  evidence: string | null;
  reward_xp: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type PlanItemRow = TaskRow & {
  role: PlanRole;
  sort_order: number;
};

type PetRow = {
  id: string;
  name: string;
  level: number;
  total_xp: number;
  emotion: string;
  active_mode: number;
};

const DEFAULT_PET_ID = "stepbeast-default";

export class TaskRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  list(): TaskRecord[] {
    const rows = this.database.prepare(`
      SELECT id, parent_task_id, title, status, estimated_minutes, actual_minutes,
             next_action, evidence, reward_xp,
             created_at, updated_at, completed_at
      FROM tasks
      WHERE deleted_at IS NULL
      ORDER BY CASE status WHEN 'completed' THEN 1 ELSE 0 END, created_at DESC
    `).all() as unknown as TaskRow[];
    return rows.map(mapTaskRow);
  }

  create(input: CreateTaskInput): TaskRecord {
    const { title, estimatedMinutes, nextAction } = normalizeTaskInput(input);
    const evidence = input.evidence?.trim() || null;
    const parentTaskId = input.parentTaskId ?? null;
    if (parentTaskId) this.getById(parentTaskId);
    const rewardXp = rewardForMinutes(estimatedMinutes);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO tasks (
        id, parent_task_id, title, status, estimated_minutes, next_action, evidence, reward_xp,
        source, created_at, updated_at
      ) VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, 'manual', ?, ?)
    `).run(id, parentTaskId, title, estimatedMinutes, nextAction, evidence, rewardXp, now, now);
    return this.getById(id);
  }

  update(id: string, input: UpdateTaskInput): TaskRecord {
    if (!id) throw new Error("缺少任务 ID");
    this.getById(id);
    const { title, estimatedMinutes, nextAction } = normalizeTaskInput(input);
    const rewardXp = rewardForMinutes(estimatedMinutes);
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE tasks
      SET title = ?, estimated_minutes = ?, next_action = ?, reward_xp = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(title, estimatedMinutes, nextAction, rewardXp, now, id);
    return this.getById(id);
  }

  complete(id: string): TaskCompletionResult {
    if (!id) throw new Error("缺少任务 ID");
    const task = this.getById(id);
    if (task.status === "completed") {
      return { task, profile: this.getPetProfile(), xpGained: 0 };
    }

    const now = new Date().toISOString();
    const xpGained = rewardForMinutes(task.estimatedMinutes);
    const currentProfile = this.getPetProfile();
    const nextTotalXp = currentProfile.totalXp + xpGained;
    const nextLevel = levelForXp(nextTotalXp);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE tasks
        SET status = 'completed', reward_xp = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(xpGained, now, now, id);
      this.database.prepare(`
        INSERT INTO growth_events (
          id, pet_id, task_id, event_type, xp_delta, reason, created_at
        ) VALUES (?, ?, ?, 'task_completed', ?, ?, ?)
      `).run(randomUUID(), DEFAULT_PET_ID, id, xpGained, `完成任务：${task.title}`, now);
      this.database.prepare(`
        UPDATE pet_profiles
        SET level = ?, total_xp = ?, emotion = 'happy', updated_at = ?
        WHERE id = ?
      `).run(nextLevel, nextTotalXp, now, DEFAULT_PET_ID);
      this.database.prepare(`
        INSERT INTO events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'TaskCompleted', 'task', ?, ?, ?)
      `).run(randomUUID(), id, JSON.stringify({ taskId: id, xpGained, totalXp: nextTotalXp }), now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      task: this.getById(id),
      profile: this.getPetProfile(),
      xpGained,
    };
  }

  getPetProfile(): PetProfile {
    const row = this.database.prepare(`
      SELECT id, name, level, total_xp, emotion, active_mode
      FROM pet_profiles WHERE id = ?
    `).get(DEFAULT_PET_ID) as unknown as PetRow | undefined;
    if (!row) throw new Error("没有找到宠物档案");
    return mapPetRow(row);
  }

  remove(id: string): void {
    if (!id) throw new Error("缺少任务 ID");
    this.getById(id);
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE tasks
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(now, now, id);
  }

  confirmDecomposition(parentTaskId: string, proposal: ConfirmDecompositionInput): TaskRecord[] {
    const parent = this.getById(parentTaskId);
    if (parent.status !== "todo" && parent.status !== "doing") {
      throw new Error("只能拆解未完成任务");
    }
    if (!proposal.proposalId || proposal.proposalId.length > 100) {
      throw new Error("拆解提案 ID 无效");
    }
    const steps = validateDecompositionSteps(proposal.steps);
    const existing = this.database.prepare(`
      SELECT proposal_id FROM task_proposals WHERE proposal_id = ?
    `).get(proposal.proposalId);
    if (existing) return this.listProposalTasks(proposal.proposalId);

    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO task_proposals (proposal_id, parent_task_id, summary, created_at)
        VALUES (?, ?, ?, ?)
      `).run(proposal.proposalId, parentTaskId, proposal.summary.trim().slice(0, 500), now);

      const insert = this.database.prepare(`
        INSERT INTO tasks (
          id, parent_task_id, proposal_id, title, status, estimated_minutes,
          next_action, evidence, reward_xp, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'todo', ?, NULL, ?, ?, 'hermes', ?, ?)
      `);
      for (const step of steps) {
        insert.run(
          randomUUID(), parentTaskId, proposal.proposalId, step.title,
          step.estimatedMinutes, step.doneWhen, rewardForMinutes(step.estimatedMinutes), now, now,
        );
      }
      this.database.prepare(`
        INSERT INTO events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'TaskDecompositionConfirmed', 'task', ?, ?, ?)
      `).run(
        randomUUID(), parentTaskId,
        JSON.stringify({ proposalId: proposal.proposalId, childCount: steps.length }), now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.listProposalTasks(proposal.proposalId);
  }

  getTodayPlan(): TodayPlan {
    return this.readPlan(localDateKey());
  }

  getPlanningCandidates(limit = 20): PlanningCandidate[] {
    const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
    const roles = new Map(this.getTodayPlan().items.map((item) => [item.task.id, item.role]));
    return this.list()
      .filter((task) => task.status === "todo" || task.status === "doing")
      .slice(0, safeLimit)
      .map((task) => ({ ...task, dailyRole: roles.get(task.id) ?? null }));
  }

  confirmDailyPlan(proposal: ConfirmDailyPlanInput): TodayPlan {
    const normalized = validateDailyPlanProposal(proposal);
    const existing = this.database.prepare(`
      SELECT plan_date FROM daily_plan_proposals WHERE proposal_id = ?
    `).get(normalized.proposalId) as { plan_date: string } | undefined;
    if (existing) return this.readPlan(existing.plan_date);

    const selectedIds = [normalized.mainTaskId, ...normalized.supportTaskIds];
    for (const taskId of selectedIds) {
      const task = this.getById(taskId);
      if (task.status !== "todo" && task.status !== "doing") {
        throw new Error("AI 计划只能包含未完成任务");
      }
    }

    const date = localDateKey();
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      let plan = this.database.prepare("SELECT id FROM daily_plans WHERE plan_date = ?")
        .get(date) as { id: string } | undefined;
      if (!plan) {
        plan = { id: randomUUID() };
        this.database.prepare(`
          INSERT INTO daily_plans (id, plan_date, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(plan.id, date, now, now);
      }

      // 用户确认后才整体替换，确保 1 条主线和最多 2 条辅助任务同时生效。
      this.database.prepare("DELETE FROM daily_plan_items WHERE daily_plan_id = ?").run(plan.id);
      const insertItem = this.database.prepare(`
        INSERT INTO daily_plan_items (id, daily_plan_id, task_id, role, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insertItem.run(randomUUID(), plan.id, normalized.mainTaskId, "main", 0, now);
      normalized.supportTaskIds.forEach((taskId, index) => {
        insertItem.run(randomUUID(), plan.id, taskId, "support", index, now);
      });

      this.database.prepare("UPDATE daily_plans SET updated_at = ? WHERE id = ?").run(now, plan.id);
      this.database.prepare(`
        INSERT INTO daily_plan_proposals (
          proposal_id, request_id, plan_date, summary, reasoning,
          main_task_id, support_task_ids_json, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        normalized.proposalId,
        normalized.requestId,
        date,
        normalized.summary,
        normalized.reasoning,
        normalized.mainTaskId,
        JSON.stringify(normalized.supportTaskIds),
        now,
      );
      this.database.prepare(`
        INSERT INTO events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'DailyPlanConfirmed', 'daily_plan', ?, ?, ?)
      `).run(
        randomUUID(), plan.id,
        JSON.stringify({
          proposalId: normalized.proposalId,
          mainTaskId: normalized.mainTaskId,
          supportTaskIds: normalized.supportTaskIds,
        }),
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.readPlan(date);
  }

  setTodayRole(taskId: string, role: PlanRole | null): TodayPlan {
    if (role !== null && role !== "main" && role !== "support") {
      throw new Error("无效的今日任务角色");
    }
    const task = this.getById(taskId);
    if (role && task.status !== "todo" && task.status !== "doing") {
      throw new Error("已完成或已取消的任务不能加入今日计划");
    }
    const date = localDateKey();
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      let plan = this.database.prepare("SELECT id FROM daily_plans WHERE plan_date = ?").get(date) as { id: string } | undefined;
      if (!plan) {
        plan = { id: randomUUID() };
        this.database.prepare(`
          INSERT INTO daily_plans (id, plan_date, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(plan.id, date, now, now);
      }

      this.database.prepare("DELETE FROM daily_plan_items WHERE daily_plan_id = ? AND task_id = ?")
        .run(plan.id, taskId);

      if (role === "main") {
        // 设置新主线即明确替换旧主线，保证每天只有一个最重要结果。
        this.database.prepare("DELETE FROM daily_plan_items WHERE daily_plan_id = ? AND role = 'main'")
          .run(plan.id);
      }

      if (role) {
        const supportCount = this.database.prepare(`
          SELECT COUNT(*) AS count FROM daily_plan_items
          WHERE daily_plan_id = ? AND role = 'support'
        `).get(plan.id) as { count: number | bigint };
        if (role === "support" && Number(supportCount.count) >= 2) {
          throw new Error("今天最多只能安排两个辅助任务");
        }
        const sortOrder = role === "main" ? 0 : Number(supportCount.count);
        this.database.prepare(`
          INSERT INTO daily_plan_items (id, daily_plan_id, task_id, role, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), plan.id, taskId, role, sortOrder, now);
      }

      this.database.prepare("UPDATE daily_plans SET updated_at = ? WHERE id = ?").run(now, plan.id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.readPlan(date);
  }

  close(): void {
    this.database.close();
  }

  private getById(id: string): TaskRecord {
    const row = this.database.prepare(`
      SELECT id, parent_task_id, title, status, estimated_minutes, actual_minutes,
             next_action, evidence, reward_xp,
             created_at, updated_at, completed_at
      FROM tasks
      WHERE id = ? AND deleted_at IS NULL
    `).get(id) as unknown as TaskRow | undefined;
    if (!row) throw new Error("没有找到这个任务");
    return mapTaskRow(row);
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'completed', 'cancelled')),
        estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
        actual_minutes INTEGER NOT NULL DEFAULT 0,
        next_action TEXT,
        evidence TEXT,
        reward_xp INTEGER NOT NULL DEFAULT 10,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        deleted_at TEXT
      );

      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (1, 'create_tasks', datetime('now'));

      CREATE TABLE IF NOT EXISTS daily_plans (
        id TEXT PRIMARY KEY,
        plan_date TEXT UNIQUE NOT NULL,
        energy_level INTEGER CHECK (energy_level IS NULL OR energy_level BETWEEN 1 AND 5),
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_plan_items (
        id TEXT PRIMARY KEY,
        daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id),
        task_id TEXT NOT NULL REFERENCES tasks(id),
        role TEXT NOT NULL CHECK (role IN ('main', 'support')),
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (daily_plan_id, task_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS one_main_task_per_day
      ON daily_plan_items(daily_plan_id)
      WHERE role = 'main';

      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (2, 'create_daily_plans', datetime('now'));

      CREATE TABLE IF NOT EXISTS pet_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        total_xp INTEGER NOT NULL DEFAULT 0,
        emotion TEXT NOT NULL DEFAULT 'idle',
        active_mode INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS growth_events (
        id TEXT PRIMARY KEY,
        pet_id TEXT NOT NULL REFERENCES pet_profiles(id),
        task_id TEXT REFERENCES tasks(id),
        event_type TEXT NOT NULL,
        xp_delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS one_task_completion_reward
      ON growth_events(task_id, event_type)
      WHERE task_id IS NOT NULL AND event_type = 'task_completed';

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO pet_profiles (
        id, name, level, total_xp, emotion, active_mode, created_at, updated_at
      ) VALUES (
        'stepbeast-default', '步步兽', 1, 0, 'idle', 3, datetime('now'), datetime('now')
      );

    `);

    const growthMigration = this.database.prepare(`
      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (4, 'create_growth_system', datetime('now'))
    `).run();
    if (Number(growthMigration.changes) > 0) {
      // 只在首次升级时修正旧任务，之后保留用户可能调整过的奖励。
      this.database.exec(`
        UPDATE tasks
        SET reward_xp = CASE
          WHEN estimated_minutes IS NULL OR estimated_minutes <= 15 THEN 10
          WHEN estimated_minutes <= 45 THEN 20
          WHEN estimated_minutes <= 90 THEN 35
          ELSE 50
        END
        WHERE status NOT IN ('completed', 'cancelled');
      `);
    }

    const decompositionMigration = this.database.prepare(`
      SELECT version FROM schema_migrations WHERE version = 5
    `).get();
    if (!decompositionMigration) {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(`
          CREATE TABLE task_proposals (
            proposal_id TEXT PRIMARY KEY,
            parent_task_id TEXT NOT NULL REFERENCES tasks(id),
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id);
          ALTER TABLE tasks ADD COLUMN proposal_id TEXT REFERENCES task_proposals(proposal_id);
          CREATE INDEX tasks_parent_task_id ON tasks(parent_task_id);
          CREATE INDEX tasks_proposal_id ON tasks(proposal_id);
          INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (5, 'add_task_decomposition', datetime('now'));
        `);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }

    const dailyPlanProposalMigration = this.database.prepare(`
      SELECT version FROM schema_migrations WHERE version = 6
    `).get();
    if (!dailyPlanProposalMigration) {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(`
          CREATE TABLE daily_plan_proposals (
            proposal_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL,
            plan_date TEXT NOT NULL,
            summary TEXT NOT NULL,
            reasoning TEXT NOT NULL,
            main_task_id TEXT NOT NULL REFERENCES tasks(id),
            support_task_ids_json TEXT NOT NULL,
            confirmed_at TEXT NOT NULL
          );
          CREATE INDEX daily_plan_proposals_plan_date ON daily_plan_proposals(plan_date);
          INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (6, 'add_daily_plan_proposals', datetime('now'));
        `);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  private readPlan(date: string): TodayPlan {
    const rows = this.database.prepare(`
      SELECT i.role, i.sort_order,
             t.id, t.parent_task_id, t.title, t.status, t.estimated_minutes,
             t.actual_minutes, t.next_action, t.evidence, t.reward_xp,
             t.created_at, t.updated_at, t.completed_at
      FROM daily_plans p
      JOIN daily_plan_items i ON i.daily_plan_id = p.id
      JOIN tasks t ON t.id = i.task_id
      WHERE p.plan_date = ? AND t.deleted_at IS NULL
      ORDER BY CASE i.role WHEN 'main' THEN 0 ELSE 1 END, i.sort_order
    `).all(date) as unknown as PlanItemRow[];
    return {
      date,
      items: rows.map((row) => ({
        role: row.role,
        sortOrder: row.sort_order,
        task: mapTaskRow(row),
      })),
    };
  }

  private listProposalTasks(proposalId: string): TaskRecord[] {
    const rows = this.database.prepare(`
      SELECT id, parent_task_id, title, status, estimated_minutes, actual_minutes,
             next_action, evidence, reward_xp, created_at, updated_at, completed_at
      FROM tasks
      WHERE proposal_id = ? AND deleted_at IS NULL
      ORDER BY created_at, rowid
    `).all(proposalId) as unknown as TaskRow[];
    return rows.map(mapTaskRow);
  }
}

function normalizeTaskInput(input: CreateTaskInput): {
  title: string;
  estimatedMinutes: number | null;
  nextAction: string | null;
} {
  const title = input.title?.trim();
  if (!title || title.length > 120) {
    throw new Error("任务标题需要填写，且不能超过 120 个字");
  }

  const estimatedMinutes = input.estimatedMinutes ?? null;
  if (estimatedMinutes !== null
    && (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 480)) {
    throw new Error("预计时间需要是 1 到 480 分钟的整数");
  }

  return {
    title,
    estimatedMinutes,
    nextAction: input.nextAction?.trim() || null,
  };
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    parentTaskId: row.parent_task_id,
    title: row.title,
    status: row.status,
    estimatedMinutes: row.estimated_minutes,
    actualMinutes: row.actual_minutes,
    nextAction: row.next_action,
    evidence: row.evidence,
    rewardXp: row.reward_xp,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function validateDecompositionSteps(steps: DecompositionStepInput[]): DecompositionStepInput[] {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 8) {
    throw new Error("拆解步骤需要是 1 到 8 项");
  }
  return steps.map((step) => {
    const title = step.title?.trim();
    const doneWhen = step.doneWhen?.trim();
    if (!title || title.length > 120) throw new Error("拆解步骤标题无效");
    if (!Number.isInteger(step.estimatedMinutes) || step.estimatedMinutes < 1 || step.estimatedMinutes > 240) {
      throw new Error("拆解步骤时间需要是 1 到 240 分钟的整数");
    }
    if (!doneWhen || doneWhen.length > 300) throw new Error("拆解步骤完成标准无效");
    return { title, estimatedMinutes: step.estimatedMinutes, doneWhen };
  });
}

function validateDailyPlanProposal(proposal: ConfirmDailyPlanInput): ConfirmDailyPlanInput {
  const proposalId = proposal.proposalId?.trim();
  const requestId = proposal.requestId?.trim();
  const summary = proposal.summary?.trim();
  const reasoning = proposal.reasoning?.trim();
  const mainTaskId = proposal.mainTaskId?.trim();
  if (!proposalId || proposalId.length > 100) throw new Error("每日计划提案 ID 无效");
  if (!requestId || requestId.length > 100) throw new Error("每日计划请求 ID 无效");
  if (!summary || summary.length > 300) throw new Error("每日计划摘要无效");
  if (!reasoning || reasoning.length > 800) throw new Error("每日计划理由无效");
  if (!mainTaskId) throw new Error("每日计划必须有一个主线任务");
  if (!Array.isArray(proposal.supportTaskIds) || proposal.supportTaskIds.length > 2) {
    throw new Error("每日计划最多只能有两个辅助任务");
  }
  const supportTaskIds = proposal.supportTaskIds.map((id) => id?.trim());
  if (supportTaskIds.some((id) => !id)) throw new Error("辅助任务 ID 无效");
  const selectedIds = [mainTaskId, ...supportTaskIds];
  if (new Set(selectedIds).size !== selectedIds.length) throw new Error("每日计划不能重复选择任务");
  return { proposalId, requestId, summary, reasoning, mainTaskId, supportTaskIds };
}

function mapPetRow(row: PetRow): PetProfile {
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    totalXp: row.total_xp,
    emotion: row.emotion,
    activeMode: row.active_mode,
  };
}

export function rewardForMinutes(estimatedMinutes: number | null): number {
  if (estimatedMinutes === null || estimatedMinutes <= 15) return 10;
  if (estimatedMinutes <= 45) return 20;
  if (estimatedMinutes <= 90) return 35;
  return 50;
}

export function levelForXp(totalXp: number): number {
  let level = 1;
  while (totalXp >= (100 * level * (level + 1)) / 2) level += 1;
  return level;
}

function localDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
