import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { levelForXp, type PetProfile } from "./taskRepository.js";

export type RewardCategory = "daily" | "experience" | "purchase" | "legendary";

export type RewardGoal = {
  id: string;
  name: string;
  category: RewardCategory;
  coinCost: number;
  fundTargetYuan: number;
  fundCurrentYuan: number;
  status: "active" | "redeemed" | "archived";
  createdAt: string;
  updatedAt: string;
  redeemedAt: string | null;
};

export type RewardSummary = {
  profile: PetProfile;
  currentLevelStartXp: number;
  nextLevelXp: number;
  goals: RewardGoal[];
};

export type CreateRewardGoalInput = {
  name: string;
  category: RewardCategory;
  coinCost: number;
  fundTargetYuan: number;
};

type RewardGoalRow = {
  id: string;
  name: string;
  category: RewardCategory;
  coin_cost: number;
  fund_target_cents: number;
  fund_current_cents: number;
  status: RewardGoal["status"];
  created_at: string;
  updated_at: string;
  redeemed_at: string | null;
};

type PetRow = {
  id: string;
  name: string;
  level: number;
  total_xp: number;
  emotion: string;
  active_mode: number;
  reward_coins: number;
};

const DEFAULT_PET_ID = "stepbeast-default";

export class RewardRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
  }

  getSummary(): RewardSummary {
    const profile = this.getProfile();
    return {
      profile,
      currentLevelStartXp: xpRequiredForLevel(profile.level),
      nextLevelXp: xpRequiredForLevel(profile.level + 1),
      goals: this.listGoals(),
    };
  }

  createGoal(input: CreateRewardGoalInput): RewardSummary {
    const goal = validateGoalInput(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO reward_goals (
        id, name, category, coin_cost, fund_target_cents,
        fund_current_cents, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)
    `).run(id, goal.name, goal.category, goal.coinCost, yuanToCents(goal.fundTargetYuan), now, now);
    return this.getSummary();
  }

  updateFunding(goalId: string, fundCurrentYuan: number): RewardSummary {
    const goal = this.getGoalRow(goalId);
    if (goal.status !== "active") throw new Error("已兑换的奖励不能修改资金进度");
    if (!Number.isFinite(fundCurrentYuan) || fundCurrentYuan < 0 || fundCurrentYuan > 100_000_000) {
      throw new Error("资金进度需要在 0 到 1 亿元之间");
    }
    this.database.prepare(`
      UPDATE reward_goals SET fund_current_cents = ?, updated_at = ? WHERE id = ?
    `).run(yuanToCents(fundCurrentYuan), new Date().toISOString(), goalId);
    return this.getSummary();
  }

  redeem(goalId: string): RewardSummary {
    const goal = this.getGoalRow(goalId);
    if (goal.status !== "active") throw new Error("这个奖励已经兑换或归档");
    const profile = this.getProfile();
    if (profile.rewardCoins < goal.coin_cost) throw new Error("步步币还没有达到兑换条件");
    if (goal.fund_current_cents < goal.fund_target_cents) throw new Error("现实资金进度还没有达到目标");

    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE pet_profiles SET reward_coins = reward_coins - ?, updated_at = ? WHERE id = ?
      `).run(goal.coin_cost, now, DEFAULT_PET_ID);
      this.database.prepare(`
        UPDATE reward_goals SET status = 'redeemed', redeemed_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, goalId);
      this.database.prepare(`
        INSERT INTO reward_redemptions (id, goal_id, coins_spent, fund_snapshot_cents, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), goalId, goal.coin_cost, goal.fund_current_cents, now);
      this.database.prepare(`
        INSERT INTO events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'RewardRedeemed', 'reward_goal', ?, ?, ?)
      `).run(randomUUID(), goalId, JSON.stringify({ name: goal.name, coinsSpent: goal.coin_cost }), now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getSummary();
  }

  close(): void {
    this.database.close();
  }

  private listGoals(): RewardGoal[] {
    const rows = this.database.prepare(`
      SELECT id, name, category, coin_cost, fund_target_cents, fund_current_cents,
             status, created_at, updated_at, redeemed_at
      FROM reward_goals
      WHERE status != 'archived'
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC
    `).all() as unknown as RewardGoalRow[];
    return rows.map(mapGoalRow);
  }

  private getGoalRow(goalId: string): RewardGoalRow {
    if (!goalId) throw new Error("缺少奖励目标 ID");
    const row = this.database.prepare(`
      SELECT id, name, category, coin_cost, fund_target_cents, fund_current_cents,
             status, created_at, updated_at, redeemed_at
      FROM reward_goals WHERE id = ?
    `).get(goalId) as unknown as RewardGoalRow | undefined;
    if (!row) throw new Error("没有找到这个奖励目标");
    return row;
  }

  private getProfile(): PetProfile {
    const row = this.database.prepare(`
      SELECT id, name, level, total_xp, emotion, active_mode, reward_coins
      FROM pet_profiles WHERE id = ?
    `).get(DEFAULT_PET_ID) as unknown as PetRow | undefined;
    if (!row) throw new Error("没有找到宠物档案");
    const calculatedLevel = levelForXp(row.total_xp);
    return {
      id: row.id,
      name: row.name,
      level: calculatedLevel,
      totalXp: row.total_xp,
      emotion: row.emotion,
      activeMode: row.active_mode,
      rewardCoins: row.reward_coins,
    };
  }
}

function validateGoalInput(input: CreateRewardGoalInput): CreateRewardGoalInput {
  const name = input.name?.trim();
  if (!name || name.length > 60) throw new Error("奖励名称需要填写，且不能超过 60 个字");
  if (!["daily", "experience", "purchase", "legendary"].includes(input.category)) {
    throw new Error("奖励类别无效");
  }
  if (!Number.isInteger(input.coinCost) || input.coinCost < 1 || input.coinCost > 10_000_000) {
    throw new Error("步步币目标需要是 1 到 1000 万之间的整数");
  }
  if (!Number.isFinite(input.fundTargetYuan) || input.fundTargetYuan < 0 || input.fundTargetYuan > 100_000_000) {
    throw new Error("资金目标需要在 0 到 1 亿元之间");
  }
  return { name, category: input.category, coinCost: input.coinCost, fundTargetYuan: input.fundTargetYuan };
}

function mapGoalRow(row: RewardGoalRow): RewardGoal {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    coinCost: row.coin_cost,
    fundTargetYuan: centsToYuan(row.fund_target_cents),
    fundCurrentYuan: centsToYuan(row.fund_current_cents),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    redeemedAt: row.redeemed_at,
  };
}

function xpRequiredForLevel(level: number): number {
  return (100 * Math.max(0, level - 1) * level) / 2;
}

function yuanToCents(value: number): number {
  return Math.round(value * 100);
}

function centsToYuan(value: number): number {
  return value / 100;
}
