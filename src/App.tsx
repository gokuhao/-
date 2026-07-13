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
    if (remainingSeconds === 0) setRemainingSeconds(FOCUS_SECONDS);
    setFocusActive((active) => {
      const next = !active;
      setPetState(next ? "focused" : "idle");
      return next;
    });
  }

  return (
    <main className={`desktop-pet ${expanded ? "desktop-pet--expanded" : ""}`}>
      {expanded && (
        <ActionPanel
          focusActive={focusActive}
          remainingSeconds={remainingSeconds}
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
