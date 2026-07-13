import type { PetState } from "./petMachine";

export type SpriteAnimation = {
  row: number;
  frames: number;
  frameDuration: number;
  lastFrameDuration: number;
  frameDurations?: number[];
};

// Sprout Cat 使用 Codex v1 的 8×9 图集，每格固定为 192×208。
const SPRITE_ANIMATIONS: Record<string, SpriteAnimation> = {
  idle: {
    row: 0,
    frames: 6,
    frameDuration: 140,
    lastFrameDuration: 320,
    frameDurations: [280, 110, 110, 140, 140, 320],
  },
  "running-right": { row: 1, frames: 8, frameDuration: 120, lastFrameDuration: 220 },
  "running-left": { row: 2, frames: 8, frameDuration: 120, lastFrameDuration: 220 },
  waving: { row: 3, frames: 4, frameDuration: 140, lastFrameDuration: 280 },
  jumping: { row: 4, frames: 5, frameDuration: 140, lastFrameDuration: 280 },
  failed: { row: 5, frames: 8, frameDuration: 140, lastFrameDuration: 240 },
  waiting: { row: 6, frames: 6, frameDuration: 150, lastFrameDuration: 260 },
  running: { row: 7, frames: 6, frameDuration: 120, lastFrameDuration: 220 },
  review: { row: 8, frames: 6, frameDuration: 150, lastFrameDuration: 280 },
};

const STATE_TO_ANIMATION: Record<PetState, keyof typeof SPRITE_ANIMATIONS> = {
  idle: "idle",
  happy: "jumping",
  focused: "running",
  thinking: "review",
  resting: "waiting",
  jumping: "jumping",
  waving: "waving",
  "running-left": "running-left",
  "running-right": "running-right",
};

export function getSpriteAnimation(state: PetState): SpriteAnimation {
  return SPRITE_ANIMATIONS[STATE_TO_ANIMATION[state]];
}
