import { useEffect, useState } from "react";
import type { FormEvent } from "react";

export type SystemTool = "chat" | "more";
type WorkbenchSection = "tasks" | "projects" | "chat" | "review" | "coo" | "memory" | "settings";

type Props = {
  tool: SystemTool;
  tasks: StepBeastTask[];
  activeTask: StepBeastTask | null;
  focusActive: boolean;
  petProfile: StepBeastPetProfile | null;
  hermesStatus: StepBeastHermesStatus | null;
  obsidianStatus: StepBeastObsidianStatus | null;
  projectProposal: StepBeastObsidianProjectProposal | null;
  projectSyncing: boolean;
  projectConfirming: boolean;
  onCreateTask: (title: string) => Promise<void>;
  onCompleteTask: (id: string) => Promise<void>;
  onOpenFocus: () => void;
  onRetryHermes: () => void;
  onRetryObsidian: () => void;
  onProposeProjectSync: () => void;
  onConfirmProjectSync: (selectedCandidateKeys: string[]) => void;
  onCancelProjectSync: () => void;
  onQuit: () => void;
  onClose: () => void;
  onNotice: (message: string) => void;
};

const SECTION_TITLES: Record<WorkbenchSection, { kicker: string; title: string; description: string }> = {
  tasks: { kicker: "执行中心", title: "全部任务", description: "把注意力留给正在推进的事情。" },
  projects: { kicker: "方向与进展", title: "项目", description: "默认只显示目标、阶段和关联任务。" },
  chat: { kicker: "Hermes 智能中枢", title: "AI 助手", description: "每次对话都尽量落到下一步行动。" },
  review: { kicker: "今日沉淀", title: "每日复盘", description: "确认后才会写入 Obsidian。" },
  coo: { kicker: "过去 7 天", title: "成长与 AI COO", description: "数据只用来调整行动，不制造压力。" },
  memory: { kicker: "Obsidian 长期资产", title: "长期记忆", description: "只保留一个月后仍然有价值的信息。" },
  settings: { kicker: "个人化与连接", title: "设置", description: "提醒、感知和本地服务集中管理。" },
};

