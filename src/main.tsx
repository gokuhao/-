import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

function App(): React.JSX.Element {
  const platform = window.stepBeast?.platform ?? "browser";

  return (
    <main className="app-shell">
      <section className="welcome-card">
        <div className="pet-placeholder" aria-label="步步兽占位角色">兽</div>
        <p className="eyebrow">STEPBEAST · MILESTONE 0</p>
        <h1>步步兽已经醒来</h1>
        <p>基础桌面窗口运行正常。下一步，我们会让它真正悬浮在桌面上。</p>
        <span className="status">运行环境：{platform}</span>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
