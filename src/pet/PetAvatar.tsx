import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { PetState } from "./petMachine";
import { dragState, PET_STATE_LABELS } from "./petMachine";
import { getSpriteAnimation } from "./petSprites";

type PetAvatarProps = {
  state: PetState;
  onStateChange: (state: PetState) => void;
  onTap: () => void;
};

type PointerStart = { x: number; y: number; screenX: number };

export function PetAvatar({ state, onStateChange, onTap }: PetAvatarProps): React.JSX.Element {
  const startRef = useRef<PointerStart | null>(null);
  const stateBeforeDrag = useRef<PetState>(state);
  const [frame, setFrame] = useState(0);
  const animation = getSpriteAnimation(state);
  const safeFrame = frame % animation.frames;

  useEffect(() => {
    setFrame(0);
  }, [state]);

  useEffect(() => {
    const duration = animation.frameDurations?.[safeFrame]
      ?? (safeFrame === animation.frames - 1
        ? animation.lastFrameDuration
        : animation.frameDuration);
    const timer = window.setTimeout(() => {
      setFrame((current) => (current + 1) % animation.frames);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [animation, frame, safeFrame]);

  const spriteStyle = {
    "--sprite-column": `${(safeFrame / 7) * 100}%`,
    "--sprite-row": `${(animation.row / 8) * 100}%`,
  } as CSSProperties;

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, y: event.clientY, screenX: event.screenX };
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

    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance < 5) onTap();
  }

  function cancelPointer(): void {
    if (!startRef.current) return;
    startRef.current = null;
    window.stepBeast?.window.endDrag();
    onStateChange(stateBeforeDrag.current);
  }

  return (
    <button
      className={`pet-avatar pet-avatar--${state}`}
      type="button"
      aria-label={`步步兽，当前状态：${PET_STATE_LABELS[state]}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
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
