import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type TaskStatus = "todo" | "doing" | "completed" | "cancelled";

export type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  estimatedMinutes: number | null;
  actualMinutes: number;
  nextAction: string | null;
  rewardXp: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreateTaskInput = {
  title: string;
  estimatedMinutes?: number | null;
  nextAction?: string | null;
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
  title: string;
  status: TaskStatus;
  estimated_minutes: number | null;
  actual_minutes: number;
  next_action: string | null;
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
      SELECT id, title, status, estimated_minutes, actual_minutes, next_action, reward_xp,
             created_at, updated_at, completed_at
      FROM tasks
      WHERE deleted_at IS NULL
      ORDER BY CASE status WHEN 'completed' THEN 1 ELSE 0 END, created_at DESC
    `).all() as unknown as TaskRow[];
    return rows.map(mapTaskRow);
  }

  create(input: CreateTaskInput): TaskRecord {
    const { title, estimatedMinutes, nextAction } = normalizeTaskInput(input);
    const rewardXp = rewardForMinutes(estimatedMinutes);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO tasks (
        id, title, status, estimated_minutes, next_action, reward_xp,
        source, created_at, updated_at
      ) VALUES (?, ?, 'todo', ?, ?, ?, 'manual', ?, ?)
    `).run(id, title, estimatedMinutes, nextAction, rewardXp, now, now);
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

  getTodayPlan(): TodayPlan {
    return this.readPlan(localDateKey());
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
      SELECT id, title, status, estimated_minutes, actual_minutes, next_action, reward_xp,
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
  }

  private readPlan(date: string): TodayPlan {
    const rows = this.database.prepare(`
      SELECT i.role, i.sort_order,
             t.id, t.title, t.status, t.estimated_minutes, t.actual_minutes, t.next_action, t.reward_xp,
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
    title: row.title,
    status: row.status,
    estimatedMinutes: row.estimated_minutes,
    actualMinutes: row.actual_minutes,
    nextAction: row.next_action,
    rewardXp: row.reward_xp,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
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
