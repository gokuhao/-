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
    obsidian: {
      getStatus: () => Promise<StepBeastObsidianStatus>;
      listNotes: () => Promise<StepBeastObsidianNoteSummary[]>;
      readNote: (relativePath: string) => Promise<StepBeastObsidianNote>;
      proposeProjectSync: () => Promise<StepBeastObsidianProjectProposal>;
    };
    projects: {
      list: () => Promise<StepBeastProject[]>;
      confirmSync: (
        proposal: StepBeastObsidianProjectProposal,
        selectedCandidateKeys: string[],
      ) => Promise<StepBeastProjectSyncResult>;
    };
    settings: {
      get: () => Promise<StepBeastSettings>;
      update: (input: StepBeastSettings) => Promise<StepBeastSettings>;
    };
    activity: {
      getSummary: (days?: number) => Promise<StepBeastUsageSummary>;
    };
    reviews: {
      propose: () => Promise<StepBeastDailyReviewProposal>;
      confirm: (proposalId: string) => Promise<{ review: StepBeastReview; writeResult: { relativePath: string; created: boolean } }>;
      list: () => Promise<StepBeastReview[]>;
    };
    chat: { send: (message: string) => Promise<string> };
    coo: { analyze: () => Promise<StepBeastCooAnalysis> };
    runtime: { onReminder: (callback: (message: string) => void) => () => void };
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
  projectId: string | null;
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

type StepBeastObsidianStatus = {
  state: "ready" | "not_configured" | "unavailable" | "invalid";
  message: string;
  vaultPath: string | null;
  markdownCount: number;
  checkedAt: string;
};

type StepBeastObsidianNoteSummary = {
  relativePath: string;
  title: string;
  folder: string;
  tags: string[];
  modifiedAt: string;
  sizeBytes: number;
};

type StepBeastObsidianNote = StepBeastObsidianNoteSummary & {
  content: string;
  frontmatter: Record<string, string | string[]>;
};

type StepBeastProjectStatus = "active" | "testing" | "paused" | "completed" | "archived";
type StepBeastProjectCategory = "current" | "support" | "paused";

type StepBeastObsidianProjectCandidate = {
  sourcePath: string;
  name: string;
  status: StepBeastProjectStatus;
  category: StepBeastProjectCategory;
  goal: string | null;
  currentStage: string | null;
  sourceModifiedAt: string;
};

type StepBeastObsidianTaskCandidate = {
  candidateKey: string;
  projectSourcePath: string;
  projectName: string;
  title: string;
  estimatedMinutes: number;
  sourcePath: string;
};

type StepBeastObsidianProjectProposal = {
  proposalId: string;
  projectIndexPath: string;
  summary: string;
  projects: StepBeastObsidianProjectCandidate[];
  taskCandidates: StepBeastObsidianTaskCandidate[];
};

type StepBeastProject = {
  id: string;
  name: string;
  status: StepBeastProjectStatus;
  category: StepBeastProjectCategory;
  goal: string | null;
  currentStage: string | null;
  sourceNotePath: string;
  sourceModifiedAt: string;
  updatedAt: string;
};

type StepBeastProjectSyncResult = {
  projects: StepBeastProject[];
  createdTaskIds: string[];
};

type StepBeastSettings = {
  morningReminderEnabled: boolean;
  morningTime: string;
  eveningReminderEnabled: boolean;
  eveningTime: string;
  activityTrackingEnabled: boolean;
  autoLaunch: boolean;
  activeMode: 2 | 3 | 4;
};

type StepBeastUsageSummary = {
  dateFrom: string;
  dateTo: string;
  totalSeconds: number;
  byCategory: Record<"work" | "learning" | "communication" | "entertainment" | "other", number>;
  topApps: Array<{ appName: string; category: string; seconds: number }>;
};

type StepBeastDailyReviewProposal = {
  proposalId: string;
  reviewDate: string;
  targetPath: string;
  summary: string;
  content: string;
  attempts: number;
};

type StepBeastReview = {
  id: string;
  reviewDate: string;
  targetPath: string;
  summary: string;
  createdAt: string;
};

type StepBeastCooAnalysis = {
  summary: string;
  risks: string[];
  suggestions: string[];
  attempts: number;
};
