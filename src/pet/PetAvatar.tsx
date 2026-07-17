import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { PetState } from "./petMachine";
import { dragState, PET_STATE_LABELS } from "./petMachine";
import { getSpriteAnimation } from "./petSprites";

type PetAvatarProps = {
  state: PetState;
  dockState: StepBeastDockState;
  onStateChange: (state: PetState) => void;
  onTap: () => void;
};

type PointerStart = { screenX: number; screenY: number };

export function PetAvatar({ state, dockState, onStateChange, onTap }: PetAvatarProps): React.JSX.Element {
  const startRef = useRef<PointerStart | null>(null);
  const stateBeforeDrag = useRef<PetState>(state);
  const showPeekTimerRef = useRef<number | null>(null);
  const hidePeekTimerRef = useRef<number | null>(null);
  const [peekGreeting, setPeekGreeting] = useState(false);
  const [frame, setFrame] = useState(0);
  const inwardState: PetState | null = dockState.side === "left"
    ? "running-right"
    : dockState.side === "right"
      ? "running-left"
      : null;
  const visualState: PetState = peekGreeting || state === "waving" ? "waving" : inwardState ?? state;
  const freezeInwardPose = inwardState !== null && visualState === inwardState;
  const animation = getSpriteAnimation(visualState);
  const safeFrame = frame % animation.frames;

  useEffect(() => {
    setFrame(0);
  }, [visualState]);

  useEffect(() => {
    if (!dockState.peeking) {
      setPeekGreeting(false);
      return;
    }
    setPeekGreeting(true);
    const timer = window.setTimeout(() => setPeekGreeting(false), 900);
    return () => window.clearTimeout(timer);
  }, [dockState.peeking]);

  useEffect(() => () => {
    if (showPeekTimerRef.current !== null) window.clearTimeout(showPeekTimerRef.current);
    if (hidePeekTimerRef.current !== null) window.clearTimeout(hidePeekTimerRef.current);
    window.stepBeast?.window.setPeeking(false);
  }, []);

  useEffect(() => {
    if (freezeInwardPose) return;
    const duration = animation.frameDurations?.[safeFrame]
      ?? (safeFrame === animation.frames - 1
        ? animation.lastFrameDuration
        : animation.frameDuration);
    const timer = window.setTimeout(() => {
      setFrame((current) => (current + 1) % animation.frames);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [animation, frame, freezeInwardPose, safeFrame]);

  const spriteStyle = {
    "--sprite-column": `${(safeFrame / 7) * 100}%`,
    "--sprite-row": `${(animation.row / 8) * 100}%`,
  } as CSSProperties;

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    clearPeekTimers();
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { screenX: event.screenX, screenY: event.screenY };
    stateBeforeDrag.current = state;
    window.stepBeast?.window.startDrag(event.screenX, event.screenY);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const start = startRef.current;
    if (!start) return;
    const nextState = dragState(event.screenX - start.screenX, stateBeforeDrag.current);
    if (nextState !== state) onStateChange(nextState);
    window.stepBeast?.window.moveDrag(event.screenX, event.screenY);
  }

  function finishPointer(event: PointerEvent<HTMLButtonElement>): void {
    const start = startRef.current;
    if (!start) return;
    startRef.current = null;
    window.stepBeast?.window.endDrag();
    onStateChange(stateBeforeDrag.current);

    // 窗口会跟随鼠标移动，必须使用屏幕坐标区分点击和拖拽。
    const distance = Math.hypot(event.screenX - start.screenX, event.screenY - start.screenY);
    if (distance < 5) onTap();
  }

  function cancelPointer(): void {
    if (!startRef.current) return;
    startRef.current = null;
    window.stepBeast?.window.endDrag();
    onStateChange(stateBeforeDrag.current);
  }

  function clearPeekTimers(): void {
    if (showPeekTimerRef.current !== null) window.clearTimeout(showPeekTimerRef.current);
    if (hidePeekTimerRef.current !== null) window.clearTimeout(hidePeekTimerRef.current);
    showPeekTimerRef.current = null;
    hidePeekTimerRef.current = null;
  }

  function handlePointerEnter(): void {
    if (startRef.current) return;
    clearPeekTimers();
    showPeekTimerRef.current = window.setTimeout(() => {
      showPeekTimerRef.current = null;
      window.stepBeast?.window.setPeeking(true);
    }, 140);
  }

  function handlePointerLeave(): void {
    if (startRef.current) return;
    clearPeekTimers();
    hidePeekTimerRef.current = window.setTimeout(() => {
      hidePeekTimerRef.current = null;
      window.stepBeast?.window.setPeeking(false);
    }, 220);
  }

  return (
    <button
      className={`pet-avatar pet-avatar--${visualState}`}
      type="button"
      aria-label={`步步兽，当前状态：${PET_STATE_LABELS[state]}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={() => {
        const previousState = state;
        onStateChange("waving");
        window.setTimeout(() => onStateChange(previousState), 1100);
      }}
    >
      <span className="pet-sprite" style={spriteStyle} aria-hidden="true" />
    </button>
  );
}
