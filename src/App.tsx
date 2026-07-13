import { useEffect, useState } from "react";
import { ActionPanel } from "./components/ActionPanel";
import { PetAvatar } from "./pet/PetAvatar";
import type { PetState } from "./pet/petMachine";
import { PET_STATE_LABELS } from "./pet/petMachine";

const FOCUS_SECONDS = 25 * 60;

export function App(): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [petState, setPetState] = useState<PetState>("idle");
  const [focusSession, setFocusSession] = useState<StepBeastFocusSession | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(FOCUS_SECONDS);
  const [tasks, setTasks] = useState<StepBeastTask[]>([]);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [todayPlan, setTodayPlan] = useState<StepBeastTodayPlan | null>(null);
  const [petProfile, setPetProfile] = useState<StepBeastPetProfile | null>(null);
  const [rewardNotice, setRewardNotice] = useState<string | null>(null);
  const [hermesStatus, setHermesStatus] = useState<StepBeastHermesStatus | null>(null);
  const [hermesChecking, setHermesChecking] = useState(false);
  const [decompositionProposal, setDecompositionProposal] = useState<StepBeastDecompositionProposal | null>(null);
  const [decomposingTaskId, setDecomposingTaskId] = useState<string | null>(null);
  const [confirmingProposal, setConfirmingProposal] = useState(false);
  const [dailyPlanProposal, setDailyPlanProposal] = useState<StepBeastDailyPlanProposal | null>(null);
  const [generatingDailyPlan, setGeneratingDailyPlan] = useState(false);
  const [confirmingDailyPlan, setConfirmingDailyPlan] = useState(false);

  const taskRoles = Object.fromEntries(
    (todayPlan?.items ?? []).map((item) => [item.task.id, item.role]),
  ) as Partial<Record<string, StepBeastPlanRole>>;
  const mainTaskId = todayPlan?.items.find((item) => item.role === "main")?.task.id;
  const activeTask = tasks.find((task) => task.id === focusSession?.taskId && (task.status === "todo" || task.status === "doing"))
    ?? tasks.find((task) => task.id === mainTaskId && (task.status === "todo" || task.status === "doing"))
    ?? tasks.find((task) => task.status === "todo" || task.status === "doing")
    ?? null;
  const focusActive = focusSession?.status === "active";
  const focusPaused = focusSession?.status === "paused";

  useEffect(() => {
    if (!window.stepBeast) return;
    Promise.all([
      window.stepBeast.tasks.list(),
      window.stepBeast.plan.getToday(),
      window.stepBeast.focus.getCurrent(),
      window.stepBeast.pet.getProfile(),
    ])
      .then(([storedTasks, storedPlan, storedFocus, storedProfile]) => {
        setTasks(storedTasks);
        setTodayPlan(storedPlan);
        setFocusSession(storedFocus);
        setPetProfile(storedProfile);
        if (storedFocus) {
          setRemainingSeconds(Math.max(0, storedFocus.plannedSeconds - storedFocus.elapsedSeconds));
          setPetState(storedFocus.status === "active" ? "focused" : "resting");
        }
      })
      .catch((error: unknown) => setTaskError(errorMessage(error)));
  }, []);

  useEffect(() => {
    void refreshHermesStatus();
    const timer = window.setInterval(() => void refreshHermesStatus(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.stepBeast?.window.setExpanded(expanded);
  }, [expanded]);

  useEffect(() => {
    if (!focusSession || focusSession.status !== "active") return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          void finishExpiredFocus(focusSession.id);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusSession]);

  useEffect(() => {
    if (!rewardNotice) return;
    const timer = window.setTimeout(() => setRewardNotice(null), 1800);
    return () => window.clearTimeout(timer);
  }, [rewardNotice]);

  async function toggleFocus(): Promise<void> {
    if (!window.stepBeast || (!activeTask && !focusSession)) return;
    setTaskError(null);
    try {
      if (!focusSession && activeTask) {
        const plannedSeconds = Math.min(activeTask.estimatedMinutes ?? 25, 240) * 60;
        const started = await window.stepBeast.focus.start(activeTask.id, plannedSeconds);
        setFocusSession(started);
        setRemainingSeconds(started.plannedSeconds - started.elapsedSeconds);
        setPetState("focused");
      } else if (focusSession?.status === "active") {
        const paused = await window.stepBeast.focus.pause(focusSession.id);
        setFocusSession(paused);
        setRemainingSeconds(Math.max(0, paused.plannedSeconds - paused.elapsedSeconds));
        setPetState("resting");
      } else if (focusSession?.status === "paused") {
        const resumed = await window.stepBeast.focus.resume(focusSession.id);
        setFocusSession(resumed);
        setRemainingSeconds(Math.max(0, resumed.plannedSeconds - resumed.elapsedSeconds));
        setPetState("focused");
      }
    } catch (error) {
      setTaskError(errorMessage(error));
    }
  }

  async function finishExpiredFocus(id: string): Promise<void> {
    if (!window.stepBeast) return;
    try {
      await window.stepBeast.focus.finish(id);
      setFocusSession(null);
      setPetState("happy");
    } catch (error) {
      setTaskError(errorMessage(error));
    }
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
      if (focusSession?.taskId === id) {
        await window.stepBeast.focus.finish(focusSession.id);
        setFocusSession(null);
        setRemainingSeconds(FOCUS_SECONDS);
      }
      const completion = await window.stepBeast.tasks.complete(id);
      const completed = completion.task;
      setTasks((current) => current
        .map((task) => task.id === id ? completed : task)
        .sort((left, right) => Number(left.status === "completed") - Number(right.status === "completed")));
      setTodayPlan((current) => current ? {
        ...current,
        items: current.items.map((item) => item.task.id === id ? { ...item, task: completed } : item),
      } : current);
      setPetProfile(completion.profile);
      if (completion.xpGained > 0) setRewardNotice(`+${completion.xpGained} XP`);
      setPetState("happy");
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
      if (focusSession?.taskId === id) {
        await window.stepBeast.focus.abandon(focusSession.id);
        setFocusSession(null);
        setRemainingSeconds(FOCUS_SECONDS);
      }
      await window.stepBeast.tasks.delete(id);
      setTasks((current) => current.filter((task) => task.id !== id));
      setTodayPlan((current) => current ? {
        ...current,
        items: current.items.filter((item) => item.task.id !== id),
      } : current);
      if (activeTask?.id === id) {
        setPetState("idle");
      }
    } catch (error) {
      setTaskError(errorMessage(error));
      throw error;
    }
  }

  async function setTaskRole(id: string, role: StepBeastPlanRole | null): Promise<void> {
    if (!window.stepBeast) throw new Error("请在步步兽桌面应用中设置今日计划");
    setTaskError(null);
    try {
      const plan = await window.stepBeast.plan.setRole(id, role);
      setTodayPlan(plan);
    } catch (error) {
      setTaskError(errorMessage(error));
      throw error;
    }
  }

  async function refreshHermesStatus(): Promise<void> {
    if (!window.stepBeast) return;
    setHermesChecking(true);
    try {
      setHermesStatus(await window.stepBeast.hermes.getStatus());
    } catch {
      setHermesStatus({
        state: "offline",
        message: "Hermes 状态检查失败",
        baseUrl: "http://127.0.0.1:8642",
        apiKeyConfigured: false,
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setHermesChecking(false);
    }
  }

  async function decomposeTask(id: string): Promise<void> {
    if (!window.stepBeast) return;
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    setTaskError(null);
    setDecomposingTaskId(id);
    setPetState("thinking");
    try {
      const proposal = await window.stepBeast.hermes.decomposeTask({
        id: task.id,
        title: task.title,
        estimatedMinutes: task.estimatedMinutes,
        nextAction: task.nextAction,
      });
      setDecompositionProposal(proposal);
    } catch (error) {
      setTaskError(errorMessage(error));
      setPetState("idle");
    } finally {
      setDecomposingTaskId(null);
    }
  }

  async function confirmDecomposition(): Promise<void> {
    if (!window.stepBeast || !decompositionProposal) return;
    setTaskError(null);
    setConfirmingProposal(true);
    try {
      const children = await window.stepBeast.tasks.confirmDecomposition(
        decompositionProposal.taskId,
        decompositionProposal,
      );
      setTasks((current) => {
        const existingIds = new Set(current.map((task) => task.id));
        return [...children.filter((task) => !existingIds.has(task.id)), ...current];
      });
      setDecompositionProposal(null);
      setPetState("happy");
    } catch (error) {
      setTaskError(errorMessage(error));
    } finally {
      setConfirmingProposal(false);
    }
  }

  async function generateDailyPlan(): Promise<void> {
    if (!window.stepBeast) return;
    setTaskError(null);
    setGeneratingDailyPlan(true);
    setPetState("thinking");
    try {
      setDailyPlanProposal(await window.stepBeast.hermes.generateDailyPlan());
    } catch (error) {
      setTaskError(errorMessage(error));
      setPetState("idle");
    } finally {
      setGeneratingDailyPlan(false);
    }
  }

  async function confirmDailyPlan(): Promise<void> {
    if (!window.stepBeast || !dailyPlanProposal) return;
    setTaskError(null);
    setConfirmingDailyPlan(true);
    try {
      setTodayPlan(await window.stepBeast.plan.confirmProposal(dailyPlanProposal));
      setDailyPlanProposal(null);
      setPetState("happy");
    } catch (error) {
      setTaskError(errorMessage(error));
    } finally {
      setConfirmingDailyPlan(false);
    }
  }

  return (
    <main className={`desktop-pet ${expanded ? "desktop-pet--expanded" : ""}`}>
      {expanded && (
        <ActionPanel
          tasks={tasks}
          taskRoles={taskRoles}
          activeTask={activeTask}
          taskError={taskError}
          petProfile={petProfile}
          hermesStatus={hermesStatus}
          hermesChecking={hermesChecking}
          decompositionProposal={decompositionProposal}
          decomposingTaskId={decomposingTaskId}
          confirmingProposal={confirmingProposal}
          dailyPlanProposal={dailyPlanProposal}
          generatingDailyPlan={generatingDailyPlan}
          confirmingDailyPlan={confirmingDailyPlan}
          focusActive={focusActive}
          focusPaused={focusPaused}
          remainingSeconds={remainingSeconds}
          onCreateTask={createTask}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onCompleteTask={completeTask}
          onSetTaskRole={setTaskRole}
          onToggleFocus={() => void toggleFocus()}
          onRetryHermes={() => void refreshHermesStatus()}
          onDecomposeTask={(id) => void decomposeTask(id)}
          onConfirmDecomposition={() => void confirmDecomposition()}
          onCancelDecomposition={() => {
            setDecompositionProposal(null);
            setPetState("idle");
          }}
          onGenerateDailyPlan={() => void generateDailyPlan()}
          onConfirmDailyPlan={() => void confirmDailyPlan()}
          onCancelDailyPlan={() => {
            setDailyPlanProposal(null);
            setPetState("idle");
          }}
          onClose={() => setExpanded(false)}
          onQuit={() => window.stepBeast?.window.close()}
        />
      )}

      <div className="pet-stage">
        <div className={`pet-speech ${rewardNotice ? "pet-speech--reward" : ""}`} aria-live="polite">
          {rewardNotice ?? (expanded ? PET_STATE_LABELS[petState] : "点我，开始今天")}
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
