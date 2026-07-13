import { useEffect, useState } from "react";
import { ActionPanel } from "./components/ActionPanel";
import { PetAvatar } from "./pet/PetAvatar";
import type { PetState } from "./pet/petMachine";
import { PET_STATE_LABELS } from "./pet/petMachine";

const FOCUS_SECONDS = 25 * 60;

export function App(): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [petState, setPetState] = useState<PetState>("idle");
  const [focusActive, setFocusActive] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(FOCUS_SECONDS);
  const [tasks, setTasks] = useState<StepBeastTask[]>([]);
  const [taskError, setTaskError] = useState<string | null>(null);

  const activeTask = tasks.find((task) => task.status === "todo" || task.status === "doing") ?? null;

  useEffect(() => {
    if (!window.stepBeast) return;
    window.stepBeast.tasks.list()
      .then(setTasks)
      .catch((error: unknown) => setTaskError(errorMessage(error)));
  }, []);

  useEffect(() => {
    window.stepBeast?.window.setExpanded(expanded);
  }, [expanded]);

  useEffect(() => {
    if (!focusActive) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          setFocusActive(false);
          setPetState("happy");
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusActive]);

  function toggleFocus(): void {
    if (!activeTask) return;
    if (remainingSeconds === 0) setRemainingSeconds(FOCUS_SECONDS);
    setFocusActive((active) => {
      const next = !active;
      setPetState(next ? "focused" : "idle");
      return next;
    });
  }

  async function createTask(title: string): Promise<void> {
    if (!window.stepBeast) throw new Error("请在步步兽桌面应用中创建任务");
    setTaskError(null);
    try {
      const created = await window.stepBeast.tasks.create({ title, estimatedMinutes: 25 });
      setTasks((current) => [created, ...current]);
      setPetState("happy");
    } catch (error) {
      setTaskError(errorMessage(error));
      throw error;
    }
  }

  async function completeTask(id: string): Promise<void> {
    if (!window.stepBeast) throw new Error("请在步步兽桌面应用中完成任务");
    setTaskError(null);
    try {
      const completed = await window.stepBeast.tasks.complete(id);
      setTasks((current) => current
        .map((task) => task.id === id ? completed : task)
        .sort((left, right) => Number(left.status === "completed") - Number(right.status === "completed")));
      setPetState("happy");
      if (activeTask?.id === id) {
        setFocusActive(false);
        setRemainingSeconds(FOCUS_SECONDS);
      }
    } catch (error) {
      setTaskError(errorMessage(error));
      throw error;
    }
  }

  async function updateTask(id: string, title: string): Promise<void> {
    if (!window.stepBeast) throw new Error("请在步步兽桌面应用中修改任务");
    setTaskError(null);
    try {
      const currentTask = tasks.find((task) => task.id === id);
      const updated = await window.stepBeast.tasks.update(id, {
        title,
        estimatedMinutes: currentTask?.estimatedMinutes,
        nextAction: currentTask?.nextAction,
      });
      setTasks((current) => current.map((task) => task.id === id ? updated : task));
    } catch (error) {
      setTaskError(errorMessage(error));
      throw error;
    }
  }

  async function deleteTask(id: string): Promise<void> {
    if (!window.stepBeast) throw new Error("请在步步兽桌面应用中删除任务");
    setTaskError(null);
    try {
      await window.stepBeast.tasks.delete(id);
      setTasks((current) => current.filter((task) => task.id !== id));
      if (activeTask?.id === id) {
        setFocusActive(false);
        setRemainingSeconds(FOCUS_SECONDS);
        setPetState("idle");
      }
    } catch (error) {
      setTaskError(errorMessage(error));
      throw error;
    }
  }

  return (
    <main className={`desktop-pet ${expanded ? "desktop-pet--expanded" : ""}`}>
      {expanded && (
        <ActionPanel
          tasks={tasks}
          activeTask={activeTask}
          taskError={taskError}
          focusActive={focusActive}
          remainingSeconds={remainingSeconds}
          onCreateTask={createTask}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onCompleteTask={completeTask}
          onToggleFocus={toggleFocus}
          onClose={() => setExpanded(false)}
          onQuit={() => window.stepBeast?.window.close()}
        />
      )}

      <div className="pet-stage">
        <div className="pet-speech" aria-live="polite">
          {expanded ? PET_STATE_LABELS[petState] : "点我，开始今天"}
        </div>
        <PetAvatar
          state={petState}
          onStateChange={setPetState}
          onTap={() => setExpanded((value) => !value)}
        />
      </div>
    </main>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "任务操作失败，请重试";
}
