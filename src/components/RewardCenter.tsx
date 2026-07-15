import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Props = {
  summary: StepBeastRewardSummary | null;
  busy: boolean;
  onCreateGoal: (input: StepBeastCreateRewardGoal) => Promise<void>;
  onUpdateFunding: (goalId: string, fundCurrentYuan: number) => Promise<void>;
  onRedeem: (goalId: string) => Promise<void>;
};

export function RewardCenter({ summary, busy, onCreateGoal, onUpdateFunding, onRedeem }: Props): React.JSX.Element {
  const [name, setName] = useState("特斯拉");
  const [category, setCategory] = useState<StepBeastRewardCategory>("legendary");
  const [coinCost, setCoinCost] = useState("100000");
  const [fundTarget, setFundTarget] = useState("250000");
  const [fundValues, setFundValues] = useState<Record<string, string>>({});
  const [confirmGoalId, setConfirmGoalId] = useState<string | null>(null);

  useEffect(() => {
    if (!summary) return;
    setFundValues((current) => Object.fromEntries(summary.goals.map((goal) => [
      goal.id,
      current[goal.id] ?? String(goal.fundCurrentYuan),
    ])));
  }, [summary]);

  async function submitGoal(event: FormEvent): Promise<void> {
    event.preventDefault();
    const parsedCoinCost = Number(coinCost);
    const parsedFundTarget = Number(fundTarget);
    if (!name.trim() || !Number.isInteger(parsedCoinCost) || parsedCoinCost < 1 || !Number.isFinite(parsedFundTarget) || parsedFundTarget < 0) return;
    await onCreateGoal({ name: name.trim(), category, coinCost: parsedCoinCost, fundTargetYuan: parsedFundTarget });
    setName("");
    setCoinCost("");
    setFundTarget("");
  }

  const profile = summary?.profile;
  const levelSpan = Math.max(1, (summary?.nextLevelXp ?? 100) - (summary?.currentLevelStartXp ?? 0));
  const levelProgress = Math.max(0, Math.min(100, (((profile?.totalXp ?? 0) - (summary?.currentLevelStartXp ?? 0)) / levelSpan) * 100));

  return (
    <section className="reward-center">
      <div className="reward-overview">
        <article><span>当前等级</span><strong>Lv.{profile?.level ?? 1}</strong><small>XP 永久累计，不会消费</small></article>
        <article><span>成长经验</span><strong>{formatNumber(profile?.totalXp ?? 0)} XP</strong><small>下一级需要 {formatNumber(summary?.nextLevelXp ?? 100)} XP</small></article>
        <article className="reward-coin-card"><span>可用步步币</span><strong>◉ {formatNumber(profile?.rewardCoins ?? 0)}</strong><small>用于兑换现实奖励资格</small></article>
      </div>
      <div className="reward-level-progress"><span style={{ width: `${levelProgress}%` }} /></div>
      <p className="reward-rule-note">普通任务获得基础奖励；今日主线、项目关联和真实专注会增加 XP 与等额步步币。系统不会自动购买或支付。</p>

      <form className="reward-goal-form" onSubmit={(event) => void submitGoal(event)}>
        <div><span>新建现实奖励</span><strong>把愿望变成可以积累的目标</strong></div>
        <input value={name} maxLength={60} placeholder="奖励名称，例如：特斯拉" onChange={(event) => setName(event.target.value)} />
        <select value={category} onChange={(event) => setCategory(event.target.value as StepBeastRewardCategory)}><option value="daily">日常奖励</option><option value="experience">体验奖励</option><option value="purchase">购买奖励</option><option value="legendary">传奇奖励</option></select>
        <label><span>需要步步币</span><input type="number" min={1} max={10000000} step={1} value={coinCost} onChange={(event) => setCoinCost(event.target.value)} /></label>
        <label><span>现实资金目标（元）</span><input type="number" min={0} max={100000000} step={0.01} value={fundTarget} onChange={(event) => setFundTarget(event.target.value)} /></label>
        <button className="workbench-primary" type="submit" disabled={busy || !name.trim() || !coinCost || !fundTarget}>创建奖励目标</button>
      </form>

      <div className="reward-goal-list">
        {summary?.goals.length ? summary.goals.map((goal) => {
          const coinProgress = Math.min(100, ((profile?.rewardCoins ?? 0) / goal.coinCost) * 100);
          const fundProgress = goal.fundTargetYuan === 0 ? 100 : Math.min(100, (goal.fundCurrentYuan / goal.fundTargetYuan) * 100);
          const canRedeem = goal.status === "active" && coinProgress >= 100 && fundProgress >= 100;
          return (
            <article className={`reward-goal-card reward-goal-card--${goal.category}`} key={goal.id}>
              <header><div><span>{categoryLabel(goal.category)}</span><h3>{goal.name}</h3></div><strong>{goal.status === "redeemed" ? "已兑换" : canRedeem ? "可以解锁" : "积累中"}</strong></header>
              <RewardProgress label="行动进度" value={`${formatNumber(profile?.rewardCoins ?? 0)} / ${formatNumber(goal.coinCost)} 币`} progress={coinProgress} />
              <RewardProgress label="资金进度" value={`${formatMoney(goal.fundCurrentYuan)} / ${formatMoney(goal.fundTargetYuan)}`} progress={fundProgress} />
              {goal.status === "active" && <div className="reward-fund-row"><label><span>更新当前资金</span><input type="number" min={0} max={100000000} step={0.01} value={fundValues[goal.id] ?? ""} onChange={(event) => setFundValues((current) => ({ ...current, [goal.id]: event.target.value }))} /></label><button type="button" disabled={busy} onClick={() => void onUpdateFunding(goal.id, Number(fundValues[goal.id] ?? 0))}>保存资金</button></div>}
              {goal.status === "active" && (confirmGoalId === goal.id ? <div className="reward-confirm-row"><span>只记录兑换资格，不会自动支付。</span><button type="button" onClick={() => setConfirmGoalId(null)}>返回</button><button className="workbench-primary" type="button" disabled={busy || !canRedeem} onClick={() => void onRedeem(goal.id).then(() => setConfirmGoalId(null))}>确认兑换</button></div> : <button className="reward-redeem-button" type="button" disabled={!canRedeem || busy} onClick={() => setConfirmGoalId(goal.id)}>兑换奖励</button>)}
            </article>
          );
        }) : <p className="workbench-empty">还没有奖励目标。可以从一个小奖励开始，也可以直接建立“特斯拉”传奇目标。</p>}
      </div>
    </section>
  );
}

function RewardProgress({ label, value, progress }: { label: string; value: string; progress: number }): React.JSX.Element {
  return <div className="reward-progress"><div><span>{label}</span><strong>{value}</strong></div><div><span style={{ width: `${progress}%` }} /></div></div>;
}

function categoryLabel(category: StepBeastRewardCategory): string {
  return { daily: "日常奖励", experience: "体验奖励", purchase: "购买奖励", legendary: "传奇奖励" }[category];
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatMoney(value: number): string {
  return `¥${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)}`;
}
