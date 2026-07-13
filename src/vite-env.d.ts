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
  };
}
