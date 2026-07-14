import { powerMonitor } from "electron";
import type { AppSettings } from "./systemRepository.js";
import { SystemRepository } from "./systemRepository.js";
import { classifyApplication } from "./activityClassifier.js";

type RuntimeCoordinatorOptions = {
  repository: SystemRepository;
  onReminder: (message: string) => void;
  sampleSeconds?: number;
};

export class RuntimeCoordinator {
  private readonly repository: SystemRepository;
  private readonly onReminder: (message: string) => void;
  private readonly sampleSeconds: number;
  private timer: NodeJS.Timeout | null = null;
  private lastReminderKey = "";
  private collecting = false;

  constructor(options: RuntimeCoordinatorOptions) {
    this.repository = options.repository;
    this.onReminder = options.onReminder;
    this.sampleSeconds = options.sampleSeconds ?? 30;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.sampleSeconds * 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const settings = this.repository.getSettings();
    this.checkReminder(settings);
    if (!settings.activityTrackingEnabled || this.collecting || powerMonitor.getSystemIdleTime() >= 60) return;

    this.collecting = true;
    try {
      const { activeWindow } = await import("get-windows");
      const current = await activeWindow();
      // 隐私边界：只保留应用名；窗口标题、进程路径和网页标题都不进入数据库。
      const appName = current?.owner?.name?.trim();
      if (appName) this.repository.recordUsage(appName, classifyApplication(appName), this.sampleSeconds);
    } catch {
      // 采样失败不打断桌宠；下一轮自动重试。
    } finally {
      this.collecting = false;
    }
  }

  private checkReminder(settings: AppSettings): void {
    const now = new Date();
    const date = localDateKey(now);
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const candidates = [
      settings.morningReminderEnabled && time === settings.morningTime
        ? { key: `${date}:morning`, message: "早上好，选出今天最重要的一件事吧。" }
        : null,
      settings.eveningReminderEnabled && time === settings.eveningTime
        ? { key: `${date}:evening`, message: "今天辛苦了，要生成一份每日复盘吗？" }
        : null,
    ].filter((item): item is { key: string; message: string } => Boolean(item));
    const reminder = candidates[0];
    if (!reminder || reminder.key === this.lastReminderKey) return;
    this.lastReminderKey = reminder.key;
    this.onReminder(reminder.message);
  }
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
