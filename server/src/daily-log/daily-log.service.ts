import {
  DailyLogInputSchema,
  ExerciseEntryInputSchema,
  type DailyLogEntry,
  type DailyLogInput,
  type ExerciseEntryInput,
  type ExerciseLogEntry,
  type IsoDate,
} from "@nutrition/shared";
import type { NotFoundError, Result, ValidationError } from "../shared/result.js";
import type { DailyLogRepository } from "./daily-log.repository.js";

/**
 * 日次ログ集約（体重・体脂肪率・摂取カロリー実績・追加運動記録）の検証・ハイブリッド
 * 解決・範囲取得を持つサービス
 * （design.md: Domain: Daily Log > DailyLogService > Service Interface）。
 */
export interface DailyLogService {
  getLog(date: IsoDate): DailyLogEntry | null;
  getLogsInRange(from: IsoDate, to: IsoDate): DailyLogEntry[];
  upsertLog(date: IsoDate, input: DailyLogInput): Result<DailyLogEntry, ValidationError>;
  setPlannedCalories(date: IsoDate, plannedKcal: number): Result<DailyLogEntry, ValidationError>;
  addExerciseEntry(
    date: IsoDate,
    input: ExerciseEntryInput
  ): Result<ExerciseLogEntry, ValidationError>;
  removeExerciseEntry(date: IsoDate, entryId: number): Result<void, NotFoundError>;
}

/**
 * Zod の `issues` が持つ最小限の形状。`zod` パッケージの型を直接 import せずに
 * 構造的型付けで受け取ることで、`server` パッケージに `zod` への直接依存を追加しない
 * （`zod` は `shared` パッケージが公開するスキーマを通じてのみ利用する。
 * `profile.service.ts` の同名ヘルパーと同じ方針だが、モジュール境界を守るためこの
 * ファイル内に独立して定義する）。
 */
interface ZodIssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * Zod の検証エラーを design.md の `ValidationError.fieldErrors`
 * （`Record<string, string[]>`）形状へ変換する。
 */
function toValidationError(issues: readonly ZodIssueLike[]): ValidationError {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    const messages = fieldErrors[key] ?? (fieldErrors[key] = []);
    messages.push(issue.message);
  }

  return { type: "validation", fieldErrors };
}

/** 単一フィールドの `ValidationError` を組み立てる（`plannedKcal` 専用入力のため）。 */
function singleFieldValidationError(field: string, message: string): ValidationError {
  return { type: "validation", fieldErrors: { [field]: [message] } };
}

/**
 * `dailyLogRepository` に依存する `DailyLogService` を生成する。
 *
 * - `upsertLog` / `addExerciseEntry` は `shared` パッケージの `DailyLogInputSchema` /
 *   `ExerciseEntryInputSchema`（Zod）で入力を検証してから Repository を呼び出す
 *   （design.md: Preconditions「`input` は ...Schema を満たす」）。Repository の
 *   `upsertCore` / `addExerciseEntry` 自体は検証を行わないため、不正な入力を拒否する
 *   のは本Serviceの責務（Requirement 8.5, 9.4, 10.5）。
 * - `setPlannedCalories` は `plannedKcal` 単体（非負の数値）を受け取り、
 *   `dailyLogRepository.upsertPlannedKcal` にのみ委譲する。`upsertCore` は一切呼ばず、
 *   `manualOverrideKcal` を含むペイロードを組み立てることもない。これにより
 *   `upsertPlannedKcal` が `manual_override_kcal` 列に触れない（task 3.1 で確認済み）
 *   という Repository の保証がそのまま活き、既存の手動上書き値が計画kcal受信で
 *   自動的に置き換わらないことを保証する（Requirement 9.3）。
 * - `calorieIntakeActual` / `calorieIntakeSource` の導出は Repository 層
 *   （`deriveCalorieFields`）が単一の責務として担っており、本Serviceはその結果を
 *   そのまま透過する（design.md Implementation Notes 3.1 参照）。
 */
export function createDailyLogService(dailyLogRepository: DailyLogRepository): DailyLogService {
  function getLog(date: IsoDate): DailyLogEntry | null {
    return dailyLogRepository.findByDate(date);
  }

  function getLogsInRange(from: IsoDate, to: IsoDate): DailyLogEntry[] {
    return dailyLogRepository.findInRange(from, to);
  }

  function upsertLog(
    date: IsoDate,
    input: DailyLogInput
  ): Result<DailyLogEntry, ValidationError> {
    const parsed = DailyLogInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: toValidationError(parsed.error.issues) };
    }

    const entry = dailyLogRepository.upsertCore(date, parsed.data);
    return { ok: true, value: entry };
  }

  function setPlannedCalories(
    date: IsoDate,
    plannedKcal: number
  ): Result<DailyLogEntry, ValidationError> {
    if (typeof plannedKcal !== "number" || !Number.isFinite(plannedKcal) || plannedKcal < 0) {
      return {
        ok: false,
        error: singleFieldValidationError(
          "plannedKcal",
          "plannedKcal must be a non-negative number"
        ),
      };
    }

    // upsertCore には触れない: upsertPlannedKcal のみを呼び出すことで、Repository の
    // manual_override_kcal 非改変契約（Requirement 9.3）を保つ。
    const entry = dailyLogRepository.upsertPlannedKcal(date, plannedKcal);
    return { ok: true, value: entry };
  }

  function addExerciseEntry(
    date: IsoDate,
    input: ExerciseEntryInput
  ): Result<ExerciseLogEntry, ValidationError> {
    const parsed = ExerciseEntryInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: toValidationError(parsed.error.issues) };
    }

    const entry = dailyLogRepository.addExerciseEntry(date, parsed.data);
    return { ok: true, value: entry };
  }

  function removeExerciseEntry(date: IsoDate, entryId: number): Result<void, NotFoundError> {
    const removed = dailyLogRepository.removeExerciseEntry(date, entryId);
    if (!removed) {
      return {
        ok: false,
        error: {
          type: "not_found",
          message: `Exercise entry ${entryId} not found for date ${date}`,
        },
      };
    }
    return { ok: true, value: undefined };
  }

  return {
    getLog,
    getLogsInRange,
    upsertLog,
    setPlannedCalories,
    addExerciseEntry,
    removeExerciseEntry,
  };
}
