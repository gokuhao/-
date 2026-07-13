import { useRef } from "react";
import type { PointerEvent } from "react";
import type { PetState } from "./petMachine";
import { dragState, PET_STATE_LABELS } from "./petMachine";

type PetAvatarProps = {
  state: PetState;
  onStateChange: (state: PetState) => void;
  onTap: () => void;
};

type PointerStart = { x: number; y: number; screenX: number };

export function PetAvatar({ state, onStateChange, onTap }: PetAvatarProps): React.JSX.Element {
  const startRef = useRef<PointerStart | null>(null);
  const stateBeforeDrag = useRef<PetState>(state);

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
        onStateChange("waving");
        window.setTimeout(() => onStateChange("idle"), 1100);
      }}
    >
      <span className="pet-shadow" />
      <span className="pet-tail" />
      <span className="pet-body">
        <span className="pet-ear pet-ear--left" />
        <span className="pet-ear pet-ear--right" />
        <span className="pet-face">
          <span className="pet-eye pet-eye--left" />
          <span className="pet-eye pet-eye--right" />
          <span className="pet-mouth" />
        </span>
        <span className="pet-arm pet-arm--left" />
        <span className="pet-arm pet-arm--right" />
        <span className="pet-foot pet-foot--left" />
        <span className="pet-foot pet-foot--right" />
      </span>
    </button>
  );
}
