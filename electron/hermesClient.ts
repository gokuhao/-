export type HermesConnectionState = "ready" | "online" | "offline" | "misconfigured";

export type HermesStatus = {
  state: HermesConnectionState;
  message: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  checkedAt: string;
};

type HermesClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

const DEFAULT_HERMES_URL = "http://127.0.0.1:8642";

export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: HermesClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.STEPBEAST_HERMES_URL ?? DEFAULT_HERMES_URL)
      .trim()
      .replace(/\/+$/, "");
    this.apiKey = (options.apiKey ?? process.env.STEPBEAST_HERMES_API_KEY ?? "").trim();
    this.timeoutMs = options.timeoutMs ?? 2_500;
  }

  async getStatus(): Promise<HermesStatus> {
    const checkedAt = new Date().toISOString();
    const validationError = validateLoopbackUrl(this.baseUrl);
    if (validationError) {
      return this.status("misconfigured", validationError, checkedAt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return this.status("offline", `Hermes 健康检查返回 ${response.status}`, checkedAt);
      }
      if (!this.apiKey) {
        return this.status("online", "Hermes 在线，但 StepBeast 尚未配置 API Key", checkedAt);
      }
      return this.status("ready", "Hermes 已连接", checkedAt);
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "Hermes 连接超时"
        : "Hermes API Server 未启动";
      return this.status("offline", message, checkedAt);
    } finally {
      clearTimeout(timeout);
    }
  }

  private status(state: HermesConnectionState, message: string, checkedAt: string): HermesStatus {
    return {
      state,
      message,
      baseUrl: this.baseUrl,
      apiKeyConfigured: Boolean(this.apiKey),
      checkedAt,
    };
  }
}

function validateLoopbackUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Hermes 地址只支持 HTTP 或 HTTPS";
    }
    if (!allowedHosts.has(url.hostname)) {
      return "V0.2 只允许连接本机 Hermes 地址";
    }
    return null;
  } catch {
    return "Hermes 地址格式无效";
  }
}
