import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { ObsidianReader, type ObsidianNote } from "./obsidianReader.js";

export type ProjectStatus = "active" | "testing" | "paused" | "completed" | "archived";
export type ProjectCategory = "current" | "support" | "paused";

export type ObsidianProjectCandidate = {
  sourcePath: string;
  name: string;
  status: ProjectStatus;
  category: ProjectCategory;
  goal: string | null;
  currentStage: string | null;
  sourceModifiedAt: string;
};

export type ObsidianTaskCandidate = {
  candidateKey: string;
  projectSourcePath: string;
  projectName: string;
  title: string;
  estimatedMinutes: number;
  sourcePath: string;
};

export type ObsidianProjectProposal = {
  proposalId: string;
  projectIndexPath: string;
  summary: string;
  projects: ObsidianProjectCandidate[];
  taskCandidates: ObsidianTaskCandidate[];
};

type ProjectLink = {
  target: string;
  alias: string | null;
  category: ProjectCategory;
};

type MarkdownSection = {
  heading: string;
  body: string;
};

type ObsidianProjectServiceOptions = {
  projectIndexPath?: string;
};

const DEFAULT_PROJECT_INDEX = "02 项目/项目总览.md";

export class ObsidianProjectService {
  private readonly projectIndexPath: string;

  constructor(
    private readonly reader: ObsidianReader,
    options: ObsidianProjectServiceOptions = {},
  ) {
    this.projectIndexPath = (options.projectIndexPath
      ?? process.env.STEPBEAST_OBSIDIAN_PROJECT_INDEX_PATH
      ?? DEFAULT_PROJECT_INDEX).trim();
  }

  async generateProposal(): Promise<ObsidianProjectProposal> {
    const indexNote = await this.reader.readNote(this.projectIndexPath);
    if (indexNote.frontmatter.type !== "project_index") {
      throw new Error("Obsidian 项目入口缺少 type: project_index");
    }
    const links = extractProjectLinks(indexNote.content);
    if (links.length < 1) throw new Error("Obsidian 项目总览中没有找到项目链接");
    if (links.length > 20) throw new Error("Obsidian 项目入口不能超过 20 个项目");

    const projects: ObsidianProjectCandidate[] = [];
    const taskCandidates: ObsidianTaskCandidate[] = [];
    for (const link of links) {
      const sourcePath = normalizeWikiTarget(link.target);
      const note = await this.reader.readNote(sourcePath);
      const project = toProjectCandidate(note, link);
      projects.push(project);
      if (project.category === "current" && project.status === "active") {
        const actions = await this.findNextActions(note);
        for (const action of actions.slice(0, 3)) {
          taskCandidates.push({
            candidateKey: candidateKey(project.sourcePath, action.title),
            projectSourcePath: project.sourcePath,
            projectName: project.name,
            title: action.title,
            estimatedMinutes: action.estimatedMinutes,
            sourcePath: action.sourcePath,
          });
        }
      }
    }

    const limitedTaskCandidates = taskCandidates.slice(0, 20);
    return {
      proposalId: randomUUID(),
      projectIndexPath: this.projectIndexPath,
      summary: `识别到 ${projects.length} 个项目，其中 ${projects.filter((project) => project.category === "current").length} 个当前项目，可创建 ${limitedTaskCandidates.length} 个任务候选。`,
      projects,
      taskCandidates: limitedTaskCandidates,
    };
  }

  private async findNextActions(note: ObsidianNote): Promise<Array<{
    title: string;
    estimatedMinutes: number;
    sourcePath: string;
  }>> {
    const direct = extractNextActions(note.content);
    if (direct.length > 0) {
      return direct.map((title) => ({ title, estimatedMinutes: 25, sourcePath: note.relativePath }));
    }
    const progressLink = extractWikiLinks(note.content).find((link) =>
      `${link.target} ${link.alias ?? ""}`.includes("当前进度"));
    if (!progressLink) return [];
    const progressNote = await this.readLinkedNote(note.relativePath, progressLink.target);
    return extractNextActions(progressNote.content).map((title) => ({
      title,
      estimatedMinutes: 25,
      sourcePath: progressNote.relativePath,
    }));
  }

