/**
 * DailyLogGateway（`user-profile` の `DailyLogService` への狭いアクセスポート）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `DailyLogGateway` セクション
 * （Requirements 4.1, 4.2, 4.3）に定義された通り、`user-profile` の
 * `DailyLogService.getLog(date)` をプロセス内で呼び出し（HTTP経由の自己呼び出しは行わない）、
 * 指定日付の追加運動記録（`ExerciseLogEntry[]`）のみを抽出して返す薄いアダプタである。
 *
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
 * - `getWeightLogsInRange`（`getLogsInRange` を用いた体重ログの日付範囲取得）は本タスク（2.8）
 *   のスコープ外であり、task 6.4 で本ファイルに追加される。
 * - `user-profile` の内部実装（`DailyLogRepository` 等）には依存せず、公開された
 *   `DailyLogService` インターフェースのみに依存する。
 */
import type { ExerciseLogEntry, IsoDate } from "@nutrition/shared";
import type { DailyLogService } from "../daily-log/daily-log.service.js";

/**
 * design.md #DailyLogGateway Service Interface。
 *
 * 本タスク（2.8）では `getExerciseEntriesForDate` のみを実装する。`getWeightLogsInRange`
 * は task 6.4 で本インターフェースに追加される。
 */
export interface DailyLogGateway {
  getExerciseEntriesForDate(date: IsoDate): ExerciseLogEntry[];
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

  return { getExerciseEntriesForDate };
}
