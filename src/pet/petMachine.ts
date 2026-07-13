export type PetState =
  | "idle"
  | "happy"
  | "focused"
  | "thinking"
  | "resting"
  | "jumping"
  | "waving"
  | "running-left"
  | "running-right";

export const PET_STATE_LABELS: Record<PetState, string> = {
  idle: "陪着你",
  happy: "开心",
  focused: "专注中",
  thinking: "思考中",
  resting: "休息中",
  jumping: "见到你啦",
  waving: "嗨",
  "running-left": "往左走",
  "running-right": "往右走",
};

export function dragState(deltaX: number, fallback: PetState): PetState {
  if (deltaX >= 4) return "running-right";
  if (deltaX <= -4) return "running-left";
  return fallback;
}
