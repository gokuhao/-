import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type ActionPanelProps = {
  tasks: StepBeastTask[];
  taskRoles: Partial<Record<string, StepBeastPlanRole>>;
  activeTask: StepBeastTask | null;
  taskError: string | null;
  hermesStatus: StepBeastHermesStatus | null;
  hermesChecking: boolean;
  obsidianStatus: StepBeastObsidianStatus | null;
  obsidianChecking: boolean;
  decompositionProposal: StepBeastDecompositionProposal | null;
  decomposingTaskId: string | null;
  confirmingProposal: boolean;
  dailyPlanProposal: StepBeastDailyPlanProposal | null;
  generatingDailyPlan: boolean;
  confirmingDailyPlan: boolean;
  focusActive: boolean;
  focusPaused: boolean;
  focusSetupOpen: boolean;
  focusPlannedSeconds: number;
  remainingSeconds: number;
  onCreateTask: (title: string) => Promise<void>;
  onUpdateTask: (id: string, title: string) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onCompleteTask: (id: string) => Promise<void>;
  onSetTaskRole: (id: string, role: StepBeastPlanRole | null) => Promise<void>;
  onToggleFocus: () => void;
  onOpenFocusSetup: () => void;
  onCancelFocusSetup: () => void;
  onStartFocus: (taskId: string, plannedMinutes: number) => Promise<void>;
  onStopFocus: () => Promise<void>;
  onRetryHermes: () => void;
  onRetryObsidian: () => void;
  onDecomposeTask: (id: string) => void;
  onConfirmDecomposition: () => void;
  onCancelDecomposition: () => void;
  onGenerateDailyPlan: () => void;
  onConfirmDailyPlan: () => void;
  onCancelDailyPlan: () => void;
  onOpenTool: (tool: "chat" | "more") => void;
  onClose: () => void;
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
  hermesStatus,
  hermesChecking,
  obsidianStatus,
  obsidianChecking,
  decompositionProposal,
  decomposingTaskId,
  confirmingProposal,
  dailyPlanProposal,
  generatingDailyPlan,
  confirmingDailyPlan,
  focusActive,
  focusPaused,
  focusSetupOpen,
  focusPlannedSeconds,
  remainingSeconds,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onCompleteTask,
  onSetTaskRole,
  onToggleFocus,
  onOpenFocusSetup,
  onCancelFocusSetup,
  onStartFocus,
  onStopFocus,
  onRetryHermes,
  onRetryObsidian,
  onDecomposeTask,
  onConfirmDecomposition,
  onCancelDecomposition,
  onGenerateDailyPlan,
  onConfirmDailyPlan,
  onCancelDailyPlan,
  onOpenTool,
  onClose,
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
  const [managingTasks, setManagingTasks] = useState(false);
  const [selectedFocusTaskId, setSelectedFocusTaskId] = useState("");
  const [focusDuration, setFocusDuration] = useState<number | "custom">(25);
  const [customFocusMinutes, setCustomFocusMinutes] = useState("30");
  const [startingFocus, setStartingFocus] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [stoppingFocus, setStoppingFocus] = useState(false);
  const mainCount = Object.values(taskRoles).filter((role) => role === "main").length;
  const supportCount = Object.values(taskRoles).filter((role) => role === "support").length;
  const displayedTasks = [...tasks]
    .sort((left, right) => roleRank(taskRoles[left.id]) - roleRank(taskRoles[right.id]));
  const activeTasks = displayedTasks.filter(isActiveTask);
  const nextTask = displayedTasks.find((task) => isActiveTask(task) && task.id !== activeTask?.id) ?? null;
  const selectedFocusMinutes = focusDuration === "custom" ? Number(customFocusMinutes) : focusDuration;
  const focusDurationValid = Number.isInteger(selectedFocusMinutes) && selectedFocusMinutes >= 5 && selectedFocusMinutes <= 180;
  const focusRatio = Math.max(0, Math.min(1, remainingSeconds / focusPlannedSeconds));
  const ringCircumference = 2 * Math.PI * 54;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const todayLabel = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(now);

  useEffect(() => {
    if (!focusSetupOpen) return;
    setSelectedFocusTaskId((current) => {
      if (tasks.some((task) => task.id === current && isActiveTask(task))) return current;
      return activeTask?.id ?? tasks.find(isActiveTask)?.id ?? "";
    });
  }, [focusSetupOpen, activeTask?.id, tasks]);

  useEffect(() => {
    if (!focusActive && !focusPaused) setConfirmingStop(false);
  }, [focusActive, focusPaused]);

  async function startSelectedFocus(): Promise<void> {
    if (!selectedFocusTaskId || !focusDurationValid || startingFocus) return;
    setStartingFocus(true);
    try {
      await onStartFocus(selectedFocusTaskId, selectedFocusMinutes);
    } catch {
      // 父组件统一显示可读错误，保留当前选择方便用户修改。
    } finally {
      setStartingFocus(false);
    }
  }

  async function confirmStopFocus(): Promise<void> {
    if (stoppingFocus) return;
    setStoppingFocus(true);
    try {
      await onStopFocus();
      setConfirmingStop(false);
    } catch {
      // 父组件统一显示可读错误。
    } finally {
      setStoppingFocus(false);
    }
  }

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

  const taskManager = managingTasks && (
    <div className="apple-task-manager" aria-label="任务管理">
      <div className="apple-section-heading">
        <span>任务管理</span>
        <button type="button" onClick={() => setAddingTask((value) => !value)}>＋ 添加</button>
      </div>
      {addingTask && (
        <form className="task-form" onSubmit={submitTask}>
          <label htmlFor="new-task-title">任务名称</label>
          <div>
            <input id="new-task-title" value={title} maxLength={120} autoFocus placeholder="例如：完成视频脚本初稿" onChange={(event) => setTitle(event.target.value)} />
            <button type="submit" disabled={!title.trim() || saving}>{saving ? "保存中" : "添加"}</button>
          </div>
        </form>
      )}
      <div className="task-list">
        {tasks.length === 0 ? <p className="task-empty">任务清单还是空的。</p> : displayedTasks.map((task) => editingId === task.id ? (
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
    </div>
  );

  return (
    <section className={`action-panel apple-action-panel ${focusActive || focusPaused ? "apple-action-panel--focus" : ""}`} aria-label="步步兽行动面板">
      <header className="apple-panel-header">
        <div>
          <p className="apple-date"><span className="apple-ready-dot" />步步兽 · 今日 · {todayLabel}</p>
          <p className="apple-greeting">{greeting}，小昊</p>
        </div>
        <div className="apple-header-actions">
          <span className="apple-mini-pet" aria-hidden="true" />
          <button className="icon-button" type="button" onClick={onClose} aria-label="收起面板">×</button>
        </div>
      </header>

      {taskError && <p className="task-error" role="alert">{taskError}</p>}

      {focusActive || focusPaused ? (
        <div className="apple-focus-view">
          <div className="apple-focus-copy">
            <span>{focusPaused ? "专注已暂停" : "正在专注"}</span>
            <strong>{activeTask?.title ?? "当前任务"}</strong>
          </div>
          <div className="apple-focus-ring" aria-label={`剩余 ${formatTime(remainingSeconds)}`}>
            <svg viewBox="0 0 128 128" aria-hidden="true">
              <circle className="apple-ring-track" cx="64" cy="64" r="54" />
              <circle className="apple-ring-value" cx="64" cy="64" r="54" style={{ strokeDasharray: ringCircumference, strokeDashoffset: ringCircumference * (1 - focusRatio) }} />
            </svg>
            <div><strong>{formatTime(remainingSeconds)}</strong><span>剩余时间</span></div>
          </div>
          <div className="apple-focus-controls">
            <button type="button" onClick={onToggleFocus}>{focusActive ? "暂停" : "继续"}</button>
            <button className="apple-stop-button" type="button" onClick={() => setConfirmingStop(true)}>停止专注</button>
            <button className="apple-primary-button" type="button" disabled={!activeTask || completingId === activeTask.id} onClick={() => activeTask && void completeTask(activeTask.id)}>完成任务</button>
          </div>
          {confirmingStop && (
            <div className="apple-stop-confirm" role="alertdialog" aria-label="确认停止专注">
              <p>结束后会保存本次专注时间，任务保持未完成。</p>
              <div><button type="button" disabled={stoppingFocus} onClick={() => setConfirmingStop(false)}>继续专注</button><button type="button" disabled={stoppingFocus} onClick={() => void confirmStopFocus()}>{stoppingFocus ? "保存中…" : "确认停止"}</button></div>
            </div>
          )}
        </div>
      ) : focusSetupOpen ? (
        <div className="apple-focus-setup">
          <div className="apple-focus-setup-heading"><span>开始一次专注</span><strong>先选任务，再决定投入多久</strong></div>
          <label className="apple-focus-field">
            <span>本次专注任务</span>
            <select value={selectedFocusTaskId} onChange={(event) => setSelectedFocusTaskId(event.target.value)}>
              {activeTasks.length === 0 ? <option value="">暂无可专注任务</option> : activeTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
          </label>
          <fieldset className="apple-duration-field">
            <legend>专注时长</legend>
            <div>{[15, 25, 45, 60].map((minutes) => <button className={focusDuration === minutes ? "is-active" : ""} type="button" key={minutes} onClick={() => setFocusDuration(minutes)}>{minutes} 分钟</button>)}<button className={focusDuration === "custom" ? "is-active" : ""} type="button" onClick={() => setFocusDuration("custom")}>自定义</button></div>
          </fieldset>
          {focusDuration === "custom" && <label className="apple-custom-duration"><span>输入 5～180 分钟</span><input type="number" min={5} max={180} step={1} value={customFocusMinutes} onChange={(event) => setCustomFocusMinutes(event.target.value)} /></label>}
          <div className="apple-focus-setup-summary"><span>准备专注</span><strong>{focusDurationValid ? `${selectedFocusMinutes} 分钟` : "请输入有效时间"}</strong></div>
          <div className="apple-focus-setup-actions"><button type="button" onClick={onCancelFocusSetup}>取消</button><button className="apple-primary-button" type="button" disabled={!selectedFocusTaskId || !focusDurationValid || startingFocus} onClick={() => void startSelectedFocus()}>{startingFocus ? "启动中…" : "▶ 开始专注"}</button></div>
        </div>
      ) : (
        <>
          <div className="apple-main-task">
            <div className="apple-task-meta"><span>今天最重要</span><span>{activeTask?.estimatedMinutes ?? 25} 分钟</span></div>
            <h1>{activeTask?.title ?? "先添加今天最重要的任务"}</h1>
            <p>{activeTask?.nextAction ?? (activeTask ? "从一个 25 分钟专注开始" : "创建任务后，步步兽会陪你开始行动。")}</p>
            <div className="apple-main-actions">
              <button className="apple-primary-button" type="button" onClick={onOpenFocusSetup} disabled={!activeTask}>▶ 开始专注</button>
              <button type="button" onClick={() => setManagingTasks((value) => !value)}>{managingTasks ? "收起任务" : "管理任务"}</button>
            </div>
          </div>

          {!managingTasks && (
            <div className="apple-next-section">
              <div className="apple-section-heading">
                <span>接下来</span>
                <button type="button" disabled={hermesStatus?.state !== "ready" || generatingDailyPlan || !tasks.some(isActiveTask)} onClick={onGenerateDailyPlan}>{generatingDailyPlan ? "规划中…" : "AI 规划"}</button>
              </div>
              {nextTask ? (
                <button className="apple-next-task" type="button" onClick={() => void setTaskRole(nextTask.id, taskRoles[nextTask.id] === "support" ? "" : "support")}>
                  <span><strong>{nextTask.title}</strong><small>{taskRoles[nextTask.id] === "support" ? "今日辅助任务" : "任务池"} · {nextTask.estimatedMinutes ?? 25} 分钟</small></span>
                  <span>›</span>
                </button>
              ) : <p className="apple-empty">暂时没有下一项任务。</p>}
              <div className="apple-plan-count"><span>主线 {mainCount}/1</span><span>辅助 {supportCount}/2</span></div>
            </div>
          )}
          {taskManager}
        </>
      )}

      {(hermesStatus?.state !== "ready" || obsidianStatus?.state !== "ready") && (
        <div className="apple-service-alerts">
          {hermesStatus?.state !== "ready" && <button type="button" onClick={onRetryHermes} disabled={hermesChecking}>Hermes {hermesChecking ? "检查中" : "需要连接"}</button>}
          {obsidianStatus?.state !== "ready" && <button type="button" onClick={onRetryObsidian} disabled={obsidianChecking}>Obsidian {obsidianChecking ? "检查中" : "需要连接"}</button>}
        </div>
      )}

      <nav className="apple-bottom-nav" aria-label="主要功能">
        <button className="apple-bottom-nav--active" type="button"><span>◉</span>今日</button>
        <button type="button" onClick={() => onOpenTool("chat")}><span>○</span>对话</button>
        <button type="button" onClick={() => onOpenTool("more")}><span>▣</span>工作台</button>
      </nav>

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

      {dailyPlanProposal && (
        <section className="proposal-overlay daily-plan-proposal" aria-label="AI 每日计划提案">
          <p className="panel-kicker">Hermes 今日计划提案</p>
          <h2>{dailyPlanProposal.summary}</h2>
          <p className="proposal-reasoning">{dailyPlanProposal.reasoning}</p>
          {dailyPlanProposal.attempts > 1 && <small className="proposal-retry">已自动修正一次格式</small>}
          <ol>
            <li>
              <div>
                <strong>主线 · {taskTitle(tasks, dailyPlanProposal.mainTaskId)}</strong>
              </div>
            </li>
            {dailyPlanProposal.supportTaskIds.map((taskId, index) => (
              <li key={taskId}>
                <div>
                  <strong>辅助 {index + 1} · {taskTitle(tasks, taskId)}</strong>
                </div>
              </li>
            ))}
          </ol>
          <div className="proposal-actions">
            <button type="button" onClick={onCancelDailyPlan} disabled={confirmingDailyPlan}>取消</button>
            <button type="button" onClick={onConfirmDailyPlan} disabled={confirmingDailyPlan}>
              {confirmingDailyPlan ? "应用中…" : "确认替换今日计划"}
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

function isActiveTask(task: StepBeastTask): boolean {
  return task.status === "todo" || task.status === "doing";
}

function taskTitle(tasks: StepBeastTask[], taskId: string): string {
  return tasks.find((task) => task.id === taskId)?.title ?? "任务已不可用";
}
