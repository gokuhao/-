import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type TaskStatus = "todo" | "doing" | "completed" | "cancelled";

export type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  estimatedMinutes: number | null;
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

type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  estimated_minutes: number | null;
  next_action: string | null;
  reward_xp: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
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
      SELECT id, title, status, estimated_minutes, next_action, reward_xp,
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

  close(): void {
    this.database.close();
  }

  private getById(id: string): TaskRecord {
    const row = this.database.prepare(`
      SELECT id, title, status, estimated_minutes, next_action, reward_xp,
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
    `);
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
    nextAction: row.next_action,
    rewardXp: row.reward_xp,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
