import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type AppSettings = {
  morningReminderEnabled: boolean;
  morningTime: string;
  eveningReminderEnabled: boolean;
  eveningTime: string;
  activityTrackingEnabled: boolean;
  autoLaunch: boolean;
  activeMode: 2 | 3 | 4;
  petScale: 0.75 | 1 | 1.25;
  panelScale: 0.9 | 1 | 1.1;
  edgeInteractionMode: "quiet" | "standard" | "lively";
};

export type ActivityCategory = "work" | "learning" | "communication" | "entertainment" | "other";

export type UsageItem = {
  appName: string;
  category: ActivityCategory;
  seconds: number;
};

export type UsageSummary = {
  dateFrom: string;
  dateTo: string;
  totalSeconds: number;
  byCategory: Record<ActivityCategory, number>;
  topApps: UsageItem[];
};

export type DailyFacts = {
  date: string;
  completedTasks: Array<{ id: string; title: string; actualMinutes: number }>;
  unfinishedTasks: Array<{ id: string; title: string; status: string }>;
  focusMinutes: number;
  usage: UsageSummary;
};

export type ConfirmedReview = {
  id: string;
  reviewDate: string;
  targetPath: string;
  summary: string;
  createdAt: string;
};

const DEFAULT_SETTINGS: AppSettings = {
  morningReminderEnabled: false,
  morningTime: "09:00",
  eveningReminderEnabled: false,
  eveningTime: "21:30",
  activityTrackingEnabled: false,
  autoLaunch: false,
  activeMode: 3,
  petScale: 1,
  panelScale: 1,
  edgeInteractionMode: "standard",
};

