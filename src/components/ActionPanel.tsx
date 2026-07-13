import { useState } from "react";
import type { FormEvent } from "react";

type ActionPanelProps = {
  tasks: StepBeastTask[];
  activeTask: StepBeastTask | null;
  taskError: string | null;
  focusActive: boolean;
  remainingSeconds: number;
  onCreateTask: (title: string) => Promise<void>;
  onCompleteTask: (id: string) => Promise<void>;
  onToggleFocus: () => void;
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
  activeTask,
  taskError,
  focusActive,
  remainingSeconds,
  onCreateTask,
  onCompleteTask,
  onToggleFocus,
  onClose,
  onQuit,
}: ActionPanelProps): React.JSX.Element {
  const [addingTask, setAddingTask] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

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

  return (
    <section className="action-panel" aria-label="步步兽行动面板">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">今天只推进一件事</p>
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

      <div className="task-list" aria-label="任务清单">
        {tasks.length === 0 ? (
          <p className="task-empty">任务清单还是空的。</p>
        ) : tasks.slice(0, 3).map((task) => (
          <div className={`task-item task-item--${task.status}`} key={task.id}>
            <span>{task.title}</span>
            {task.status === "completed" ? (
              <small>已完成</small>
            ) : (
              <button
                type="button"
                disabled={completingId === task.id}
                onClick={() => void completeTask(task.id)}
                aria-label={`完成任务：${task.title}`}
              >
                {completingId === task.id ? "…" : "完成"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="focus-row">
        <div>
          <span className="focus-label">{focusActive ? "专注进行中" : "25 分钟专注"}</span>
          <strong className="timer">{formatTime(remainingSeconds)}</strong>
        </div>
        <button className="primary-button" type="button" onClick={onToggleFocus} disabled={!activeTask}>
          {focusActive ? "暂停" : remainingSeconds < 1500 ? "继续" : "开始"}
        </button>
      </div>

      <footer className="panel-footer">
        <span>Lv.1 · 0 / 100 XP</span>
        <button type="button" onClick={onQuit}>退出步步兽</button>
      </footer>
    </section>
  );
}
