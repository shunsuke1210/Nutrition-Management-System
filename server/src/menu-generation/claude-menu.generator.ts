/**
 * ClaudeMenuGenerator — `MenuGenerator`（`menu-generator.ts`、task 17.1）のClaude実装。
 *
 * task 17.1以前は `menu-plan.service.ts`/`recipe-detail.service.ts` が自分自身で
 * `menu-prompt.builder.ts` の `buildWeeklyPrompt`/`buildDailyPrompt`/`buildRecipeDetailPrompt`
 * を呼んでプロンプトを構築し、その結果を `ClaudeMenuClient.generateWeek`/`generateDay`/
 * `generateRecipe`（`claude-menu.client.ts`）へ渡していた。本ファイルはその
 * 「プロンプト構築 → Claude呼び出し」という既存の2ステップをそのままこの1箇所へ移しただけであり、
 * 新しい判断・分岐・エラーハンドリングは一切追加しない（純粋なリファクタリング、task 17.1の
 * スコープ）。
 */
import type { IsoDate, MealSlot } from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type {
  ClaudeGenerationError,
  ClaudeMenuClient,
  DailyGenerationToolResult,
  RecipeGenerationToolResult,
  WeeklyGenerationToolResult,
} from "./claude-menu.client.js";
import type { MenuGenerator } from "./menu-generator.js";
import type { OtherDayContext } from "./menu-plan.repository.js";
import {
  buildDailyPrompt,
  buildRecipeDetailPrompt,
  buildWeeklyPrompt,
  type DislikedItemSummary,
} from "./menu-prompt.builder.js";
import type { NutritionTargetSnapshot } from "./nutrition.gateway.js";
import type { MenuProfileSnapshot } from "./profile.gateway.js";

/**
 * `claudeMenuClient`（既に構築済みの `ClaudeMenuClient`、`createClaudeMenuClient`の戻り値）に
 * 対する `MenuGenerator` を生成する。`createClaudeMenuClient`/`createNutritionVerificationService`
 * 等、このコードベースが確立したDIファクトリ関数パターンに揃えている。
 */
export function createClaudeMenuGenerator(claudeMenuClient: ClaudeMenuClient): MenuGenerator {
  async function generateWeek(
    profile: MenuProfileSnapshot,
    targets: Record<IsoDate, NutritionTargetSnapshot>,
    dislikedSummary: DislikedItemSummary[]
  ): Promise<Result<WeeklyGenerationToolResult, ClaudeGenerationError>> {
    const payload = buildWeeklyPrompt(profile, targets, dislikedSummary);
    return claudeMenuClient.generateWeek(payload);
  }

  async function generateDay(
    profile: MenuProfileSnapshot,
    target: NutritionTargetSnapshot,
    otherDays: OtherDayContext[],
    dislikedSummary: DislikedItemSummary[]
  ): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>> {
    const payload = buildDailyPrompt(profile, target, otherDays, dislikedSummary);
    return claudeMenuClient.generateDay(payload);
  }

  async function generateRecipe(
    mealSlot: MealSlot & { id: number },
    profile: MenuProfileSnapshot
  ): Promise<Result<RecipeGenerationToolResult, ClaudeGenerationError>> {
    const payload = buildRecipeDetailPrompt(mealSlot, profile);
    return claudeMenuClient.generateRecipe(payload);
  }

  return { generateWeek, generateDay, generateRecipe };
}
