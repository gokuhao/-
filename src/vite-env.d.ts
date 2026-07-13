/// <reference types="vite/client" />

interface Window {
  stepBeast?: {
    platform: string;
    window: {
      startDrag: (screenX: number, screenY: number) => void;
      moveDrag: (screenX: number, screenY: number) => void;
      endDrag: () => void;
      setExpanded: (expanded: boolean) => void;
      close: () => void;
    };
    tasks: {
      list: () => Promise<StepBeastTask[]>;
      create: (input: CreateStepBeastTaskInput) => Promise<StepBeastTask>;
      update: (id: string, input: CreateStepBeastTaskInput) => Promise<StepBeastTask>;
      complete: (id: string) => Promise<StepBeastTask>;
      delete: (id: string) => Promise<void>;
    };
    plan: {
      getToday: () => Promise<StepBeastTodayPlan>;
      setRole: (taskId: string, role: StepBeastPlanRole | null) => Promise<StepBeastTodayPlan>;
    };
  };
}

type StepBeastPlanRole = "main" | "support";

type StepBeastTodayPlan = {
  date: string;
  items: Array<{
    role: StepBeastPlanRole;
    sortOrder: number;
    task: StepBeastTask;
  }>;
};

type StepBeastTask = {
  id: string;
  title: string;
  status: "todo" | "doing" | "completed" | "cancelled";
  estimatedMinutes: number | null;
  nextAction: string | null;
  rewardXp: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type CreateStepBeastTaskInput = {
  title: string;
  estimatedMinutes?: number | null;
  nextAction?: string | null;
};