export class SystemRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  getSettings(): AppSettings {
    const row = this.database.prepare("SELECT value_json FROM settings WHERE key = 'app'")
      .get() as { value_json: string } | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      return validateSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(row.value_json) });
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  updateSettings(input: AppSettings): AppSettings {
    const settings = validateSettings(input);
    this.database.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES ('app', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(settings), new Date().toISOString());
    return settings;
  }

  recordUsage(appName: string, category: ActivityCategory, seconds: number): void {
    const normalizedName = appName.trim().slice(0, 120);
    if (!normalizedName || !isActivityCategory(category)) throw new Error("应用活动记录无效");
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error("应用活动时长无效");
    const date = localDateKey();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO activity_usage (usage_date, app_name, category, seconds, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(usage_date, app_name, category) DO UPDATE SET
        seconds = activity_usage.seconds + excluded.seconds,
        updated_at = excluded.updated_at
    `).run(date, normalizedName, category, seconds, now);
  }

  getUsageSummary(days = 7): UsageSummary {
    const safeDays = Math.min(90, Math.max(1, Math.trunc(days)));
    const dateTo = localDateKey();
    const from = new Date();
    from.setDate(from.getDate() - safeDays + 1);
    const dateFrom = localDateKey(from);
    const rows = this.database.prepare(`
      SELECT app_name, category, SUM(seconds) AS seconds
      FROM activity_usage
      WHERE usage_date BETWEEN ? AND ?
      GROUP BY app_name, category
      ORDER BY seconds DESC
    `).all(dateFrom, dateTo) as unknown as Array<{
      app_name: string;
      category: ActivityCategory;
      seconds: number | bigint;
    }>;
    const byCategory: Record<ActivityCategory, number> = {
      work: 0,
      learning: 0,
      communication: 0,
      entertainment: 0,
      other: 0,
    };
    const topApps = rows.map((row) => {
      const seconds = Number(row.seconds);
      byCategory[row.category] += seconds;
      return { appName: row.app_name, category: row.category, seconds };
    }).slice(0, 10);
    return {
      dateFrom,
      dateTo,
      totalSeconds: Object.values(byCategory).reduce((total, seconds) => total + seconds, 0),
      byCategory,
      topApps,
    };
  }

  getDailyFacts(date = localDateKey()): DailyFacts {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("复盘日期无效");
    const { start, end } = localDateRange(date);
    const completedTasks = this.database.prepare(`
      SELECT id, title, actual_minutes
      FROM tasks
      WHERE completed_at >= ? AND completed_at < ? AND deleted_at IS NULL
      ORDER BY completed_at
    `).all(start, end) as unknown as Array<{ id: string; title: string; actual_minutes: number }>;
    const unfinishedTasks = this.database.prepare(`
      SELECT id, title, status
      FROM tasks
      WHERE status IN ('todo', 'doing') AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 20
    `).all() as unknown as Array<{ id: string; title: string; status: string }>;
    const focus = this.database.prepare(`
      SELECT COALESCE(SUM(elapsed_seconds), 0) AS seconds
      FROM focus_sessions
      WHERE started_at >= ? AND started_at < ? AND status = 'completed'
    `).get(start, end) as { seconds: number | bigint };
    return {
      date,
      completedTasks: completedTasks.map((task) => ({
        id: task.id,
        title: task.title,
        actualMinutes: task.actual_minutes,
      })),
      unfinishedTasks,
      focusMinutes: Math.round(Number(focus.seconds) / 60),
      usage: this.getUsageSummary(1),
    };
  }

  confirmReview(input: { proposalId: string; reviewDate: string; targetPath: string; summary: string }): ConfirmedReview {
    const proposalId = input.proposalId?.trim();
    const targetPath = input.targetPath?.trim();
    const summary = input.summary?.trim();
    if (!proposalId || proposalId.length > 100) throw new Error("复盘提案 ID 无效");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewDate)) throw new Error("复盘日期无效");
    if (!targetPath || targetPath.length > 500 || !targetPath.toLowerCase().endsWith(".md")) throw new Error("复盘路径无效");
    if (!summary || summary.length > 1000) throw new Error("复盘摘要无效");
    const existing = this.database.prepare(`
      SELECT id, review_date, target_path, summary, created_at
      FROM daily_reviews WHERE proposal_id = ?
    `).get(proposalId) as ReviewRow | undefined;
    if (existing) return mapReview(existing);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO daily_reviews (id, proposal_id, review_date, target_path, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, proposalId, input.reviewDate, targetPath, summary, now);
      this.database.prepare(`
        INSERT INTO events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'DailyReviewWritten', 'daily_review', ?, ?, ?)
      `).run(randomUUID(), id, JSON.stringify({ reviewDate: input.reviewDate, targetPath }), now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { id, reviewDate: input.reviewDate, targetPath, summary, createdAt: now };
  }

  listReviews(limit = 7): ConfirmedReview[] {
    const rows = this.database.prepare(`
      SELECT id, review_date, target_path, summary, created_at
      FROM daily_reviews ORDER BY review_date DESC LIMIT ?
    `).all(Math.min(30, Math.max(1, Math.trunc(limit)))) as unknown as ReviewRow[];
    return rows.map(mapReview);
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    const migration = this.database.prepare("SELECT version FROM schema_migrations WHERE version = 8").get();
    if (migration) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE activity_usage (
          usage_date TEXT NOT NULL,
          app_name TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('work', 'learning', 'communication', 'entertainment', 'other')),
          seconds INTEGER NOT NULL CHECK (seconds >= 0),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (usage_date, app_name, category)
        );
        CREATE TABLE daily_reviews (
          id TEXT PRIMARY KEY,
          proposal_id TEXT UNIQUE NOT NULL,
          review_date TEXT NOT NULL,
          target_path TEXT NOT NULL,
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO settings (key, value_json, updated_at)
        VALUES ('app', '${JSON.stringify(DEFAULT_SETTINGS)}', datetime('now'))
        ON CONFLICT(key) DO NOTHING;
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (8, 'add_settings_activity_reviews', datetime('now'));
      `);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

type ReviewRow = {
  id: string;
  review_date: string;
  target_path: string;
  summary: string;
  created_at: string;
};

function validateSettings(value: AppSettings): AppSettings {
  if (typeof value.morningReminderEnabled !== "boolean" || typeof value.eveningReminderEnabled !== "boolean"
    || typeof value.activityTrackingEnabled !== "boolean" || typeof value.autoLaunch !== "boolean") {
    throw new Error("设置开关无效");
  }
  if (!isTime(value.morningTime) || !isTime(value.eveningTime)) throw new Error("提醒时间无效");
  if (![2, 3, 4].includes(value.activeMode)) throw new Error("主动模式无效");
  if (![0.75, 1, 1.25].includes(value.petScale)) throw new Error("宠物大小无效");
  if (![0.9, 1, 1.1].includes(value.panelScale)) throw new Error("窗口大小无效");
  if (!["quiet", "standard", "lively"].includes(value.edgeInteractionMode)) {
    throw new Error("边缘互动模式无效");
  }
  return { ...value };
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isActivityCategory(value: string): value is ActivityCategory {
  return ["work", "learning", "communication", "entertainment", "other"].includes(value);
}

function localDateKey(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateRange(date: string): { start: string; end: string } {
  const startDate = new Date(`${date}T00:00:00`);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

function mapReview(row: ReviewRow): ConfirmedReview {
  return {
    id: row.id,
    reviewDate: row.review_date,
    targetPath: row.target_path,
    summary: row.summary,
    createdAt: row.created_at,
  };
}
