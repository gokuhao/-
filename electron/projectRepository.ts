import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  ObsidianProjectCandidate,
  ObsidianProjectProposal,
  ObsidianTaskCandidate,
  ProjectCategory,
  ProjectStatus,
} from "./obsidianProjectService.js";
import { rewardForMinutes } from "./taskRepository.js";

export type ProjectRecord = {
  id: string;
  name: string;
  status: ProjectStatus;
  category: ProjectCategory;
  goal: string | null;
  currentStage: string | null;
  sourceNotePath: string;
  sourceModifiedAt: string;
  updatedAt: string;
};

export type ConfirmProjectSyncInput = {
  proposal: ObsidianProjectProposal;
  selectedCandidateKeys: string[];
};

export type ProjectSyncResult = {
  projects: ProjectRecord[];
  createdTaskIds: string[];
};

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  category: ProjectCategory;
  goal: string | null;
  current_stage: string | null;
  source_note_path: string;
  source_modified_at: string;
  updated_at: string;
};

export class ProjectRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  list(): ProjectRecord[] {
    const rows = this.database.prepare(`
      SELECT id, name, status, category, goal, current_stage,
             source_note_path, source_modified_at, updated_at
      FROM projects
      ORDER BY CASE category WHEN 'current' THEN 0 WHEN 'support' THEN 1 ELSE 2 END, name
    `).all() as unknown as ProjectRow[];
    return rows.map(mapProjectRow);
  }

  confirmSync(input: ConfirmProjectSyncInput): ProjectSyncResult {
    const normalized = validateSyncInput(input);
    const existing = this.database.prepare(`
      SELECT proposal_id FROM project_sync_proposals WHERE proposal_id = ?
    `).get(normalized.proposal.proposalId);
    if (existing) return this.readSyncResult(normalized.proposal.proposalId);

    const now = new Date().toISOString();
    const projectIds = new Map<string, string>();
    const createdTaskIds: string[] = [];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const upsertProject = this.database.prepare(`
        INSERT INTO projects (
          id, name, status, category, goal, current_stage,
          source_note_path, source_modified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_note_path) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          category = excluded.category,
          goal = excluded.goal,
          current_stage = excluded.current_stage,
          source_modified_at = excluded.source_modified_at,
          updated_at = excluded.updated_at
      `);
      for (const project of normalized.proposal.projects) {
        const current = this.database.prepare("SELECT id FROM projects WHERE source_note_path = ?")
          .get(project.sourcePath) as { id: string } | undefined;
        const projectId = current?.id ?? randomUUID();
        upsertProject.run(
          projectId, project.name, project.status, project.category, project.goal, project.currentStage,
          project.sourcePath, project.sourceModifiedAt, now, now,
        );
        projectIds.set(project.sourcePath, projectId);
      }

      this.database.prepare(`
        INSERT INTO project_sync_proposals (
          proposal_id, project_index_path, summary, payload_json,
          selected_candidate_keys_json, confirmed_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        normalized.proposal.proposalId,
        normalized.proposal.projectIndexPath,
        normalized.proposal.summary,
        JSON.stringify(normalized.proposal),
        JSON.stringify(normalized.selectedCandidateKeys),
        now,
      );

      const selected = new Set(normalized.selectedCandidateKeys);
      for (const candidate of normalized.proposal.taskCandidates) {
        if (!selected.has(candidate.candidateKey)) continue;
        const imported = this.database.prepare(`
          SELECT task_id FROM obsidian_task_imports WHERE candidate_key = ?
        `).get(candidate.candidateKey) as { task_id: string } | undefined;
        if (imported) {
          createdTaskIds.push(imported.task_id);
          continue;
        }
        const projectId = projectIds.get(candidate.projectSourcePath);
        if (!projectId) throw new Error("任务候选没有对应项目");
        const taskId = randomUUID();
        this.database.prepare(`
          INSERT INTO tasks (
            id, project_id, title, status, estimated_minutes, next_action,
            evidence, reward_xp, source, created_at, updated_at
          ) VALUES (?, ?, ?, 'todo', ?, NULL, ?, ?, 'obsidian', ?, ?)
        `).run(
          taskId, projectId, candidate.title, candidate.estimatedMinutes,
          `Obsidian: ${candidate.sourcePath}`,
          rewardForMinutes(candidate.estimatedMinutes), now, now,
        );
        this.database.prepare(`
          INSERT INTO obsidian_task_imports (
            candidate_key, proposal_id, project_id, task_id, source_note_path, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(candidate.candidateKey, normalized.proposal.proposalId, projectId, taskId, candidate.sourcePath, now);
        createdTaskIds.push(taskId);
      }

      this.database.prepare(`
        INSERT INTO events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'ObsidianProjectSyncConfirmed', 'project_sync', ?, ?, ?)
      `).run(
        randomUUID(), normalized.proposal.proposalId,
        JSON.stringify({
          projectCount: normalized.proposal.projects.length,
          selectedTaskCount: normalized.selectedCandidateKeys.length,
        }),
        now,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { projects: this.list(), createdTaskIds };
  }

  close(): void {
    this.database.close();
  }

  private readSyncResult(proposalId: string): ProjectSyncResult {
    const row = this.database.prepare(`
      SELECT selected_candidate_keys_json FROM project_sync_proposals WHERE proposal_id = ?
    `).get(proposalId) as { selected_candidate_keys_json: string };
    const keys = JSON.parse(row.selected_candidate_keys_json) as string[];
    const createdTaskIds = keys.map((key) => {
      const imported = this.database.prepare(`
        SELECT task_id FROM obsidian_task_imports WHERE candidate_key = ?
      `).get(key) as { task_id: string } | undefined;
      return imported?.task_id;
    }).filter((id): id is string => Boolean(id));
    return { projects: this.list(), createdTaskIds };
  }

  private migrate(): void {
    const migration = this.database.prepare("SELECT version FROM schema_migrations WHERE version = 7").get();
    if (migration) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'testing', 'paused', 'completed', 'archived')),
          category TEXT NOT NULL CHECK (category IN ('current', 'support', 'paused')),
          goal TEXT,
          current_stage TEXT,
          source_note_path TEXT UNIQUE NOT NULL,
          source_modified_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE project_sync_proposals (
          proposal_id TEXT PRIMARY KEY,
          project_index_path TEXT NOT NULL,
          summary TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          selected_candidate_keys_json TEXT NOT NULL,
          confirmed_at TEXT NOT NULL
        );
        CREATE TABLE obsidian_task_imports (
          candidate_key TEXT PRIMARY KEY,
          proposal_id TEXT NOT NULL REFERENCES project_sync_proposals(proposal_id),
          project_id TEXT NOT NULL REFERENCES projects(id),
          task_id TEXT UNIQUE NOT NULL REFERENCES tasks(id),
          source_note_path TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX projects_status ON projects(status, category);
        CREATE INDEX obsidian_task_imports_project_id ON obsidian_task_imports(project_id);
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (7, 'add_obsidian_project_sync', datetime('now'));
      `);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function validateSyncInput(input: ConfirmProjectSyncInput): ConfirmProjectSyncInput {
  const proposal = input?.proposal;
  if (!proposal?.proposalId || proposal.proposalId.length > 100) throw new Error("项目同步提案 ID 无效");
  if (!isSafeMarkdownPath(proposal.projectIndexPath)) throw new Error("项目总览路径无效");
  if (!proposal.summary?.trim() || proposal.summary.length > 500) throw new Error("项目同步摘要无效");
  if (!Array.isArray(proposal.projects) || proposal.projects.length < 1 || proposal.projects.length > 20) {
    throw new Error("项目同步需要包含 1 到 20 个项目");
  }
  const sourcePaths = new Set<string>();
  const projects = proposal.projects.map((project) => validateProject(project, sourcePaths));
  if (!Array.isArray(proposal.taskCandidates) || proposal.taskCandidates.length > 20) {
    throw new Error("任务候选不能超过 20 个");
  }
  const candidateKeys = new Set<string>();
  const taskCandidates = proposal.taskCandidates.map((candidate) =>
    validateTaskCandidate(candidate, projects, candidateKeys));
  if (!Array.isArray(input.selectedCandidateKeys) || input.selectedCandidateKeys.length > 5) {
    throw new Error("一次最多确认 5 个任务候选");
  }
  const selectedCandidateKeys = input.selectedCandidateKeys.map((key) => key?.trim());
  if (new Set(selectedCandidateKeys).size !== selectedCandidateKeys.length
    || selectedCandidateKeys.some((key) => !candidateKeys.has(key))) {
    throw new Error("选择的任务候选无效");
  }
  return {
    proposal: {
      ...proposal,
      summary: proposal.summary.trim(),
      projects,
      taskCandidates,
    },
    selectedCandidateKeys,
  };
}

function validateProject(project: ObsidianProjectCandidate, seen: Set<string>): ObsidianProjectCandidate {
  const sourcePath = project.sourcePath?.trim();
  const name = project.name?.trim();
  if (!sourcePath || !isSafeMarkdownPath(sourcePath) || seen.has(sourcePath)) throw new Error("项目来源路径无效或重复");
  if (!name || name.length > 120) throw new Error("项目名称无效");
  if (!["active", "testing", "paused", "completed", "archived"].includes(project.status)) throw new Error("项目状态无效");
  if (!["current", "support", "paused"].includes(project.category)) throw new Error("项目类别无效");
  if (project.goal && project.goal.length > 500) throw new Error("项目目标过长");
  if (project.currentStage && project.currentStage.length > 300) throw new Error("项目阶段过长");
  if (!project.sourceModifiedAt || Number.isNaN(Date.parse(project.sourceModifiedAt))) throw new Error("项目修改时间无效");
  seen.add(sourcePath);
  return { ...project, sourcePath, name, goal: project.goal?.trim() || null, currentStage: project.currentStage?.trim() || null };
}

function validateTaskCandidate(
  candidate: ObsidianTaskCandidate,
  projects: ObsidianProjectCandidate[],
  seen: Set<string>,
): ObsidianTaskCandidate {
  const title = candidate.title?.trim();
  const project = projects.find((value) => value.sourcePath === candidate.projectSourcePath);
  const expectedKey = project ? candidateKey(project.sourcePath, title) : "";
  if (!candidate.candidateKey || candidate.candidateKey !== expectedKey || seen.has(candidate.candidateKey)) {
    throw new Error("任务候选标识无效或重复");
  }
  if (!project || project.status !== "active" || project.category !== "current") {
    throw new Error("任务候选只能来自当前进行中的项目");
  }
  if (!title || title.length > 120) throw new Error("任务候选标题无效");
  if (!Number.isInteger(candidate.estimatedMinutes) || candidate.estimatedMinutes < 1 || candidate.estimatedMinutes > 240) {
    throw new Error("任务候选预计时间无效");
  }
  if (!isSafeMarkdownPath(candidate.sourcePath)) throw new Error("任务候选来源路径无效");
  seen.add(candidate.candidateKey);
  return { ...candidate, title };
}

function candidateKey(sourcePath: string, title: string): string {
  return createHash("sha256").update(`${sourcePath}\n${title}`, "utf8").digest("hex").slice(0, 32);
}

function isSafeMarkdownPath(value: string): boolean {
  return Boolean(value)
    && !value.includes("..")
    && !value.startsWith("/")
    && !/^[a-zA-Z]:/.test(value)
    && value.toLowerCase().endsWith(".md");
}

function mapProjectRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    category: row.category,
    goal: row.goal,
    currentStage: row.current_stage,
    sourceNotePath: row.source_note_path,
    sourceModifiedAt: row.source_modified_at,
    updatedAt: row.updated_at,
  };
}
