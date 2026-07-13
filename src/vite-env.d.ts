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
      complete: (id: string) => Promise<StepBeastTaskCompletion>;
      delete: (id: string) => Promise<void>;
      confirmDecomposition: (
        parentTaskId: string,
        proposal: StepBeastDecompositionProposal,
      ) => Promise<StepBeastTask[]>;
    };
    plan: {
      getToday: () => Promise<StepBeastTodayPlan>;
      setRole: (taskId: string, role: StepBeastPlanRole | null) => Promise<StepBeastTodayPlan>;
      confirmProposal: (proposal: StepBeastDailyPlanProposal) => Promise<StepBeastTodayPlan>;
    };
    focus: {
      getCurrent: () => Promise<StepBeastFocusSession | null>;
      start: (taskId: string, plannedSeconds: number) => Promise<StepBeastFocusSession>;
      pause: (id: string) => Promise<StepBeastFocusSession>;
      resume: (id: string) => Promise<StepBeastFocusSession>;
      finish: (id: string) => Promise<StepBeastFocusSession>;
      abandon: (id: string) => Promise<StepBeastFocusSession>;
    };
    pet: {
      getProfile: () => Promise<StepBeastPetProfile>;
    };
    hermes: {
      getStatus: () => Promise<StepBeastHermesStatus>;
      decomposeTask: (task: {
        id: string;
        title: string;
        estimatedMinutes: number | null;
        nextAction: string | null;
      }) => Promise<StepBeastDecompositionProposal>;
      generateDailyPlan: () => Promise<StepBeastDailyPlanProposal>;
    };
  };
}

type StepBeastHermesStatus = {
  state: "ready" | "online" | "offline" | "misconfigured";
  message: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  checkedAt: string;
};

type StepBeastPetProfile = {
  id: string;
  name: string;
  level: number;
  totalXp: number;
  emotion: string;
  activeMode: number;
};

type StepBeastTaskCompletion = {
  task: StepBeastTask;
  profile: StepBeastPetProfile;
  xpGained: number;
};

type StepBeastFocusSession = {
  id: string;
  taskId: string;
  plannedSeconds: number;
  elapsedSeconds: number;
  status: "active" | "paused" | "completed" | "abandoned";
  startedAt: string;
  pausedAt: string | null;
  endedAt: string | null;
};

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
  parentTaskId: string | null;
  title: string;
  status: "todo" | "doing" | "completed" | "cancelled";
  estimatedMinutes: number | null;
  actualMinutes: number;
  nextAction: string | null;
  evidence: string | null;
  rewardXp: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type CreateStepBeastTaskInput = {
  title: string;
  estimatedMinutes?: number | null;
  nextAction?: string | null;
  evidence?: string | null;
  parentTaskId?: string | null;
};

type StepBeastDecompositionStep = {
  title: string;
  estimatedMinutes: number;
  doneWhen: string;
};

type StepBeastDecompositionProposal = {
  proposalId: string;
  requestId: string;
  taskId: string;
  summary: string;
  steps: StepBeastDecompositionStep[];
  attempts: number;
};

type StepBeastDailyPlanProposal = {
  proposalId: string;
  requestId: string;
  summary: string;
  reasoning: string;
  mainTaskId: string;
  supportTaskIds: string[];
  attempts: number;
};
