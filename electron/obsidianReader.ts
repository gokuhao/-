import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type ObsidianConnectionState = "ready" | "not_configured" | "unavailable" | "invalid";

export type ObsidianStatus = {
  state: ObsidianConnectionState;
  message: string;
  vaultPath: string | null;
  markdownCount: number;
  checkedAt: string;
};

export type ObsidianNoteSummary = {
  relativePath: string;
  title: string;
  folder: string;
  tags: string[];
  modifiedAt: string;
  sizeBytes: number;
};

export type ObsidianNote = ObsidianNoteSummary & {
  content: string;
  frontmatter: Record<string, string | string[]>;
};

type ObsidianReaderOptions = {
  vaultPath?: string;
  maxNotes?: number;
  maxNoteBytes?: number;
};

const IGNORED_DIRECTORIES = new Set([".obsidian", ".trash", ".git", ".agents", ".codex", ".sync", "node_modules"]);

export class ObsidianReader {
  private readonly configuredPath: string;
  private readonly maxNotes: number;
  private readonly maxNoteBytes: number;

  constructor(options: ObsidianReaderOptions = {}) {
    this.configuredPath = (options.vaultPath ?? process.env.STEPBEAST_OBSIDIAN_VAULT_PATH ?? "").trim();
    this.maxNotes = options.maxNotes ?? 5_000;
    this.maxNoteBytes = options.maxNoteBytes ?? 2 * 1024 * 1024;
  }

  async getStatus(): Promise<ObsidianStatus> {
    const checkedAt = new Date().toISOString();
    if (!this.configuredPath) {
      return this.status("not_configured", "尚未配置 Obsidian Vault", null, 0, checkedAt);
    }
    try {
      const vaultPath = await this.resolveVaultPath();
      const notes = await this.listNotes();
      return this.status("ready", `Obsidian 已连接 · ${notes.length} 篇笔记`, vaultPath, notes.length, checkedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Obsidian Vault 无法读取";
      const state = message.includes("不是有效") ? "invalid" : "unavailable";
      return this.status(state, message, path.resolve(this.configuredPath), 0, checkedAt);
    }
  }

  async listNotes(): Promise<ObsidianNoteSummary[]> {
    const vaultPath = await this.resolveVaultPath();
    const files: string[] = [];
    await this.collectMarkdownFiles(vaultPath, files);
    const notes = await Promise.all(files.map((filePath) => this.readSummary(vaultPath, filePath)));
    return notes.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }

  async readNote(relativePath: string): Promise<ObsidianNote> {
    const vaultPath = await this.resolveVaultPath();
    const filePath = await this.resolveNotePath(vaultPath, relativePath);
    const fileStat = await stat(filePath);
    if (fileStat.size > this.maxNoteBytes) throw new Error("笔记超过 2 MB 读取上限");
    const content = await this.readPrefix(filePath, this.maxNoteBytes);
    const metadata = parseMarkdownMetadata(content, filePath);
    return {
      ...toSummary(vaultPath, filePath, fileStat, metadata),
      content,
      frontmatter: metadata.frontmatter,
    };
  }

  private async resolveVaultPath(): Promise<string> {
    if (!this.configuredPath) throw new Error("尚未配置 Obsidian Vault");
    let vaultPath: string;
    try {
      vaultPath = await realpath(path.resolve(this.configuredPath));
    } catch {
      throw new Error("Obsidian Vault 不存在或无法读取");
    }
    const vaultStat = await stat(vaultPath);
    if (!vaultStat.isDirectory()) throw new Error("配置路径不是文件夹");
    try {
      const configStat = await stat(path.join(vaultPath, ".obsidian"));
      if (!configStat.isDirectory()) throw new Error("配置路径不是有效的 Obsidian Vault");
    } catch {
      throw new Error("配置路径不是有效的 Obsidian Vault");
    }
    return vaultPath;
  }

  private async collectMarkdownFiles(directoryPath: string, files: string[]): Promise<void> {
    if (files.length >= this.maxNotes) return;
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= this.maxNotes) break;
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await this.collectMarkdownFiles(entryPath, files);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        files.push(entryPath);
      }
    }
  }

  private async readSummary(vaultPath: string, filePath: string): Promise<ObsidianNoteSummary> {
    const [fileStat, content] = await Promise.all([stat(filePath), this.readPrefix(filePath, 64 * 1024)]);
    return toSummary(vaultPath, filePath, fileStat, parseMarkdownMetadata(content, filePath));
  }

  private async readPrefix(filePath: string, maxBytes: number): Promise<string> {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  }

  private async resolveNotePath(vaultPath: string, relativePath: string): Promise<string> {
    if (!relativePath || path.extname(relativePath).toLowerCase() !== ".md" || path.isAbsolute(relativePath)) {
      throw new Error("笔记路径无效");
    }
    const candidatePath = path.resolve(vaultPath, relativePath);
    if (!isInside(vaultPath, candidatePath)) throw new Error("笔记路径超出 Vault 范围");
    const resolvedPath = await realpath(candidatePath);
    if (!isInside(vaultPath, resolvedPath)) throw new Error("笔记路径超出 Vault 范围");
    return resolvedPath;
  }

  private status(
    state: ObsidianConnectionState,
    message: string,
    vaultPath: string | null,
    markdownCount: number,
    checkedAt: string,
  ): ObsidianStatus {
    return { state, message, vaultPath, markdownCount, checkedAt };
  }
}

function parseMarkdownMetadata(content: string, filePath: string): {
  title: string;
  tags: string[];
  frontmatter: Record<string, string | string[]>;
} {
  const frontmatter: Record<string, string | string[]> = {};
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (!key || !value) continue;
      frontmatter[key] = parseFrontmatterValue(value);
    }
  }
  const heading = normalized.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const frontmatterTitle = typeof frontmatter.title === "string" ? frontmatter.title : null;
  const rawTags = frontmatter.tags ?? frontmatter.tag ?? [];
  const frontmatterTags = Array.isArray(rawTags) ? rawTags : rawTags.split(/[\s,]+/);
  const inlineTags = [...normalized.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((value) => value[1]);
  return {
    title: frontmatterTitle || heading || path.basename(filePath, path.extname(filePath)),
    tags: [...new Set([...frontmatterTags, ...inlineTags].map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean))]
      .slice(0, 30),
    frontmatter,
  };
}

function parseFrontmatterValue(value: string): string | string[] {
  const trimmed = value.replace(/^['"]|['"]$/g, "").trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((item) => item.replace(/^\s*['"]|['"]\s*$/g, "").trim()).filter(Boolean);
  }
  return trimmed;
}

function toSummary(
  vaultPath: string,
  filePath: string,
  fileStat: { mtime: Date; size: number },
  metadata: { title: string; tags: string[] },
): ObsidianNoteSummary {
  const relativePath = path.relative(vaultPath, filePath).split(path.sep).join("/");
  const folder = path.posix.dirname(relativePath);
  return {
    relativePath,
    title: metadata.title,
    folder: folder === "." ? "" : folder,
    tags: metadata.tags,
    modifiedAt: fileStat.mtime.toISOString(),
    sizeBytes: fileStat.size,
  };
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
