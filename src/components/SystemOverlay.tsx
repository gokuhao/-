import { useEffect, useState } from "react";
import type { FormEvent } from "react";

export type SystemTool = "chat" | "more";
type MoreSection = "projects" | "review" | "coo" | "settings";
type ActiveView = SystemTool | MoreSection;

type Props = {
  tool: SystemTool;
  tasks: StepBeastTask[];
  petProfile: StepBeastPetProfile | null;
  hermesStatus: StepBeastHermesStatus | null;
  obsidianStatus: StepBeastObsidianStatus | null;
  projectSyncing: boolean;
  onRetryHermes: () => void;
  onRetryObsidian: () => void;
  onProposeProjectSync: () => void;
  onQuit: () => void;
  onClose: () => void;
  onNotice: (message: string) => void;
};

const TOOL_TITLES: Record<ActiveView, string> = {
  chat: "和步步兽聊聊",
  more: "更多",
  projects: "项目全景",
  review: "每日复盘",
  coo: "AI COO",
  settings: "陪伴设置",
};

export function SystemOverlay({
  tool,
  tasks,
  petProfile,
  hermesStatus,
  obsidianStatus,
  projectSyncing,
  onRetryHermes,
  onRetryObsidian,
  onProposeProjectSync,
  onQuit,
  onClose,
  onNotice,
}: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<StepBeastSettings | null>(null);
  const [projects, setProjects] = useState<StepBeastProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [review, setReview] = useState<StepBeastDailyReviewProposal | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [coo, setCoo] = useState<StepBeastCooAnalysis | null>(null);
  const [usage, setUsage] = useState<StepBeastUsageSummary | null>(null);
  const [moreSection, setMoreSection] = useState<MoreSection | null>(null);
  const activeView: ActiveView = tool === "chat" ? "chat" : moreSection ?? "more";

  useEffect(() => {
    setMoreSection(null);
  }, [tool]);

  useEffect(() => {
    setError(null);
    if (!window.stepBeast) return;
    if (activeView === "settings") void loadSettings();
    if (activeView === "projects") void loadProjects();
    if (activeView === "coo") void loadUsage();
  }, [activeView]);

  async function loadSettings(): Promise<void> {
    try { setSettings(await window.stepBeast!.settings.get()); } catch (reason) { setError(messageOf(reason)); }
  }

  async function saveSettings(next: StepBeastSettings): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setSettings(await window.stepBeast!.settings.update(next));
      onNotice("设置已保存");
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }

  async function loadProjects(): Promise<void> {
    try {
      const value = await window.stepBeast!.projects.list();
      setProjects(value);
      setSelectedProjectId((current) => current ?? value[0]?.id ?? null);
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function loadUsage(): Promise<void> {
    try { setUsage(await window.stepBeast!.activity.getSummary(7)); } catch (reason) { setError(messageOf(reason)); }
  }

  async function generateReview(): Promise<void> {
    setBusy(true);
    setError(null);
    try { setReview(await window.stepBeast!.reviews.propose()); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }

  async function confirmReview(): Promise<void> {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      await window.stepBeast!.reviews.confirm(review.proposalId);
      setReview(null);
      onNotice("复盘已写入 Obsidian");
      onClose();
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }

  async function sendMessage(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setMessages((current) => [...current, { role: "user", content: text }]);
    setChatInput("");
    setBusy(true);
    setError(null);
    try {
      const reply = await window.stepBeast!.chat.send(text);
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }

  async function analyzeCoo(): Promise<void> {
    setBusy(true);
    setError(null);
    try { setCoo(await window.stepBeast!.coo.analyze()); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const projectTasks = tasks.filter((task) => task.projectId === selectedProjectId);

  return (
    <section className="proposal-overlay system-overlay apple-system-overlay" aria-label={TOOL_TITLES[activeView]}>
      <header className="system-overlay-header">
        <div className="apple-overlay-title">
          {tool === "more" && moreSection && <button type="button" onClick={() => setMoreSection(null)} aria-label="返回更多">‹</button>}
          <div><p className="panel-kicker">步步兽</p><h2>{TOOL_TITLES[activeView]}</h2></div>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭">×</button>
      </header>
      {error && <p className="task-error" role="alert">{error}</p>}

      {activeView === "chat" && (
        <div className="tool-body chat-tool">
          <div className="chat-messages">
            {messages.length === 0 && <p className="tool-empty">问我“今天应该先做什么？”我会结合任务、项目和最近复盘回答。</p>}
            {messages.map((item, index) => <p className={`chat-message chat-message--${item.role}`} key={index}>{item.content}</p>)}
          </div>
          <form onSubmit={(event) => void sendMessage(event)}>
            <input value={chatInput} maxLength={2000} placeholder="输入你的问题…" onChange={(event) => setChatInput(event.target.value)} />
            <button type="submit" disabled={busy || !chatInput.trim()}>{busy ? "思考中" : "发送"}</button>
          </form>
        </div>
      )}

      {activeView === "more" && (
        <div className="tool-body apple-more-tool">
          <div className="apple-profile-summary">
            <span className="apple-mini-pet" aria-hidden="true" />
            <div><strong>Lv.{petProfile?.level ?? 1} · {petProfile?.totalXp ?? 0} XP</strong><small>把复杂能力收在这里，首页只负责行动。</small></div>
          </div>
          <div className="apple-more-grid">
            <button type="button" onClick={() => setMoreSection("projects")}><span>▣</span><strong>项目</strong><small>目标、阶段与任务</small></button>
            <button type="button" onClick={() => setMoreSection("review")}><span>✓</span><strong>每日复盘</strong><small>生成并沉淀记录</small></button>
            <button type="button" onClick={() => setMoreSection("coo")}><span>◇</span><strong>AI COO</strong><small>执行与项目风险</small></button>
            <button type="button" onClick={() => setMoreSection("settings")}><span>⚙</span><strong>设置</strong><small>提醒、感知与启动</small></button>
          </div>
          <div className="apple-connection-list">
            <button type="button" onClick={onRetryHermes}><span className={`hermes-dot ${hermesStatus?.state === "ready" ? "apple-dot--ready" : ""}`} /><span>Hermes</span><small>{hermesStatus?.message ?? "状态未知"}</small></button>
            <button type="button" onClick={obsidianStatus?.state === "ready" ? () => { onClose(); onProposeProjectSync(); } : onRetryObsidian} disabled={projectSyncing}><span className={`hermes-dot ${obsidianStatus?.state === "ready" ? "apple-dot--ready" : ""}`} /><span>Obsidian</span><small>{projectSyncing ? "读取项目中…" : obsidianStatus?.state === "ready" ? "点击同步项目" : obsidianStatus?.message ?? "状态未知"}</small></button>
          </div>
          <button className="apple-quit-button" type="button" onClick={onQuit}>退出步步兽</button>
        </div>
      )}

      {activeView === "projects" && (
        <div className="tool-body project-tool">
          {projects.length === 0 ? <p className="tool-empty">还没有确认同步的项目。先点击主面板上的 Obsidian 状态生成同步提案。</p> : (
            <>
              <select value={selectedProjectId ?? ""} onChange={(event) => setSelectedProjectId(event.target.value)}>
                {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
              </select>
              {selectedProject && <article>
                <span className="tool-badge">{selectedProject.category} · {selectedProject.status}</span>
                <h3>{selectedProject.name}</h3>
                <p><strong>目标：</strong>{selectedProject.goal ?? "尚未填写"}</p>
                <p><strong>阶段：</strong>{selectedProject.currentStage ?? "尚未填写"}</p>
                <h4>关联任务</h4>
                {projectTasks.length ? projectTasks.map((task) => <p key={task.id}>· {task.title}（{task.status}）</p>) : <p>还没有从该项目导入任务。</p>}
              </article>}
            </>
          )}
        </div>
      )}

      {activeView === "review" && (
        <div className="tool-body review-tool">
          {!review ? (
            <><p>Hermes 会根据今天完成的任务、专注时间和未完成任务生成草稿。生成只预览，不会写文件。</p><button className="tool-primary" type="button" disabled={busy} onClick={() => void generateReview()}>{busy ? "生成中…" : "生成今日复盘"}</button></>
          ) : (
            <><p className="tool-path">写入位置：{review.targetPath}</p><pre>{review.content}</pre><div className="proposal-actions"><button type="button" onClick={() => setReview(null)}>放弃</button><button type="button" disabled={busy} onClick={() => void confirmReview()}>{busy ? "写入中…" : "确认写入 Obsidian"}</button></div></>
          )}
        </div>
      )}

      {activeView === "coo" && (
        <div className="tool-body coo-tool">
          <p>近 7 天已记录活动：{formatDuration(usage?.totalSeconds ?? 0)}。未开启行为感知时显示 0，这是正常的。</p>
          {!coo ? <button className="tool-primary" type="button" disabled={busy} onClick={() => void analyzeCoo()}>{busy ? "分析中…" : "分析执行与项目风险"}</button> : (
            <article><h3>{coo.summary}</h3><h4>风险</h4>{coo.risks.length ? coo.risks.map((item, index) => <p key={`r${index}`}>· {item}</p>) : <p>暂无明确风险。</p>}<h4>下一步</h4>{coo.suggestions.map((item, index) => <p key={`s${index}`}>{index + 1}. {item}</p>)}</article>
          )}
        </div>
      )}

      {activeView === "settings" && settings && (
        <div className="tool-body settings-tool">
          <SettingToggle label="晨间规划提醒" checked={settings.morningReminderEnabled} onChange={(checked) => void saveSettings({ ...settings, morningReminderEnabled: checked })} />
          <label>晨间时间<input type="time" value={settings.morningTime} disabled={busy} onChange={(event) => void saveSettings({ ...settings, morningTime: event.target.value })} /></label>
          <SettingToggle label="晚间复盘提醒" checked={settings.eveningReminderEnabled} onChange={(checked) => void saveSettings({ ...settings, eveningReminderEnabled: checked })} />
          <label>晚间时间<input type="time" value={settings.eveningTime} disabled={busy} onChange={(event) => void saveSettings({ ...settings, eveningTime: event.target.value })} /></label>
          <SettingToggle label="应用使用统计（仅应用名和时长）" checked={settings.activityTrackingEnabled} onChange={(checked) => void saveSettings({ ...settings, activityTrackingEnabled: checked })} />
          <SettingToggle label="开机自动启动（安装版生效）" checked={settings.autoLaunch} onChange={(checked) => void saveSettings({ ...settings, autoLaunch: checked })} />
          <label>主动程度<select value={settings.activeMode} disabled={busy} onChange={(event) => void saveSettings({ ...settings, activeMode: Number(event.target.value) as 2 | 3 | 4 })}><option value={2}>Level 2 陪伴</option><option value={3}>Level 3 日常助手</option><option value={4}>Level 4 AI COO</option></select></label>
          <small>所有开关默认关闭或保守设置；Hermes 离线时，本地任务和专注仍可使用。</small>
        </div>
      )}
    </section>
  );
}

function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }): React.JSX.Element {
  return <label className="setting-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
