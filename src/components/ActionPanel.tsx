type ActionPanelProps = {
  focusActive: boolean;
  remainingSeconds: number;
  onToggleFocus: () => void;
  onClose: () => void;
  onQuit: () => void;
};

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function ActionPanel({
  focusActive,
  remainingSeconds,
  onToggleFocus,
  onClose,
  onQuit,
}: ActionPanelProps): React.JSX.Element {
  return (
    <section className="action-panel" aria-label="步步兽行动面板">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">今天只推进一件事</p>
          <h1>完成步步兽桌宠第一版</h1>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="收起面板">×</button>
      </header>

      <div className="next-action">
        <span>下一步</span>
        <strong>运行桌宠，确认交互手感</strong>
      </div>

      <div className="focus-row">
        <div>
          <span className="focus-label">{focusActive ? "专注进行中" : "25 分钟专注"}</span>
          <strong className="timer">{formatTime(remainingSeconds)}</strong>
        </div>
        <button className="primary-button" type="button" onClick={onToggleFocus}>
          {focusActive ? "暂停" : remainingSeconds < 1500 ? "继续" : "开始"}
        </button>
      </div>

      <footer className="panel-footer">
        <span>Lv.1 · 0 / 100 XP</span>
        <button type="button" onClick={onQuit}>退出步步兽</button>
      </footer>
    </section>
  );
}
