/**
 * DailyLogGateway（`user-profile` の `DailyLogService` への狭いアクセスポート）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `DailyLogGateway` セクション
 * （Requirements 4.1, 4.2, 4.3, 14.1）に定義された通り、`user-profile` の
 * `DailyLogService.getLog(date)` / `getLogsInRange(from, to)` をプロセス内で呼び出し
 * （HTTP経由の自己呼び出しは行わない）、本specが必要とする最小限のフィールドのみを
 * 抽出・射影して返す薄いアダプタである。
 *
 * `getExerciseEntriesForDate`（Requirements 4.1, 4.2, 4.3）:
 * - 対象日付にログが存在しない場合（`DailyLogService.getLog(date)` が `null` を返す場合）は
 *   空配列を返す（design.md #DailyLogGateway「対象日付にログが存在しない場合は空配列を返す」）。
 * - ログが存在する場合は `DailyLogEntry` から `exerciseEntries` のみを抽出して返す。
 *   体重・体脂肪率・摂取カロリー等、本specが使用しないフィールドは呼び出し元に露出しない
 *   （design.md「指定日付の `ExerciseLogEntry[]` のみを返す」）。
 * - `getLog(date)` は指定した単一日付のみを取得するため、本Gatewayは構造上、指定日付以外の
 *   追加運動ログを当日の消費カロリー算出に含めない（4.3）ことを自然に満たす。
 * - Requirement 4.2「追加運動ログが1件も記録されていない場合、TDEEをそのまま当日の消費カロリー
 *   として扱う」という決定は `NutritionService`（task 3）の責務であり、本Gatewayは空配列を
 *   忠実に返すのみでこの決定には関与しない。
 *
 * `getWeightLogsInRange`（Requirement 14.1、task 6.4）:
 * - `DailyLogService.getLogsInRange(from, to)` が返す `DailyLogEntry[]` から `date` /
 *   `weightKg` のみを `WeightLogPoint[]` に射影して返す。体脂肪率・摂取カロリー・運動記録等、
 *   本specが使用しないフィールドは呼び出し元に露出しない（design.md #DailyLogGateway
 *   Responsibilities）。
 * - `getLogsInRange` はログ行が存在しない日付をプレースホルダーなしで結果から単純に除外する
 *   （`daily-log.repository.ts` の `findInRange` 参照）。本Gatewayはその配列をそのまま
 *   射影するだけであり、欠損日付のプレースホルダーを合成しない。
 * - ログ行自体は存在するが `weightKg` が未記録（`null`）の日付は、`weightKg: null` を持つ
 *   `WeightLogPoint` としてそのまま含める（体重以外の項目のみ記録された日を区別する）。
 * - 日付昇順（14.1）は `findInRange` のSQLクエリ（`ORDER BY log_date ASC`）に由来する
 *   `getLogsInRange` 自体の保証であり、本Gatewayは独自の並び替えを行わない（`Array.map`
 *   による要素順を保持したままの射影のため、入力の順序がそのまま出力に反映される）。
 * - `user-profile` の内部実装（`DailyLogRepository` 等）には依存せず、公開された
 *   `DailyLogService` インターフェースのみに依存する。
 */
import type { ExerciseLogEntry, IsoDate } from "@nutrition/shared";
import type { DailyLogService } from "../daily-log/daily-log.service.js";

/**
 * design.md #DailyLogGateway Service Interface。
 *
 * `date` / `weightKg` のみを持つ、体重ログの日付範囲取得結果1件分の射影結果
 * （task 6.3 の `DietInsightsCalculator.calculate` の入力としてそのまま再利用される）。
 */
export interface WeightLogPoint {
  date: IsoDate;
  weightKg: number | null;
}

/** design.md #DailyLogGateway Service Interface。 */
export interface DailyLogGateway {
  getExerciseEntriesForDate(date: IsoDate): ExerciseLogEntry[];
  /** 日付昇順（14.1）。`getLogsInRange` 自体の保証をそのまま継承する。 */
  getWeightLogsInRange(from: IsoDate, to: IsoDate): WeightLogPoint[];
}

/**
 * `dailyLogService`（`user-profile` が構築・注入する `DailyLogService` インスタンス）に依存する
 * `DailyLogGateway` を生成する。
 *
 * `createProfileGateway`（task 2.7, `./profile.gateway.ts`）と同じファクトリ関数パターンに
 * 揃えている。本Gatewayは `DailyLogService` の構築（＝`DailyLogRepository`/DBコネクションの
 * 配線）を一切行わない。それは呼び出し側（`NutritionService` を組み立てる task 3、最終的には
 * `server/src/index.ts` の起動処理）の責務であり、本Gatewayは構築済みの `DailyLogService` を
 * 受け取るだけの狭いポートである。
 */
export function createDailyLogGateway(dailyLogService: DailyLogService): DailyLogGateway {
  function getExerciseEntriesForDate(date: IsoDate): ExerciseLogEntry[] {
    const log = dailyLogService.getLog(date);
    if (log === null) {
      return [];
    }

    return log.exerciseEntries;
  }

  function getWeightLogsInRange(from: IsoDate, to: IsoDate): WeightLogPoint[] {
    const logs = dailyLogService.getLogsInRange(from, to);
    return logs.map((log) => ({ date: log.date, weightKg: log.weightKg }));
  }

  return { getExerciseEntriesForDate, getWeightLogsInRange };
}
