import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type FocusStatus = "active" | "paused" | "completed" | "abandoned";

export type FocusSession = {
  id: string;
  taskId: string;
  plannedSeconds: number;
  elapsedSeconds: number;
  status: FocusStatus;
  startedAt: string;
  pausedAt: string | null;
  endedAt: string | null;
};

type FocusRow = {
  id: string;
  task_id: string;
  planned_seconds: number;
  elapsed_seconds: number;
  status: FocusStatus;
  started_at: string;
  active_since: string | null;
  paused_at: string | null;
  ended_at: string | null;
};

export class FocusRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  getCurrent(): FocusSession | null {
    const row = this.getOpenRow();
    return row ? mapFocusRow(row) : null;
  }

  start(taskId: string, plannedSeconds: number): FocusSession {
    if (!Number.isInteger(plannedSeconds) || plannedSeconds < 300 || plannedSeconds > 10_800) {
      throw new Error("专注时间需要在 5 到 180 分钟之间");
    }
    const task = this.database.prepare(`
      SELECT status FROM tasks WHERE id = ? AND deleted_at IS NULL
    `).get(taskId) as { status: string } | undefined;
    if (!task || (task.status !== "todo" && task.status !== "doing")) {
      throw new Error("只能为未完成任务开始专注");
    }
    if (this.getOpenRow()) throw new Error("已经有一个未结束的专注任务");

    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO focus_sessions (
        id, task_id, planned_seconds, elapsed_seconds, status,
        started_at, active_since
      ) VALUES (?, ?, ?, 0, 'active', ?, ?)
    `).run(id, taskId, plannedSeconds, now, now);
    return this.getById(id);
  }

  pause(id: string): FocusSession {
    const row = this.getByIdRow(id);
    if (row.status !== "active") throw new Error("当前专注不是运行状态");
    const now = new Date();
    this.database.prepare(`
      UPDATE focus_sessions
      SET status = 'paused', elapsed_seconds = ?, active_since = NULL, paused_at = ?
      WHERE id = ?
    `).run(effectiveElapsed(row, now), now.toISOString(), id);
    return this.getById(id);
  }

  resume(id: string): FocusSession {
    const row = this.getByIdRow(id);
    if (row.status !== "paused") throw new Error("当前专注不是暂停状态");
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE focus_sessions
      SET status = 'active', active_since = ?, paused_at = NULL
      WHERE id = ?
    `).run(now, id);
    return this.getById(id);
  }

  finish(id: string): FocusSession {
    const row = this.getByIdRow(id);
    if (row.status !== "active" && row.status !== "paused") {
      throw new Error("这个专注已经结束");
    }
    const now = new Date();
    const elapsedSeconds = effectiveElapsed(row, now);
    const actualMinutes = Math.round(elapsedSeconds / 60);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE focus_sessions
        SET status = 'completed', elapsed_seconds = ?, active_since = NULL,
            paused_at = NULL, ended_at = ?
        WHERE id = ?
      `).run(elapsedSeconds, now.toISOString(), id);
      this.database.prepare(`
        UPDATE tasks SET actual_minutes = actual_minutes + ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(actualMinutes, now.toISOString(), row.task_id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getById(id);
  }

  abandon(id: string): FocusSession {
    const row = this.getByIdRow(id);
    if (row.status !== "active" && row.status !== "paused") return mapFocusRow(row);
    const now = new Date();
    this.database.prepare(`
      UPDATE focus_sessions
      SET status = 'abandoned', elapsed_seconds = ?, active_since = NULL,
          paused_at = NULL, ended_at = ?
      WHERE id = ?
    `).run(effectiveElapsed(row, now), now.toISOString(), id);
    return this.getById(id);
  }

  close(): void {
    this.database.close();
  }

  private getOpenRow(): FocusRow | undefined {
    return this.database.prepare(`
      SELECT id, task_id, planned_seconds, elapsed_seconds, status,
             started_at, active_since, paused_at, ended_at
      FROM focus_sessions
      WHERE status IN ('active', 'paused')
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as unknown as FocusRow | undefined;
  }

  private getById(id: string): FocusSession {
    return mapFocusRow(this.getByIdRow(id));
  }

  private getByIdRow(id: string): FocusRow {
    const row = this.database.prepare(`
      SELECT id, task_id, planned_seconds, elapsed_seconds, status,
             started_at, active_since, paused_at, ended_at
      FROM focus_sessions WHERE id = ?
    `).get(id) as unknown as FocusRow | undefined;
    if (!row) throw new Error("没有找到这个专注记录");
    return row;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        planned_seconds INTEGER NOT NULL CHECK (planned_seconds > 0),
        elapsed_seconds INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
        started_at TEXT NOT NULL,
        active_since TEXT,
        paused_at TEXT,
        ended_at TEXT,
        result_note TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS one_open_focus_session
      ON focus_sessions((1))
      WHERE status IN ('active', 'paused');

      INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
      VALUES (3, 'create_focus_sessions', datetime('now'));
    `);
  }
}

function effectiveElapsed(row: FocusRow, now = new Date()): number {
  if (row.status !== "active" || !row.active_since) return row.elapsed_seconds;
  const activeMilliseconds = Math.max(0, now.getTime() - new Date(row.active_since).getTime());
  return row.elapsed_seconds + Math.floor(activeMilliseconds / 1000);
}

function mapFocusRow(row: FocusRow): FocusSession {
  return {
    id: row.id,
    taskId: row.task_id,
    plannedSeconds: row.planned_seconds,
    elapsedSeconds: effectiveElapsed(row),
    status: row.status,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    endedAt: row.ended_at,
  };
}
