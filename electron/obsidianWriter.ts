import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type ObsidianWriterOptions = {
  vaultPath?: string;
};

export type ObsidianWriteResult = {
  relativePath: string;
  created: boolean;
};

const BLOCKED_ROOTS = new Set([".obsidian", ".trash", ".git", ".agents", ".codex", ".sync"]);

export class ObsidianWriter {
  private readonly configuredPath: string;

  constructor(options: ObsidianWriterOptions = {}) {
    this.configuredPath = (options.vaultPath ?? process.env.STEPBEAST_OBSIDIAN_VAULT_PATH ?? "").trim();
  }

  async writeNewMarkdown(relativePath: string, content: string): Promise<ObsidianWriteResult> {
    const normalizedPath = normalizeRelativeMarkdownPath(relativePath);
    if (!content.trim() || Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) {
      throw new Error("Obsidian 写入内容为空或超过 2 MB");
    }
    const vaultPath = await this.resolveVaultPath();
    const targetPath = path.resolve(vaultPath, normalizedPath);
    if (!isInside(vaultPath, targetPath)) throw new Error("Obsidian 写入路径超出 Vault 范围");
    const firstSegment = normalizedPath.split("/")[0].toLowerCase();
    if (BLOCKED_ROOTS.has(firstSegment)) throw new Error("不允许写入 Obsidian 程序目录");

    try {
      const existing = await readFile(targetPath, "utf8");
      if (existing === content) return { relativePath: normalizedPath, created: false };
      throw new Error("目标 Obsidian 笔记已经存在，请更换路径或手动处理冲突");
    } catch (error) {
      if (error instanceof Error && !isMissingFileError(error)) throw error;
    }

    const parentPath = path.dirname(targetPath);
    await mkdir(parentPath, { recursive: true });
    const resolvedParent = await realpath(parentPath);
    if (!isInsideOrSame(vaultPath, resolvedParent)) throw new Error("Obsidian 写入目录超出 Vault 范围");

    const temporaryPath = path.join(parentPath, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return { relativePath: normalizedPath, created: true };
  }

  private async resolveVaultPath(): Promise<string> {
    if (!this.configuredPath) throw new Error("尚未配置 Obsidian Vault");
    const vaultPath = await realpath(path.resolve(this.configuredPath));
    const config = await stat(path.join(vaultPath, ".obsidian"));
    if (!config.isDirectory()) throw new Error("配置路径不是有效的 Obsidian Vault");
    return vaultPath;
  }
}

function normalizeRelativeMarkdownPath(value: string): string {
  const normalized = value?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith("/")
    || /^[a-zA-Z]:/.test(normalized) || !normalized.toLowerCase().endsWith(".md")) {
    throw new Error("Obsidian 写入路径无效");
  }
  return normalized;
}

function isInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isInsideOrSame(rootPath: string, candidatePath: string): boolean {
  return path.relative(rootPath, candidatePath) === "" || isInside(rootPath, candidatePath);
}

function isMissingFileError(error: Error): boolean {
  return "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