  private async readLinkedNote(currentPath: string, target: string): Promise<ObsidianNote> {
    const vaultRelative = normalizeWikiTarget(target);
    try {
      return await this.reader.readNote(vaultRelative);
    } catch (firstError) {
      const currentFolderRelative = resolveLinkedPath(currentPath, target);
      if (currentFolderRelative === vaultRelative) throw firstError;
      return this.reader.readNote(currentFolderRelative);
    }
  }
}

function extractProjectLinks(content: string): ProjectLink[] {
  const links: ProjectLink[] = [];
  for (const section of splitSections(content)) {
    const category = categoryForHeading(section.heading);
    if (!category) continue;
    for (const link of extractWikiLinks(section.body)) links.push({ ...link, category });
  }
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = normalizeWikiTarget(link.target).toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractWikiLinks(content: string): Array<{ target: string; alias: string | null }> {
  return [...content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)].map((match) => ({
    target: match[1].trim(),
    alias: match[2]?.trim() || null,
  }));
}

function categoryForHeading(heading: string): ProjectCategory | null {
  if (heading.includes("当前项目")) return "current";
  if (heading.includes("支撑系统")) return "support";
  if (heading.includes("暂停") || heading.includes("归档")) return "paused";
  return null;
}

function toProjectCandidate(note: ObsidianNote, link: ProjectLink): ObsidianProjectCandidate {
  const frontmatterName = valueAsString(note.frontmatter.project);
  const frontmatterStatus = valueAsString(note.frontmatter.project_status)
    || valueAsString(note.frontmatter.status);
  return {
    sourcePath: note.relativePath,
    name: (frontmatterName || link.alias || note.title).slice(0, 120),
    status: normalizeStatus(frontmatterStatus, link.category),
    category: link.category,
    goal: extractSectionText(note.content, ["项目目标", "第一阶段目标", "当前验收标准", "一句话定义", "项目定位"], 500),
    currentStage: extractSectionText(note.content, ["当前阶段", "当前第一阶段"], 300),
    sourceModifiedAt: note.modifiedAt,
  };
}

function normalizeStatus(value: string | null, category: ProjectCategory): ProjectStatus {
  if (category === "paused") return "paused";
  const normalized = value?.trim().toLowerCase();
  if (normalized === "testing") return "testing";
  if (normalized === "paused") return "paused";
  if (normalized === "completed") return "completed";
  if (normalized === "archived") return "archived";
  return "active";
}

function extractNextActions(content: string): string[] {
  const preferredHeadings = ["下一步", "下一步行动", "关键动作", "最低有效动作", "当前重点"];
  for (const section of splitSections(content)) {
    if (!preferredHeadings.some((heading) => section.heading.includes(heading))) continue;
    const actions = section.body.split(/\r?\n/)
      .map((line) => line.match(/^\s*(?:-\s+(?:\[ \]\s*)?|\d+[.)]\s+)(.+)$/)?.[1]?.trim() ?? "")
      .map(cleanMarkdown)
      .filter((value) => value.length >= 2 && !value.startsWith("[["))
      .map((value) => value.replace(/[；;。.]$/, "").slice(0, 120));
    if (actions.length > 0) return [...new Set(actions)].slice(0, 3);
  }
  return [];
}

function extractSectionText(content: string, headings: string[], limit: number): string | null {
  for (const section of splitSections(content)) {
    if (!headings.some((heading) => section.heading.includes(heading))) continue;
    const lines = section.body.split(/\r?\n/)
      .map((line) => cleanMarkdown(line.replace(/^\s*(?:[-*>]|\d+[.)])\s*/, "")))
      .filter((line) => line && !line.startsWith("```"));
    if (lines.length > 0) return lines.slice(0, 3).join(" ").slice(0, limit);
  }
  return null;
}

function splitSections(content: string): MarkdownSection[] {
  const matches = [...content.matchAll(/^##\s+(.+)$/gm)];
  return matches.map((match, index) => ({
    heading: match[1].trim(),
    body: content.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? content.length).trim(),
  }));
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/\*\*|__|`/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .trim();
}

function normalizeWikiTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

function resolveLinkedPath(currentPath: string, target: string): string {
  const folder = path.posix.dirname(currentPath);
  return normalizeWikiTarget(folder === "." ? target : `${folder}/${target}`);
}

function candidateKey(sourcePath: string, title: string): string {
  return createHash("sha256").update(`${sourcePath}\n${title}`, "utf8").digest("hex").slice(0, 32);
}

function valueAsString(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
