import type {
  EatingOutSuggestionResult,
  FeedbackInput,
  IsoDate,
  MealType,
  RecipeDetail,
} from "@nutrition/shared";
import { apiRequest } from "./httpClient.js";
import type { ApiError, Result } from "./types.js";

/**
 * `/api/menu-plans/:week/days/:day/meals/:meal` 用の型付きfetchクライアント（design.md:
 * File Structure Plan `web/src/api/mealSlotClient.ts`）。`menuPlanClient.ts`（task 2.2）と
 * 同じパターン（`httpClient.ts` の `apiRequest<T>` をそのまま用いる薄いラッパー）に従う。
 *
 * `generateRecipeDetail` が409/502で返す `GenerationError`（`reason` フィールドで失敗理由を
 * 判別可能）、および3メソッドいずれもが対象の食事枠/週間献立プランが存在しない場合に404で
 * 返す `NotFoundError` は、`apiRequest`（task 2.2の一環で `httpClient.ts` / `types.ts` を
 * 拡張済み: `isGenerationErrorPayload` / `isNotFoundErrorPayload`）がそのまま `unknown` に
 * 丸め込まず `ApiError`（判別共用体）として判別可能な形で `Result.error` に伝えるため、
 * 本ファイルはそのまま `apiRequest` の戻り値を返すのみで例外処理は行わない
 * （`server/src/menu-generation/meal-slot.routes.ts` 冒頭コメント参照。task brief で検証済み:
 * 新たな `ApiError` バリアントの追加は不要）。
 *
 * `submitFeedback`/`getEatingOutSuggestion` は `GenerationError`（409/502）を一切返し得ない
 * （`FeedbackService.recordFeedback`/`EatingOutSuggestionService.suggestForMealSlot` は
 * いずれも同期関数でClaude APIを呼ばないため、`meal-slot.routes.ts` 冒頭コメント参照）。
 *
 * `submitFeedback` の成功応答は204 No Content（レスポンスボディなし）であり、`apiRequest` が
 * 既にstatus 204を `{ok:true, value: undefined}` として特別扱いする（`httpClient.ts` 参照）
 * ため、本ファイルは呼び出すだけでよい。
 *
 * `getEatingOutSuggestion` の200応答は常に `{suggestion: EatingOutSuggestion | null}` という
 * JSONオブジェクトであり（`menuPlanClient.getShoppingList`/`getWeekPlan` の「未生成時は裸の
 * `null` ボディ」パターンとは異なる）、「代替案なし」は失敗ではなく
 * `Result.ok: true, value: {suggestion: null}` としてそのまま伝わる（`meal-slot.routes.ts`
 * 冒頭コメント参照）。
 */
function mealSlotEndpoint(weekStartDate: IsoDate, dayIndex: number, mealType: MealType): string {
  return `/api/menu-plans/${weekStartDate}/days/${dayIndex}/meals/${mealType}`;
}

/**
 * `POST /api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/recipe-detail` の
 * 型付きクライアント（design.md: API Contract）。生成に失敗した場合は
 * `error.type === "generation_failed"`（`reason` フィールド付き）、対象の食事枠/週間献立プランが
 * 存在しない場合は `error.type === "not_found"` として、それぞれ判別可能な形で伝わる
 * （例外は投げない）。
 */
export function generateRecipeDetail(
  weekStartDate: IsoDate,
  dayIndex: number,
  mealType: MealType,
): Promise<Result<RecipeDetail, ApiError>> {
  return apiRequest<RecipeDetail>(`${mealSlotEndpoint(weekStartDate, dayIndex, mealType)}/recipe-detail`, {
    method: "POST",
  });
}

/**
 * `POST /api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/feedback` の
 * 型付きクライアント（design.md: API Contract）。成功時は204 No Contentであり
 * `Result.ok: true, value: undefined` として伝わる。対象の食事枠が存在しない場合は
 * `error.type === "not_found"` として判別可能な形で伝わる（例外は投げない）。
 */
export function submitFeedback(
  weekStartDate: IsoDate,
  dayIndex: number,
  mealType: MealType,
  liked: boolean,
): Promise<Result<void, ApiError>> {
  return apiRequest<void>(`${mealSlotEndpoint(weekStartDate, dayIndex, mealType)}/feedback`, {
    method: "POST",
    body: { liked } satisfies FeedbackInput,
  });
}

/**
 * `GET /api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/eating-out-suggestion` の
 * 型付きクライアント（design.md: API Contract）。対象の食事枠が存在しない場合は
 * `error.type === "not_found"` として判別可能な形で伝わる。代替案が選定されなかった場合は
 * 失敗ではなく `Result.ok: true, value: {suggestion: null}` として伝わる（ファイル冒頭コメント
 * 参照。`menuPlanClient` の「200 + 裸のnullボディ」パターンとは異なる形状）。
 */
export function getEatingOutSuggestion(
  weekStartDate: IsoDate,
  dayIndex: number,
  mealType: MealType,
): Promise<Result<EatingOutSuggestionResult, ApiError>> {
  return apiRequest<EatingOutSuggestionResult>(
    `${mealSlotEndpoint(weekStartDate, dayIndex, mealType)}/eating-out-suggestion`,
    { method: "GET" },
  );
}
