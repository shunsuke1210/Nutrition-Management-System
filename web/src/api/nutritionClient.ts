import type { DietInsights, IsoDate, NutritionSummary } from "@nutrition/shared";
import { apiRequest } from "./httpClient.js";
import type { ApiError, Result } from "./types.js";

/**
 * `/api/nutrition/summary` と `/api/nutrition/diet-insights` 用の型付きfetchクライアント
 * （design.md: File Structure Plan `web/src/api/nutritionClient.ts`）。`profileClient.ts`
 * （task 1.5）と同じパターン（`httpClient.ts` の `apiRequest<T>` をそのまま用いる薄い
 * ラッパー）に従う。
 *
 * 両エンドポイントとも `date`（`IsoDate`, "YYYY-MM-DD"）をクエリパラメータで受け取り、
 * 算出不可の場合はサーバーが409 + `CalculationUnavailableError`（`reason` フィールドで
 * 理由を判別可能）を直接返す（`nutrition.routes.ts`: `throw` ではなく
 * `reply.status(409).send(result.error)`）。`apiRequest`（task 2.1 の一環で `httpClient.ts` /
 * `types.ts` を拡張済み）がこの409応答を `type: "unknown"` に丸め込まず
 * `ApiError`（`CalculationUnavailableError` を含む判別共用体）として判別可能な形で
 * `Result.error` に伝えるため、本ファイルはそのまま `apiRequest` の戻り値を返すのみで
 * 例外処理は行わない。
 */
const NUTRITION_SUMMARY_ENDPOINT = "/api/nutrition/summary";
const NUTRITION_DIET_INSIGHTS_ENDPOINT = "/api/nutrition/diet-insights";

/**
 * `GET /api/nutrition/summary` の型付きクライアント（design.md: API Contract）。
 * 算出不可の場合（プロフィール未登録等）は `Result.ok: false` かつ
 * `error.type === "calculation_unavailable"` として判別可能な形で伝わる（例外は投げない）。
 */
export function getSummary(date: IsoDate): Promise<Result<NutritionSummary, ApiError>> {
  return apiRequest<NutritionSummary>(`${NUTRITION_SUMMARY_ENDPOINT}?date=${date}`, { method: "GET" });
}

/**
 * `GET /api/nutrition/diet-insights` の型付きクライアント（design.md: API Contract）。
 * 算出不可の場合（`profile_missing` / `diet_mode_disabled` / `incomplete_diet_mode_data` 等の
 * `reason`）は `Result.ok: false` かつ `error.type === "calculation_unavailable"` として
 * 判別可能な形で伝わる（例外は投げない）。
 */
export function getDietInsights(date: IsoDate): Promise<Result<DietInsights, ApiError>> {
  return apiRequest<DietInsights>(`${NUTRITION_DIET_INSIGHTS_ENDPOINT}?date=${date}`, { method: "GET" });
}
