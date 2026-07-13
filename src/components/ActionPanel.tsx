import { useState } from "react";
import type { FormEvent } from "react";

type ActionPanelProps = {
  tasks: StepBeastTask[];
  taskRoles: Partial<Record<string, StepBeastPlanRole>>;
  activeTask: StepBeastTask | null;
  taskError: string | null;
  petProfile: StepBeastPetProfile | null;
  hermesStatus: StepBeastHermesStatus | null;
  hermesChecking: boolean;
  decompositionProposal: StepBeastDecompositionProposal | null;
  decomposingTaskId: string | null;
  confirmingProposal: boolean;
  focusActive: boolean;
  focusPaused: boolean;
  remainingSeconds: number;
  onCreateTask: (title: string) => Promise<void>;
  onUpdateTask: (id: string, title: string) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onCompleteTask: (id: string) => Promise<void>;
  onSetTaskRole: (id: string, role: StepBeastPlanRole | null) => Promise<void>;
  onToggleFocus: () => void;
  onRetryHermes: () => void;
  onDecomposeTask: (id: string) => void;
  onConfirmDecomposition: () => void;
  onCancelDecomposition: () => void;
  onClose: () => void;
  onQuit: () => void;
};

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function ActionPanel({
  tasks,
  taskRoles,
  activeTask,
  taskError,
  petProfile,
  hermesStatus,
  hermesChecking,
  decompositionProposal,
  decomposingTaskId,
  confirmingProposal,
  focusActive,
  focusPaused,
  remainingSeconds,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onCompleteTask,
  onSetTaskRole,
  onToggleFocus,
  onRetryHermes,
  onDecomposeTask,
  onConfirmDecomposition,
  onCancelDecomposition,
  onClose,
  onQuit,
}: ActionPanelProps): React.JSX.Element {
  const [addingTask, setAddingTask] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const mainCount = Object.values(taskRoles).filter((role) => role === "main").length;
  const supportCount = Object.values(taskRoles).filter((role) => role === "support").length;
  const level = petProfile?.level ?? 1;
  const totalXp = petProfile?.totalXp ?? 0;
  const currentLevelXp = (100 * (level - 1) * level) / 2;
  const nextLevelXp = (100 * level * (level + 1)) / 2;
  const levelProgress = Math.min(100, ((totalXp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100);
  const displayedTasks = [...tasks]
    .sort((left, right) => roleRank(taskRoles[left.id]) - roleRank(taskRoles[right.id]))
    .slice(0, 3);

  async function submitTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onCreateTask(title);
      setTitle("");
      setAddingTask(false);
    } catch {
      // 父组件会显示来自主进程的可读错误，表单保留输入方便修改。
    } finally {
      setSaving(false);
    }
  }

  async function completeTask(id: string): Promise<void> {
    setCompletingId(id);
    try {
      await onCompleteTask(id);
    } catch {
      // 错误由父组件统一展示。
    } finally {
      setCompletingId(null);
    }
  }

  async function submitTaskEdit(event: FormEvent<HTMLFormElement>, id: string): Promise<void> {
    event.preventDefault();
    if (!editingTitle.trim() || saving) return;
    setSaving(true);
    try {
      await onUpdateTask(id, editingTitle);
      setEditingId(null);
      setEditingTitle("");
    } catch {
      // 错误由父组件统一展示，并保留当前输入。
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask(id: string): Promise<void> {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }
    setDeletingId(id);
    try {
      await onDeleteTask(id);
      setDeleteConfirmId(null);
    } catch {
      // 错误由父组件统一展示。
    } finally {
      setDeletingId(null);
    }
  }

  async function setTaskRole(id: string, role: string): Promise<void> {
    setChangingRoleId(id);
    try {
      await onSetTaskRole(id, role === "main" || role === "support" ? role : null);
    } catch {
      // 数据库规则错误由父组件展示，受控选项会保持原值。
    } finally {
      setChangingRoleId(null);
    }
  }

  return (
    <section className="action-panel" aria-label="步步兽行动面板">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">{activeTask && taskRoles[activeTask.id] === "main" ? "今日主线" : "今天只推进一件事"}</p>
          <h1>{activeTask?.title ?? "先添加今天最重要的任务"}</h1>
        </div>
        <div className="panel-actions">
          <button className="icon-button" type="button" onClick={() => setAddingTask((value) => !value)} aria-label="添加任务">＋</button>
          <button className="icon-button" type="button" onClick={onClose} aria-label="收起面板">×</button>
        </div>
      </header>

      {addingTask ? (
        <form className="task-form" onSubmit={submitTask}>
          <label htmlFor="new-task-title">任务名称</label>
          <div>
            <input
              id="new-task-title"
              value={title}
              maxLength={120}
              autoFocus
              placeholder="例如：完成视频脚本初稿"
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="submit" disabled={!title.trim() || saving}>{saving ? "保存中" : "添加"}</button>
          </div>
        </form>
      ) : (
        <div className="next-action">
          <span>下一步</span>
          <strong>{activeTask?.nextAction ?? (activeTask ? "开始一个 25 分钟专注" : "点击右上角＋创建任务")}</strong>
        </div>
      )}

      {taskError && <p className="task-error" role="alert">{taskError}</p>}

      <div className="plan-status" aria-label="今日计划状态">
        <span>主线 {mainCount}/1</span>
        <span>辅助 {supportCount}/2</span>
      </div>

      <div className="task-list" aria-label="任务清单">
        {tasks.length === 0 ? (
          <p className="task-empty">任务清单还是空的。</p>
        ) : displayedTasks.map((task) => editingId === task.id ? (
          <form className="task-edit-form" key={task.id} onSubmit={(event) => void submitTaskEdit(event, task.id)}>
            <input
              value={editingTitle}
              maxLength={120}
              autoFocus
              aria-label={`修改任务：${task.title}`}
              onChange={(event) => setEditingTitle(event.target.value)}
            />
            <button type="submit" disabled={!editingTitle.trim() || saving}>保存</button>
            <button type="button" onClick={() => setEditingId(null)}>取消</button>
          </form>
        ) : (
          <div className={`task-item task-item--${task.status}`} key={task.id}>
            <div className="task-item-copy">
              <span title={task.title}>{task.title}</span>
              {task.actualMinutes > 0 && <small>已专注 {task.actualMinutes} 分钟</small>}
            </div>
            <div className="task-item-actions">
              <select
                value={taskRoles[task.id] ?? ""}
                disabled={task.status === "completed" || changingRoleId === task.id}
                onChange={(event) => void setTaskRole(task.id, event.target.value)}
                aria-label={`设置今日角色：${task.title}`}
              >
                <option value="">任务池</option>
                <option value="main">主线</option>
                <option value="support">辅助</option>
              </select>
              {task.status !== "completed" && (
                <button
                  type="button"
                  disabled={completingId === task.id}
                  onClick={() => void completeTask(task.id)}
                  aria-label={`完成任务：${task.title}`}
                >
                  {completingId === task.id ? "…" : "完成"}
                </button>
              )}
              {task.status !== "completed" && (
                <button
                  type="button"
                  disabled={hermesStatus?.state !== "ready" || decomposingTaskId !== null}
                  onClick={() => onDecomposeTask(task.id)}
                  aria-label={`AI 拆解任务：${task.title}`}
                >
                  {decomposingTaskId === task.id ? "…" : "AI"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditingId(task.id);
                  setEditingTitle(task.title);
                  setDeleteConfirmId(null);
                }}
                aria-label={`修改任务：${task.title}`}
              >改</button>
              <button
                className={deleteConfirmId === task.id ? "danger-button" : ""}
                type="button"
                disabled={deletingId === task.id}
                onClick={() => void deleteTask(task.id)}
                aria-label={deleteConfirmId === task.id ? `确认删除任务：${task.title}` : `删除任务：${task.title}`}
              >{deletingId === task.id ? "…" : deleteConfirmId === task.id ? "确认" : "删"}</button>
            </div>
          </div>
        ))}
      </div>

      <div className="focus-row">
        <div>
          <span className="focus-label">{focusActive ? "专注进行中" : focusPaused ? "专注已暂停" : "25 分钟专注"}</span>
          <strong className="timer">{formatTime(remainingSeconds)}</strong>
        </div>
        <button className="primary-button" type="button" onClick={onToggleFocus} disabled={!activeTask}>
          {focusActive ? "暂停" : focusPaused ? "继续" : "开始"}
        </button>
      </div>

      <button
        className={`hermes-status hermes-status--${hermesStatus?.state ?? "offline"}`}
        type="button"
        onClick={onRetryHermes}
        disabled={hermesChecking}
        title={hermesStatus?.baseUrl}
        aria-label="重新检查 Hermes 连接"
      >
        <span className="hermes-dot" />
        <span>{hermesChecking ? "正在检查 Hermes" : hermesStatus?.message ?? "Hermes 状态未知"}</span>
        <small>重试</small>
      </button>

      <footer className="panel-footer">
        <div className="growth-status">
          <span>Lv.{level} · {totalXp} / {nextLevelXp} XP</span>
          <span className="xp-track" aria-label={`等级进度 ${Math.round(levelProgress)}%`}>
            <span style={{ width: `${levelProgress}%` }} />
          </span>
        </div>
        <button type="button" onClick={onQuit}>退出步步兽</button>
      </footer>

      {decompositionProposal && (
        <section className="proposal-overlay" aria-label="AI 任务拆解提案">
          <p className="panel-kicker">Hermes 拆解提案</p>
          <h2>{decompositionProposal.summary}</h2>
          {decompositionProposal.attempts > 1 && <small className="proposal-retry">已自动修正一次格式</small>}
          <ol>
            {decompositionProposal.steps.map((step, index) => (
              <li key={`${index}-${step.title}`}>
                <div>
                  <strong>{step.title}</strong>
                  <span>{step.estimatedMinutes} 分钟</span>
                </div>
                <small>完成标准：{step.doneWhen}</small>
              </li>
            ))}
          </ol>
          <div className="proposal-actions">
            <button type="button" onClick={onCancelDecomposition} disabled={confirmingProposal}>取消</button>
            <button type="button" onClick={onConfirmDecomposition} disabled={confirmingProposal}>
              {confirmingProposal ? "创建中…" : `确认创建 ${decompositionProposal.steps.length} 个子任务`}
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

function roleRank(role: StepBeastPlanRole | undefined): number {
  if (role === "main") return 0;
  if (role === "support") return 1;
  return 2;
}