export function SystemOverlay({
  tool,
  tasks,
  activeTask,
  focusActive,
  petProfile,
  hermesStatus,
  obsidianStatus,
  projectProposal,
  projectSyncing,
  projectConfirming,
  onCreateTask,
  onCompleteTask,
  onOpenFocus,
  onRetryHermes,
  onRetryObsidian,
  onProposeProjectSync,
  onConfirmProjectSync,
  onCancelProjectSync,
  onQuit,
  onClose,
  onNotice,
}: Props): React.JSX.Element {
  const [activeView, setActiveView] = useState<WorkbenchSection>(tool === "chat" ? "chat" : "tasks");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<StepBeastSettings | null>(null);
  const [projects, setProjects] = useState<StepBeastProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [notes, setNotes] = useState<StepBeastObsidianNoteSummary[]>([]);
  const [review, setReview] = useState<StepBeastDailyReviewProposal | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [coo, setCoo] = useState<StepBeastCooAnalysis | null>(null);
  const [usage, setUsage] = useState<StepBeastUsageSummary | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [taskFilter, setTaskFilter] = useState<"active" | "completed">("active");
  const [selectedProjectTasks, setSelectedProjectTasks] = useState<string[]>([]);

  useEffect(() => {
    setActiveView(tool === "chat" ? "chat" : "tasks");
  }, [tool]);

  useEffect(() => {
    setError(null);
    if (!window.stepBeast) return;
    if (activeView === "settings") void loadSettings();
    if (activeView === "projects") void loadProjects();
    if (activeView === "coo") {
      void loadUsage();
      void loadProjects();
    }
    if (activeView === "memory") void loadNotes();
  }, [activeView]);

  useEffect(() => {
    setSelectedProjectTasks([]);
    if (!projectProposal && activeView === "projects") void loadProjects();
  }, [projectProposal?.proposalId]);

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

  async function loadNotes(): Promise<void> {
    try { setNotes(await window.stepBeast!.obsidian.listNotes()); } catch (reason) { setError(messageOf(reason)); }
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

  async function submitTask(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      await onCreateTask(title);
      setNewTaskTitle("");
      onNotice("任务已添加");
    } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }

  async function completeTask(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try { await onCompleteTask(id); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const visibleTasks = tasks.filter((task) => taskFilter === "completed" ? task.status === "completed" : task.status === "todo" || task.status === "doing");
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const activeProjectCount = projects.filter((project) => project.status === "active" || project.status === "testing").length;
  const heading = SECTION_TITLES[activeView];

  function openFocus(): void {
    onOpenFocus();
    onClose();
  }

  function proposeProjectSync(): void {
    setActiveView("projects");
    onProposeProjectSync();
  }

  return (
    <section className="workbench-shell" aria-label="步步兽工作台">
      <header className="workbench-titlebar">
        <div className="workbench-brand"><span className="workbench-brand-mark" aria-hidden="true">♧</span><div><strong>步步兽工作台</strong><small>小昊的个人 AI OS</small></div></div>
        <div className="workbench-window-actions"><button type="button" onClick={onClose}>返回今日插件</button><button className="workbench-close" type="button" onClick={onClose} aria-label="关闭工作台">×</button></div>
      </header>

      <div className="workbench-body">
        <aside className="workbench-sidebar">
          <WorkbenchNavGroup label="日常">
            <WorkbenchNavButton active={activeView === "tasks"} icon="✓" label="全部任务" onClick={() => setActiveView("tasks")} />
            <WorkbenchNavButton active={activeView === "projects"} icon="▣" label="项目" onClick={() => setActiveView("projects")} />
            <WorkbenchNavButton active={activeView === "chat"} icon="○" label="AI 助手" onClick={() => setActiveView("chat")} />
          </WorkbenchNavGroup>
          <WorkbenchNavGroup label="沉淀">
            <WorkbenchNavButton active={activeView === "review"} icon="✎" label="每日复盘" onClick={() => setActiveView("review")} />
            <WorkbenchNavButton active={activeView === "coo"} icon="↗" label="成长数据" onClick={() => setActiveView("coo")} />
            <WorkbenchNavButton active={activeView === "memory"} icon="◇" label="长期记忆" onClick={() => setActiveView("memory")} />
          </WorkbenchNavGroup>
          <WorkbenchNavGroup label="系统">
            <WorkbenchNavButton active={activeView === "settings"} icon="⚙" label="设置" onClick={() => setActiveView("settings")} />
          </WorkbenchNavGroup>
          <div className="workbench-pet-status"><span className="workbench-pet" aria-hidden="true" /><div><strong>小昊</strong><small>Lv.{petProfile?.level ?? 1} · {focusActive ? "专注中" : "陪伴中"}</small></div></div>
        </aside>

        <main className="workbench-content">
          <header className="workbench-page-header">
            <div><p>{heading.kicker}</p><h1>{heading.title}</h1><span>{heading.description}</span></div>
            <div className="workbench-quick-actions">
              <button type="button" onClick={() => setActiveView("tasks")}>＋ 添加任务</button>
              <button type="button" disabled={!activeTask} onClick={openFocus}>◷ {focusActive ? "查看专注" : "开始专注"}</button>
              <button className="workbench-primary" type="button" onClick={() => setActiveView("chat")}>○ 询问步步兽</button>
            </div>
          </header>

          {error && <p className="workbench-error" role="alert">{error}</p>}

          {activeView === "tasks" && (
            <div className="workbench-task-page">
              <form className="workbench-quick-form" onSubmit={(event) => void submitTask(event)}>
                <input value={newTaskTitle} maxLength={120} placeholder="写下下一件要完成的事情…" onChange={(event) => setNewTaskTitle(event.target.value)} />
                <button className="workbench-primary" type="submit" disabled={busy || !newTaskTitle.trim()}>添加</button>
              </form>
              <div className="workbench-filter-row"><button className={taskFilter === "active" ? "is-active" : ""} type="button" onClick={() => setTaskFilter("active")}>进行中</button><button className={taskFilter === "completed" ? "is-active" : ""} type="button" onClick={() => setTaskFilter("completed")}>已完成</button><span>{visibleTasks.length} 项</span></div>
              <div className="workbench-split">
                <div className="workbench-list">
                  {visibleTasks.length === 0 ? <p className="workbench-empty">这里还没有任务。</p> : visibleTasks.map((task) => (
                    <article className="workbench-task-row" key={task.id}>
                      <button className={`workbench-check ${task.status === "completed" ? "is-done" : ""}`} type="button" disabled={busy || task.status === "completed"} onClick={() => void completeTask(task.id)} aria-label={`完成任务：${task.title}`}>{task.status === "completed" ? "✓" : ""}</button>
                      <div><strong>{task.title}</strong><small>{task.estimatedMinutes ?? 25} 分钟{task.actualMinutes ? ` · 已专注 ${task.actualMinutes} 分钟` : ""}</small></div>
                      {task.id === activeTask?.id && <span className="workbench-badge">当前</span>}
                    </article>
                  ))}
                </div>
                <aside className="workbench-focus-card"><span className="workbench-badge">步步兽建议</span><h2>{activeTask?.nextAction ?? activeTask?.title ?? "先选择一个任务"}</h2><p>{activeTask ? "先完成一个 15 分钟的可见成果，不需要一次做到完美。" : "添加任务后，我会陪你从最小动作开始。"}</p><button className="workbench-primary" type="button" disabled={!activeTask} onClick={openFocus}>▶ 现在开始</button></aside>
              </div>
            </div>
          )}

          {activeView === "projects" && (
            <div className="workbench-project-page">
              {projects.length === 0 ? <div className="workbench-empty"><p>还没有同步项目。</p><button className="workbench-primary" type="button" disabled={projectSyncing} onClick={proposeProjectSync}>{projectSyncing ? "读取中…" : "从 Obsidian 读取项目"}</button></div> : (
                <><div className="workbench-project-list">{projects.map((project) => <button className={project.id === selectedProjectId ? "is-active" : ""} type="button" key={project.id} onClick={() => setSelectedProjectId(project.id)}><span><strong>{project.name}</strong><small>{projectCategoryLabel(project.category)}</small></span><span><small>当前阶段</small><strong>{project.currentStage ?? "尚未填写"}</strong></span><span className="workbench-badge">{projectStatusLabel(project.status)}</span></button>)}</div>{selectedProject && <section className="workbench-project-detail"><div><span>项目目标</span><p>{selectedProject.goal ?? "尚未填写项目目标"}</p></div><div><span>当前阶段</span><p>{selectedProject.currentStage ?? "尚未填写当前阶段"}</p></div><div><span>关联任务</span><p>{tasks.filter((task) => task.projectId === selectedProject.id).length} 项</p></div></section>}</>
              )}
            </div>
          )}

          {activeView === "chat" && (
            <div className="workbench-chat-page">
              <div className="workbench-chat-messages">{messages.length === 0 ? <div className="workbench-assistant-message"><strong>步步兽</strong><p>你可以问我“今天应该先做什么？”，我会结合任务、项目和最近复盘回答。</p></div> : messages.map((item, index) => <div className={`workbench-chat-message workbench-chat-message--${item.role}`} key={index}><strong>{item.role === "user" ? "小昊" : "步步兽"}</strong><p>{item.content}</p></div>)}</div>
              <div className="workbench-prompt-row"><button type="button" onClick={() => setChatInput("今天应该先做什么？")}>今日优先级</button><button type="button" onClick={() => setChatInput("帮我把当前任务拆成最小行动。")}>拆解任务</button><button type="button" onClick={() => setChatInput("分析我当前的项目风险。")}>项目风险</button></div>
              <form className="workbench-chat-form" onSubmit={(event) => void sendMessage(event)}><input value={chatInput} maxLength={2000} placeholder="告诉步步兽你现在遇到的问题…" onChange={(event) => setChatInput(event.target.value)} /><button className="workbench-primary" type="submit" disabled={busy || !chatInput.trim()}>{busy ? "思考中…" : "发送"}</button></form>
            </div>
          )}

          {activeView === "review" && (
            <div className="workbench-review-page">{!review ? <div className="workbench-review-intro"><span className="workbench-badge">确认式写入</span><h2>把今天沉淀成可以继续使用的经验</h2><p>Hermes 会根据完成任务、专注时间和未完成事项生成草稿。生成阶段不会修改 Obsidian。</p><button className="workbench-primary" type="button" disabled={busy} onClick={() => void generateReview()}>{busy ? "生成中…" : "生成今日复盘"}</button></div> : <><div className="workbench-review-meta"><span>写入位置</span><strong>{review.targetPath}</strong></div><pre className="workbench-review-content">{review.content}</pre><div className="workbench-review-actions"><button type="button" onClick={() => setReview(null)}>放弃草稿</button><button className="workbench-primary" type="button" disabled={busy} onClick={() => void confirmReview()}>{busy ? "写入中…" : "确认写入 Obsidian"}</button></div></>}</div>
          )}

          {activeView === "coo" && (
            <div className="workbench-growth-page">
              <div className="workbench-stats"><article><span>完成任务</span><strong>{completedCount}</strong><small>历史累计</small></article><article><span>应用记录</span><strong>{formatDuration(usage?.totalSeconds ?? 0)}</strong><small>最近 7 天</small></article><article><span>活跃项目</span><strong>{activeProjectCount}</strong><small>进行中或验证中</small></article></div>
              {!coo ? <div className="workbench-coo-card"><span className="workbench-badge">AI COO</span><h2>用真实执行数据判断下一步</h2><p>分析只读取本地任务、项目和已授权的应用使用统计。</p><button className="workbench-primary" type="button" disabled={busy} onClick={() => void analyzeCoo()}>{busy ? "分析中…" : "分析执行与项目风险"}</button></div> : <div className="workbench-coo-result"><span className="workbench-badge">AI COO 建议</span><h2>{coo.summary}</h2><div><h3>需要注意</h3>{coo.risks.length ? coo.risks.map((item, index) => <p key={`r${index}`}>· {item}</p>) : <p>暂无明确风险。</p>}</div><div><h3>下一步</h3>{coo.suggestions.map((item, index) => <p key={`s${index}`}>{index + 1}. {item}</p>)}</div></div>}
            </div>
          )}

          {activeView === "memory" && (
            <div className="workbench-memory-page"><div className="workbench-memory-summary"><div><span className={`workbench-connection-dot workbench-connection-dot--${obsidianStatus?.state === "ready" ? "ready" : "offline"}`} /><strong>Obsidian</strong><small>{obsidianStatus?.message ?? "状态未知"}</small></div><button type="button" onClick={obsidianStatus?.state === "ready" ? proposeProjectSync : onRetryObsidian} disabled={projectSyncing}>{projectSyncing ? "读取中…" : obsidianStatus?.state === "ready" ? "同步项目" : "重新连接"}</button></div><div className="workbench-note-list">{notes.length === 0 ? <p className="workbench-empty">暂时没有可显示的 Markdown 笔记。</p> : notes.slice(0, 10).map((note) => <article key={note.relativePath}><span>◇</span><div><strong>{note.title}</strong><small>{note.folder || "根目录"} · {formatDate(note.modifiedAt)}</small></div><code>{note.relativePath}</code></article>)}</div></div>
          )}

          {activeView === "settings" && settings && (
            <div className="workbench-settings-page">
              <section><h2>身份与陪伴</h2><div className="workbench-setting-row"><div><strong>日常称呼</strong><small>正式姓名：冯昊</small></div><span className="workbench-setting-value">小昊</span></div><SettingToggle label="晨间规划提醒" description={`提醒时间 ${settings.morningTime}`} checked={settings.morningReminderEnabled} onChange={(checked) => void saveSettings({ ...settings, morningReminderEnabled: checked })} /><label className="workbench-select-row"><span><strong>晨间时间</strong><small>仅在晨间提醒开启时生效</small></span><input type="time" value={settings.morningTime} disabled={busy} onChange={(event) => void saveSettings({ ...settings, morningTime: event.target.value })} /></label><SettingToggle label="晚间复盘提醒" description={`提醒时间 ${settings.eveningTime}`} checked={settings.eveningReminderEnabled} onChange={(checked) => void saveSettings({ ...settings, eveningReminderEnabled: checked })} /><label className="workbench-select-row"><span><strong>晚间时间</strong><small>仅在晚间提醒开启时生效</small></span><input type="time" value={settings.eveningTime} disabled={busy} onChange={(event) => void saveSettings({ ...settings, eveningTime: event.target.value })} /></label></section>
              <section><h2>系统行为</h2><SettingToggle label="应用使用统计" description="只记录应用名和使用时长" checked={settings.activityTrackingEnabled} onChange={(checked) => void saveSettings({ ...settings, activityTrackingEnabled: checked })} /><SettingToggle label="开机自动启动" description="安装版本生效" checked={settings.autoLaunch} onChange={(checked) => void saveSettings({ ...settings, autoLaunch: checked })} /><label className="workbench-select-row"><span><strong>主动程度</strong><small>根据状态调整提醒频率</small></span><select value={settings.activeMode} disabled={busy} onChange={(event) => void saveSettings({ ...settings, activeMode: Number(event.target.value) as 2 | 3 | 4 })}><option value={2}>Level 2 陪伴</option><option value={3}>Level 3 日常助手</option><option value={4}>Level 4 AI COO</option></select></label></section>
              <section><h2>服务连接</h2><div className="workbench-connections"><ConnectionCard name="Hermes" description="AI 中枢" ready={hermesStatus?.state === "ready"} onClick={onRetryHermes} /><ConnectionCard name="Obsidian" description="长期记忆" ready={obsidianStatus?.state === "ready"} onClick={onRetryObsidian} /><ConnectionCard name="SQLite" description="本地实时数据" ready /></div></section>
              <button className="workbench-quit" type="button" onClick={onQuit}>退出步步兽</button>
            </div>
          )}
        </main>
      </div>

      {projectProposal && (
        <section className="workbench-sync-overlay" role="dialog" aria-modal="true" aria-label="Obsidian 项目同步确认">
          <div className="workbench-sync-dialog">
            <header>
              <div><p>Obsidian 项目同步</p><h2>{projectProposal.summary}</h2></div>
              <button type="button" onClick={onCancelProjectSync} disabled={projectConfirming} aria-label="关闭同步确认">×</button>
            </header>
            <div className="workbench-sync-scroll">
              <section>
                <h3>识别到的项目</h3>
                <div className="workbench-sync-projects">
                  {projectProposal.projects.map((project) => (
                    <article key={project.sourcePath}>
                      <div><strong>{project.name}</strong><span className="workbench-badge">{projectStatusLabel(project.status)}</span></div>
                      <p>{projectCategoryLabel(project.category)} · {project.currentStage ?? project.goal ?? "未找到明确阶段说明"}</p>
                    </article>
                  ))}
                </div>
              </section>
              <fieldset className="workbench-sync-tasks">
                <legend>可选任务候选</legend>
                <p>任务默认不创建，最多选择 5 个。</p>
                {projectProposal.taskCandidates.length === 0 ? <small>当前项目中没有找到明确的下一步行动。</small> : projectProposal.taskCandidates.map((candidate) => (
                  <label key={candidate.candidateKey}>
                    <input
                      type="checkbox"
                      checked={selectedProjectTasks.includes(candidate.candidateKey)}
                      disabled={!selectedProjectTasks.includes(candidate.candidateKey) && selectedProjectTasks.length >= 5}
                      onChange={() => setSelectedProjectTasks((current) => current.includes(candidate.candidateKey)
                        ? current.filter((key) => key !== candidate.candidateKey)
                        : [...current, candidate.candidateKey])}
                    />
                    <span><strong>{candidate.title}</strong><small>{candidate.projectName} · {candidate.estimatedMinutes} 分钟</small></span>
                  </label>
                ))}
              </fieldset>
            </div>
            <footer>
              <span>已选择 {selectedProjectTasks.length} 个任务</span>
              <div><button type="button" onClick={onCancelProjectSync} disabled={projectConfirming}>取消</button><button className="workbench-primary" type="button" onClick={() => onConfirmProjectSync(selectedProjectTasks)} disabled={projectConfirming}>{projectConfirming ? "同步中…" : selectedProjectTasks.length ? `同步项目并创建 ${selectedProjectTasks.length} 个任务` : "仅同步项目"}</button></div>
            </footer>
          </div>
        </section>
      )}
    </section>
  );
}

function WorkbenchNavGroup({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="workbench-nav-group"><p>{label}</p>{children}</section>;
}

function WorkbenchNavButton({ active, icon, label, onClick }: { active: boolean; icon: string; label: string; onClick: () => void }): React.JSX.Element {
  return <button className={active ? "is-active" : ""} type="button" onClick={onClick}><span aria-hidden="true">{icon}</span>{label}</button>;
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }): React.JSX.Element {
  return <label className="workbench-setting-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function ConnectionCard({ name, description, ready, onClick }: { name: string; description: string; ready: boolean; onClick?: () => void }): React.JSX.Element {
  return <button type="button" onClick={onClick}><span className={`workbench-connection-dot workbench-connection-dot--${ready ? "ready" : "offline"}`} /><span><strong>{name}</strong><small>{description}</small></span><em>{ready ? "已连接" : "待连接"}</em></button>;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes} 分钟`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleDateString("zh-CN");
}

function projectCategoryLabel(category: StepBeastProjectCategory): string {
  if (category === "current") return "当前项目";
  if (category === "support") return "支撑系统";
  return "暂停保留";
}

function projectStatusLabel(status: StepBeastProjectStatus): string {
  const labels: Record<StepBeastProjectStatus, string> = { active: "进行中", testing: "验证中", paused: "已暂停", completed: "已完成", archived: "已归档" };
  return labels[status];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
