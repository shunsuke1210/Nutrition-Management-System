/**
 * FeedbackService — 満足度フィードバックの検証・記録、および次回生成向けの苦手サマリ提供。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #FeedbackService、
 * Requirements 10.1, 10.3, 10.4）に定義されたService Interfaceを実装する。
 *
 * ## design.md 内部の不整合とその解決（スナップショットの出所）
 * design.mdのService Interfaceブロックは
 *   `recordFeedback(weekStartDate, dayIndex, mealType, input: FeedbackInput)`
 * （`FeedbackInput = { liked: boolean }`、スナップショット用の引数なし）と定義する一方、
 * Responsibilities & Constraintsは本メソッド自身が「対象の食事枠が有効な献立プラン内に
 * 存在することを確認し、存在しない場合はNotFoundErrorを返す」ことと「対象食枠の料理名と
 * 主要な食材の食品IDをスナップショットとして保存する」ことの両方を課しており、
 * インターフェース上にスナップショットを運ぶ引数がないにもかかわらずスナップショットを
 * 保存できることを要求している。
 *
 * これを、`recordFeedback` 自身が同じ存在確認の一環として
 * `MenuPlanRepository.findMealSlot(weekStartDate, dayIndex, mealType)` を呼び、その戻り値
 * （`MealSlot`）からスナップショット（`dishName`・`ingredients[].foodId`）を組み立てる、
 * と解決した。Preconditionsの「記録時点のスナップショットは MenuPlanService/RecipeDetailService
 * 経由で FeedbackService に渡される」という注記は、関数呼び出し時に渡される実引数の説明ではなく
 * （そう解釈するとインターフェース宣言と矛盾する）、そのデータの由来（`MenuPlanService`/
 * `RecipeDetailService` が過去に `MenuPlanRepository` へ書き込んだデータであるという由来）
 * の説明として読む。
 *
 * Dependenciesの行は `FeedbackRepository` のみを挙げ `MenuPlanRepository` を明示しないが、
 * これは欠落したドキュメントであり制約ではないと判断した（task 5.1 `MenuPlanRepository`が
 * design.mdのDependencies行に無かった`UnitConversionService`を追加で必要とした前例と同種の
 * 状況であり、その際も「データが他のどこにも存在しないため依存を追加する」という判断が
 * 妥当とされた。ここではさらに、ServiceがRepositoryに依存するという、このコードベースで
 * 既に確立された通常の方向（例: `NutritionVerificationService` → `FoodCompositionRepository`）
 * であるため、より制約が少ない）。
 *
 * ## 「主要な食材」の解釈
 * design.mdは「主要な食材の食品ID」と述べるが、`MealSlot.ingredients`
 * （`IngredientSelection[]`、`@nutrition/shared`）にはどの食材が「主要」かを示すフラグは
 * 存在しない。したがって本実装は「主要な食材」を「その料理の食材全件」と解釈し、
 * `ingredients.map(i => i.foodId)` をそのまま `primaryFoodIds` とする（フィルタリングは行わない）。
 *
 * ## getDislikedSummaryのデフォルト上限
 * design.mdは「上限件数を設け」とのみ述べ具体的な数値を規定しない。1週間は28食枠
 * （7日×4食種）であり、苦手フィードバックが週替わりで蓄積されていくことを踏まえ、直近の
 * 傾向を捉えつつ生成プロンプトを肥大化させない値として10件をデフォルトとした。
 *
 * ## FeedbackInput の再利用
 * design.mdのService Interfaceは `FeedbackInput` を本コンポーネント固有の型として示すが、
 * 実際には `shared/src/menu.schema.ts`（task 4.1系列）が既に `FeedbackInputSchema` /
 * `FeedbackInput` をexport済みである。したがって本ファイルでは再定義せず、
 * `@nutrition/shared` からそのままimportする（このコードベースの「既存の共有型を再定義しない」
 * 規約に従う）。
 */
import type { FeedbackInput, IsoDate, MealType } from "@nutrition/shared";
import type { NotFoundError, Result, ValidationError } from "../shared/result.js";
import type { FeedbackRepository } from "./feedback.repository.js";
import type { MenuPlanRepository } from "./menu-plan.repository.js";
import type { DislikedItemSummary } from "./menu-prompt.builder.js";

/**
 * `getDislikedSummary` が `limit` 省略時に用いるデフォルト上限（ファイル冒頭コメント参照）。
 * design.mdが具体的な数値を規定していないため、このコードベースで最初に確立する既定値。
 */
const DEFAULT_DISLIKED_SUMMARY_LIMIT = 10;

/** design.md #FeedbackService Service Interface。 */
export interface FeedbackService {
  recordFeedback(
    weekStartDate: IsoDate,
    dayIndex: number,
    mealType: MealType,
    input: FeedbackInput
  ): Result<void, ValidationError | NotFoundError>;
  getDislikedSummary(limit?: number): DislikedItemSummary[];
}

/**
 * `feedbackRepository` / `menuPlanRepository`（いずれも既に構築済みの依存）に対する
 * `FeedbackService` を生成する。`createNutritionVerificationService`
 * （`nutrition-verification.service.ts`）と同じDIファクトリ関数パターンに揃えており、
 * 本Serviceは依存を自ら構築せず、渡されたインスタンスのみを利用する。
 */
export function createFeedbackService(
  feedbackRepository: FeedbackRepository,
  menuPlanRepository: MenuPlanRepository
): FeedbackService {
  function recordFeedback(
    weekStartDate: IsoDate,
    dayIndex: number,
    mealType: MealType,
    input: FeedbackInput
  ): Result<void, ValidationError | NotFoundError> {
    // 対象の食事枠が有効な献立プラン内に存在することを確認する（design.md Responsibilities）。
    // この呼び出しの戻り値（MealSlot）を、下のスナップショット組み立てにもそのまま使う
    // （ファイル冒頭コメントの「不整合の解決」を参照）。
    const mealSlot = menuPlanRepository.findMealSlot(weekStartDate, dayIndex, mealType);
    if (!mealSlot) {
      const notFound: NotFoundError = {
        type: "not_found",
        message:
          `指定された食事枠が有効な献立プラン内に見つかりません` +
          `（weekStartDate: ${weekStartDate}, dayIndex: ${dayIndex}, mealType: ${mealType}）`,
      };
      return { ok: false, error: notFound };
    }

    // 料理名と食材の食品ID全件をスナップショットとして保存する（design.md 10.2、
    // 「主要な食材」の解釈はファイル冒頭コメント参照）。
    feedbackRepository.upsert({
      weekStartDate,
      dayIndex,
      mealType,
      dishName: mealSlot.dishName,
      primaryFoodIds: mealSlot.ingredients.map((ingredient) => ingredient.foodId),
      liked: input.liked,
    });

    return { ok: true, value: undefined };
  }

  function getDislikedSummary(limit?: number): DislikedItemSummary[] {
    const entries = feedbackRepository.findRecentDisliked(limit ?? DEFAULT_DISLIKED_SUMMARY_LIMIT);
    return entries.map((entry) => ({
      dishName: entry.dishName,
      foodIds: entry.primaryFoodIds,
    }));
  }

  return { recordFeedback, getDislikedSummary };
}
