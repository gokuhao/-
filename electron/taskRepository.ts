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
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO tasks (
        id, title, status, estimated_minutes, next_action, reward_xp,
        source, created_at, updated_at
      ) VALUES (?, ?, 'todo', ?, ?, 10, 'manual', ?, ?)
    `).run(id, title, estimatedMinutes, nextAction, now, now);
    return this.getById(id);
  }

  update(id: string, input: UpdateTaskInput): TaskRecord {
    if (!id) throw new Error("缺少任务 ID");
    this.getById(id);
    const { title, estimatedMinutes, nextAction } = normalizeTaskInput(input);
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE tasks
      SET title = ?, estimated_minutes = ?, next_action = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(title, estimatedMinutes, nextAction, now, id);
    return this.getById(id);
  }

  complete(id: string): TaskRecord {
    if (!id) throw new Error("缺少任务 ID");
    const task = this.getById(id);
    if (task.status === "completed") return task;

    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE tasks
      SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(now, now, id);
    return this.getById(id);
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
    `);
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

function localDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
