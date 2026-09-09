/**
 * MenuGenerator — 献立生成（週間・日単位・レシピ詳細）の抽象境界（task 17.1、新規）。
 *
 * task 17.1以前は `MenuPlanService`/`RecipeDetailService` が `ClaudeMenuClient`
 * （Claude Messages API呼び出し）に直接依存し、呼び出し直前に自分自身で
 * `menu-prompt.builder.ts` の `buildWeeklyPrompt`/`buildDailyPrompt`/`buildRecipeDetailPrompt`
 * を呼んでプロンプトを構築していた。本タスクはこの「構造化入力 → プロンプト構築 → Claude呼び出し」
 * という一連の処理を `MenuGenerator` という1枚の抽象の背後へ移し、
 * `MenuPlanService`/`RecipeDetailService` からはプロンプト構築の詳細（Claude固有の関心事）を
 * 完全に見えなくする。
 *
 * ## この切り出しの動機
 * AI（Claude API）を一切呼ばない代替実装（`RuleBasedMenuGenerator`、task 17.3以降）を
 * 将来追加するための土台である。本タスク自体は挙動を一切変更しない純粋なリファクタリングであり、
 * `RuleBasedMenuGenerator`の実装（キュレーション済みレシピDBを用いた非AI生成ロジック）は
 * このタスクのスコープ外である（`ClaudeMenuGenerator`が唯一の実装のまま）。
 *
 * ## 引数・戻り値の型について
 * 3メソッドの引数は、呼び出し元（`MenuPlanService`/`RecipeDetailService`）が既に手元に持つ
 * 構造化データ（プロフィール・栄養目標・他日コンテキスト・苦手サマリ・対象食事枠）そのものであり、
 * Claude固有の `ClaudePromptPayload`（`system`/`userMessage`の文字列ペア）を経由しない。
 *
 * 戻り値の形状（`WeeklyGenerationToolResult`/`DailyGenerationToolResult`/
 * `RecipeGenerationToolResult`）は「生成結果のデータ形状」であって「Claude固有の形状」では
 * ないため、`claude-menu.client.ts` が既に定義する型をそのまま再利用する（重複定義しない）。
 * `ClaudeGenerationError`/`ClaudeGenerationErrorType` も同じ理由でそのまま再利用する
 * （`MenuPlanService`/`RecipeDetailService` 側の `mapClaudeErrorReason` 等、既存のエラー
 * ハンドリング分岐に一切影響を与えないため、リネームは行わない）。
 */
import type { IsoDate, MealSlot } from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type {
  ClaudeGenerationError,
  DailyGenerationToolResult,
  RecipeGenerationToolResult,
  WeeklyGenerationToolResult,
} from "./claude-menu.client.js";
import type { OtherDayContext } from "./menu-plan.repository.js";
import type { DislikedItemSummary } from "./menu-prompt.builder.js";
import type { NutritionTargetSnapshot } from "./nutrition.gateway.js";
import type { MenuProfileSnapshot } from "./profile.gateway.js";

/**
 * 献立生成の抽象境界。`ClaudeMenuGenerator`（`claude-menu.generator.ts`）が現時点で唯一の
 * 実装であり、将来 `RuleBasedMenuGenerator`（task 17.3以降）がこれに並ぶ2つ目の実装になる。
 */
export interface MenuGenerator {
  /**
   * 1週間分（7日×4食枠）の献立を生成する。
   * `menu-plan.service.ts` の `runWeeklyGeneration`（`generateWeek`/`regenerateWeek`が共有する
   * 内部オーケストレーション）が、プロフィール取得・週7日分の栄養目標取得・苦手サマリ取得の
   * 直後に呼ぶ。
   */
  generateWeek(
    profile: MenuProfileSnapshot,
    targets: Record<IsoDate, NutritionTargetSnapshot>,
    dislikedSummary: DislikedItemSummary[]
  ): Promise<Result<WeeklyGenerationToolResult, ClaudeGenerationError>>;

  /**
   * 対象1日分（4食枠）の献立を生成する（残り6日分は変更しない）。
   * `menu-plan.service.ts` の `runDailyGeneration`（`regenerateDay`の内部オーケストレーション）が、
   * プロフィール取得・対象日の栄養目標取得・残り6日分のコンテキスト取得・苦手サマリ取得の
   * 直後に呼ぶ。
   */
  generateDay(
    profile: MenuProfileSnapshot,
    target: NutritionTargetSnapshot,
    otherDays: OtherDayContext[],
    dislikedSummary: DislikedItemSummary[]
  ): Promise<Result<DailyGenerationToolResult, ClaudeGenerationError>>;

  /**
   * 確定済みの食事枠1件に対するレシピ詳細（分量・目安調理時間・調理手順）と、補助副菜提案を
   * 生成する。`recipe-detail.service.ts` の `generateForMealSlot` が、対象食事枠の存在確認・
   * プロフィール取得の直後に呼ぶ。
   *
   * `mealSlot` は `MenuPlanRepository.findMealSlot` の戻り値（`null`分岐済み）であり、
   * `id`（`meal_slots.id`）を含む。`ClaudeMenuGenerator`内部が呼ぶ
   * `buildRecipeDetailPrompt`（`menu-prompt.builder.ts`）自体は`id`を使わないが、
   * 呼び出し元（`RecipeDetailService`）が実際に手にしている値の型をそのまま反映する。
   */
  generateRecipe(
    mealSlot: MealSlot & { id: number },
    profile: MenuProfileSnapshot
  ): Promise<Result<RecipeGenerationToolResult, ClaudeGenerationError>>;
}
