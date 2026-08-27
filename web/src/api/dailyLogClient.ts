import type { DailyLogEntry, DailyLogInput, ExerciseEntryInput, ExerciseLogEntry, IsoDate } from "@nutrition/shared";
import { apiRequest } from "./httpClient.js";
import type { ApiError, Result } from "./types.js";

/**
 * `/api/daily-logs` 用の型付きfetchクライアント（design.md: File Structure Plan
 * `web/src/api/dailyLogClient.ts`）。`profileClient.ts`（task 1.5）と同じパターン
 * （`httpClient.ts` の `apiRequest<T>` をそのまま用いる薄いラッパー）に従う。
 *
 * task 5.3（`DailyLogPanel`）の時点ではこのファイルは未着手だった（design.md の
 * File Structure Plan には記載があるが、これを作るタスクが `tasks.md` に個別に
 * 存在しない）。`DailyLogPanel` が「今日の記録」の読込・各保存操作をAPIに送信する
 * ためには本ファイルが無ければ動作しえないため、`DailyLogPanel`（Boundary:
 * DailyLogPanel）を完成させるために必要な最小限のインフラとして本タスクの範囲内で
 * 作成する。`DailyLogPanel` が実際に呼び出す5エンドポイントのみを実装し、
 * `PUT /api/daily-logs/:date/planned-calories`（menu-generationが送信側を実装する契約、
 * design.md: API Contract の注記）は `DailyLogPanel` の責務外のため含めない。
 */
const DAILY_LOGS_ENDPOINT = "/api/daily-logs";

function dailyLogUrl(date: IsoDate): string {
  return `${DAILY_LOGS_ENDPOINT}/${date}`;
}

function exerciseEntriesUrl(date: IsoDate): string {
  return `${dailyLogUrl(date)}/exercise-entries`;
}

/**
 * `GET /api/daily-logs/:date` の型付きクライアント（design.md: API Contract > Daily Log）。
 * 指定日付のレコードが未作成の場合はサーバーが `null` を返す。
 */
export function getDailyLog(date: IsoDate): Promise<Result<DailyLogEntry | null, ApiError>> {
  return apiRequest<DailyLogEntry | null>(dailyLogUrl(date), { method: "GET" });
}

/**
 * `PUT /api/daily-logs/:date` の型付きクライアント（design.md: API Contract > Daily Log）。
 * `DailyLogInput` に含めなかったフィールドは更新されず、既存値が保持される
 * （design.md: DailyLogService Postconditions — 「upsertLog はレコードが存在しなければ
 * 新規作成し、存在すれば指定フィールドのみ更新する」）。体重/体脂肪率の保存と摂取カロリー
 * 手動上書きの保存はそれぞれ関係するフィールドのみを含めて呼び出すことで、互いに影響を
 * 与えずに独立した保存操作として扱える（`DailyLogPanel` 側の呼び出し規約）。
 */
export function saveDailyLog(date: IsoDate, input: DailyLogInput): Promise<Result<DailyLogEntry, ApiError>> {
  return apiRequest<DailyLogEntry>(dailyLogUrl(date), { method: "PUT", body: input });
}

/**
 * `POST /api/daily-logs/:date/exercise-entries` の型付きクライアント
 * （design.md: API Contract > Daily Log）。
 */
export function addExerciseEntry(
  date: IsoDate,
  input: ExerciseEntryInput,
): Promise<Result<ExerciseLogEntry, ApiError>> {
  return apiRequest<ExerciseLogEntry>(exerciseEntriesUrl(date), { method: "POST", body: input });
}

/**
 * `DELETE /api/daily-logs/:date/exercise-entries/:entryId` の型付きクライアント
 * （design.md: API Contract > Daily Log）。成功時はサーバーが204を返すため、
 * `apiRequest` の204処理（`httpClient.ts`）に従い `value` は `undefined` となる。
 */
export function removeExerciseEntry(date: IsoDate, entryId: number): Promise<Result<void, ApiError>> {
  return apiRequest<void>(`${exerciseEntriesUrl(date)}/${entryId}`, { method: "DELETE" });
}
