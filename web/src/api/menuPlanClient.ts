import type { DayMenu, IsoDate, ShoppingList, WeekMenuPlan } from "@nutrition/shared";
import { apiRequest } from "./httpClient.js";
import type { ApiError, Result } from "./types.js";

/**
 * `/api/menu-plans` 用の型付きfetchクライアント（design.md: File Structure Plan
 * `web/src/api/menuPlanClient.ts`）。`nutritionClient.ts`（task 2.1）と同じパターン
 * （`httpClient.ts` の `apiRequest<T>` をそのまま用いる薄いラッパー）に従う。
 *
 * `getWeekPlan`/`getShoppingList` は対象週の有効な週間献立プランが存在しない場合、
 * サーバーが404ではなく200 + `null` を返す（`menu-plan.routes.ts` 冒頭コメント「GET
 * /api/menu-plans/:weekStartDate の null 許容について」「GET
 * /api/menu-plans/:weekStartDate/shopping-list について」）。これは失敗ではなく
 * 「未生成」という正常な応答であるため、`Result.ok: true, value: null` としてそのまま
 * 呼び出し元に伝える（`profileClient.getProfile` の「プロフィール未登録時は200 + null」と
 * 同じ規約）。
 *
 * `regenerateWeek`/`regenerateDay` が409/502で返す `GenerationError`（`reason` フィールドで
 * 失敗理由を判別可能）、および `regenerateDay` が対象週の有効なプランが存在しない場合に
 * 404で返す `NotFoundError` は、`apiRequest`（task 2.2の一環で `httpClient.ts` / `types.ts`
 * を拡張済み: `isGenerationErrorPayload` ガード追加。`NotFoundError` は既存の
 * `isNotFoundErrorPayload` がそのまま認識する）が `type: "unknown"` に丸め込まず
 * `ApiError`（判別共用体）として判別可能な形で `Result.error` に伝えるため、本ファイルは
 * そのまま `apiRequest` の戻り値を返すのみで例外処理は行わない。409と502のどちらを
 * 返すかのロジック（`generationErrorStatus`）はサーバー側の責務であり、本クライアントは
 * 再現しない。
 */
function weekPlanEndpoint(weekStartDate: IsoDate): string {
  return `/api/menu-plans/${weekStartDate}`;
}

/**
 * `GET /api/menu-plans/:weekStartDate` の型付きクライアント（design.md: API Contract）。
 * 対象週の有効な週間献立プランが未生成の場合は `Result.ok: true, value: null` として
 * 判別可能な形で伝わる（例外は投げない）。
 */
export function getWeekPlan(weekStartDate: IsoDate): Promise<Result<WeekMenuPlan | null, ApiError>> {
  return apiRequest<WeekMenuPlan | null>(weekPlanEndpoint(weekStartDate), { method: "GET" });
}

/**
 * `POST /api/menu-plans/:weekStartDate/regenerate` の型付きクライアント（design.md:
 * API Contract）。生成に失敗した場合は `Result.ok: false` かつ
 * `error.type === "generation_failed"`（`reason` フィールド付き）として判別可能な形で
 * 伝わる（例外は投げない）。
 */
export function regenerateWeek(weekStartDate: IsoDate): Promise<Result<WeekMenuPlan, ApiError>> {
  return apiRequest<WeekMenuPlan>(`${weekPlanEndpoint(weekStartDate)}/regenerate`, { method: "POST" });
}

/**
 * `POST /api/menu-plans/:weekStartDate/days/:dayIndex/regenerate` の型付きクライアント
 * （design.md: API Contract）。生成に失敗した場合は `error.type === "generation_failed"`、
 * 対象週の有効なプランが存在しない場合は `error.type === "not_found"` として、それぞれ
 * 判別可能な形で伝わる（例外は投げない）。
 */
export function regenerateDay(
  weekStartDate: IsoDate,
  dayIndex: number,
): Promise<Result<DayMenu, ApiError>> {
  return apiRequest<DayMenu>(`${weekPlanEndpoint(weekStartDate)}/days/${dayIndex}/regenerate`, {
    method: "POST",
  });
}

/**
 * `GET /api/menu-plans/:weekStartDate/shopping-list` の型付きクライアント（design.md:
 * API Contract）。対象週の週間献立プランが未生成の場合は `Result.ok: true, value: null` として
 * 判別可能な形で伝わる（例外は投げない）。
 */
export function getShoppingList(weekStartDate: IsoDate): Promise<Result<ShoppingList | null, ApiError>> {
  return apiRequest<ShoppingList | null>(`${weekPlanEndpoint(weekStartDate)}/shopping-list`, {
    method: "GET",
  });
}
