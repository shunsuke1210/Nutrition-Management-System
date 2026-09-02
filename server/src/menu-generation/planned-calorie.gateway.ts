/**
 * PlannedCalorieGateway（`user-profile` の `DailyLogService.setPlannedCalories(date, plannedKcal)`
 * への狭いアクセスポート）。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #PlannedCalorieGateway セクション、
 * Requirements 11.2, 11.4）に定義された通り、`user-profile` の
 * `DailyLogService.setPlannedCalories(date, plannedKcal)` をプロセス内で呼び出す（HTTP経由の
 * 自己呼び出しは行わない）薄いアダプタである。
 *
 * - `DailyLogService.setPlannedCalories` の実シグネチャは
 *   `(date, plannedKcal) => Result<DailyLogEntry, ValidationError>` であり、成功時は更新後の
 *   `DailyLogEntry` を返す。しかし design.md の `PlannedCalorieGateway.submitPlannedCalories` は
 *   `Result<void, PlannedCalorieSubmissionError>` を返す契約であるため、成功時は返された
 *   `DailyLogEntry` を意図的に discard し `value: undefined` を返す（呼び出し元
 *   `MenuPlanService` は送信の成否のみを必要とし、`DailyLogEntry` 自体を必要としないため）。
 * - `DailyLogService.setPlannedCalories` がドキュメント化された `ValidationError` の
 *   Result失敗を返した場合、それを本spec固有の `PlannedCalorieSubmissionError` へ変換する。
 *   `ValidationError.fieldErrors`（`Record<string, string[]>`）はフィールド名ごとの
 *   メッセージ配列を持つため、`message` は `"field: msg1, msg2"` の形式で各フィールドを
 *   summarizeし、`"; "` で連結した単一の読みやすい文字列に要約する（フィールド名自体も
 *   含めることで、どの入力値が問題だったかを呼び出し元のログから追跡できるようにする）。
 * - Requirement 11.4「送信が失敗しても献立生成処理全体を失敗として扱わない」という意図を
 *   守るため、`dailyLogService.setPlannedCalories` の呼び出し全体を `try`/`catch` で
 *   防御的に包む。`setPlannedCalories` はドキュメント上バリデーション失敗を例外ではなく
 *   `Result` の失敗値として返す契約だが、DB層の障害など契約外の想定外の例外が発生した
 *   場合にも、本Gatewayの外へ例外を一切伝播させず、同じ
 *   `{ok:false, error:{type:"planned_calorie_submission_failed", ...}}` 形状へ変換する。
 *   これにより、どのような失敗の経路であっても `submitPlannedCalories` の呼び出し元
 *   （`MenuPlanService`、後続task）は例外送出を気にせず `Result` の分岐のみで処理できる。
 */
import type { IsoDate } from "@nutrition/shared";
import type { Result, ValidationError } from "../shared/result.js";
import type { DailyLogService } from "../daily-log/daily-log.service.js";

/** design.md #PlannedCalorieGateway Service Interface。 */
export interface PlannedCalorieSubmissionError {
  type: "planned_calorie_submission_failed";
  message: string;
}

/** design.md #PlannedCalorieGateway Service Interface。 */
export interface PlannedCalorieGateway {
  submitPlannedCalories(date: IsoDate, plannedKcal: number): Result<void, PlannedCalorieSubmissionError>;
}

/**
 * `ValidationError.fieldErrors`（`Record<string, string[]>`）を、フィールド名を含む単一の
 * 読みやすい文字列へ要約する（ファイル冒頭コメント「メッセージ組み立て方針」参照）。
 */
function summarizeFieldErrors(fieldErrors: Record<string, string[]>): string {
  return Object.entries(fieldErrors)
    .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
    .join("; ");
}

/** `ValidationError` の Result失敗を `PlannedCalorieSubmissionError` へ変換する。 */
function toSubmissionError(
  date: IsoDate,
  plannedKcal: number,
  validationError: ValidationError
): PlannedCalorieSubmissionError {
  return {
    type: "planned_calorie_submission_failed",
    message:
      `DailyLogService.setPlannedCalories rejected date=${date}, plannedKcal=${plannedKcal}: ` +
      summarizeFieldErrors(validationError.fieldErrors),
  };
}

/** 想定外の例外（DB層の障害等）を `PlannedCalorieSubmissionError` へ変換する。 */
function toSubmissionErrorFromException(
  date: IsoDate,
  plannedKcal: number,
  caught: unknown
): PlannedCalorieSubmissionError {
  const message = caught instanceof Error ? caught.message : String(caught);
  return {
    type: "planned_calorie_submission_failed",
    message:
      `DailyLogService.setPlannedCalories threw an unexpected exception for date=${date}, ` +
      `plannedKcal=${plannedKcal}: ${message}`,
  };
}

/**
 * `dailyLogService`（`user-profile` が構築・注入する `DailyLogService` インスタンス）に依存する
 * `PlannedCalorieGateway` を生成する。
 *
 * `createProfileGateway` / `createNutritionGateway` と同じDIファクトリ関数パターンに揃えている。
 * 本Gatewayは `DailyLogService` の構築（＝`DailyLogRepository`/DB接続の配線）を一切行わない。
 */
export function createPlannedCalorieGateway(dailyLogService: DailyLogService): PlannedCalorieGateway {
  function submitPlannedCalories(
    date: IsoDate,
    plannedKcal: number
  ): Result<void, PlannedCalorieSubmissionError> {
    try {
      const result = dailyLogService.setPlannedCalories(date, plannedKcal);
      if (!result.ok) {
        return { ok: false, error: toSubmissionError(date, plannedKcal, result.error) };
      }
      // 成功時に返される DailyLogEntry は本Gatewayの契約（Result<void, ...>）上
      // 意図的に discard する（ファイル冒頭コメント参照）。
      return { ok: true, value: undefined };
    } catch (caught) {
      // Requirement 11.4: setPlannedCalories がドキュメント外の想定外の例外を投げた場合も、
      // 献立生成処理全体を巻き込まないよう、ここで捕捉しResultの失敗値へ変換する。
      return { ok: false, error: toSubmissionErrorFromException(date, plannedKcal, caught) };
    }
  }

  return { submitPlannedCalories };
}
