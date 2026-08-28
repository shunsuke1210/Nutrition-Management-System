import { describe, expect, it } from "vitest";
import type { DailyLogEntry, ExerciseLogEntry } from "@nutrition/shared";
import type { DailyLogService } from "../daily-log/daily-log.service.js";
import { createDailyLogGateway } from "./daily-log.gateway.js";

/**
 * design.md #DailyLogGateway (Requirements 4.1, 4.2, 4.3, 14.1)
 *
 * `DailyLogGateway.getExerciseEntriesForDate` は `user-profile` の
 * `DailyLogService.getLog(date)` をプロセス内で呼び出し、指定日付の `ExerciseLogEntry[]` のみを
 * 抽出して返す薄いアダプタである。
 *
 * `DailyLogGateway.getWeightLogsInRange` は `user-profile` の
 * `DailyLogService.getLogsInRange(from, to)` をプロセス内で呼び出し、`date` / `weightKg` のみを
 * `WeightLogPoint[]` に射影して返す薄いアダプタである（task 6.4）。
 *
 * `DailyLogService` 自体の正しさ（`getLog` / `getLogsInRange` の実装、日付昇順の保証）は
 * `user-profile` spec の `daily-log.service.test.ts` / `daily-log.repository.test.ts` で
 * 既に検証済みのため、本テストは `DailyLogGateway` 自身のロジック（抽出・射影とnull分岐、
 * 引数の受け渡し）のみをフェイクの `DailyLogService` を用いて検証する。
 */

/** `DailyLogGateway` の唯一の依存を差し替えるための、挙動を固定したフェイク。 */
function createFakeDailyLogService(
  getLogImpl: (date: string) => DailyLogEntry | null,
  getLogsInRangeImpl?: (from: string, to: string) => DailyLogEntry[]
): DailyLogService {
  return {
    getLog: getLogImpl,
    getLogsInRange:
      getLogsInRangeImpl ??
      (() => {
        throw new Error(
          "createFakeDailyLogService: getLogsInRange is not used by this test (pass getLogsInRangeImpl to createFakeDailyLogService if needed)"
        );
      }),
    upsertLog: () => {
      throw new Error("createFakeDailyLogService: upsertLog is not used by DailyLogGateway tests");
    },
    setPlannedCalories: () => {
      throw new Error(
        "createFakeDailyLogService: setPlannedCalories is not used by DailyLogGateway tests"
      );
    },
    addExerciseEntry: () => {
      throw new Error(
        "createFakeDailyLogService: addExerciseEntry is not used by DailyLogGateway tests"
      );
    },
    removeExerciseEntry: () => {
      throw new Error(
        "createFakeDailyLogService: removeExerciseEntry is not used by DailyLogGateway tests"
      );
    },
  };
}

function buildExerciseLogEntry(overrides: Partial<ExerciseLogEntry> = {}): ExerciseLogEntry {
  return {
    id: 1,
    activityName: "ランニング",
    durationMinutes: 30,
    estimatedCaloriesBurned: 250,
    ...overrides,
  };
}

/**
 * `exerciseEntries` 以外の全フィールド（`weightKg` / `calorieIntakeActual` 等）を持つ、
 * 完全な `DailyLogEntry` を構築する。`DailyLogGateway` がそれらを漏らさないことを
 * 検証するための土台とする。
 */
function buildDailyLogEntry(overrides: Partial<DailyLogEntry> = {}): DailyLogEntry {
  return {
    date: "2026-08-20",
    weightKg: 65,
    bodyFatPct: 18,
    plannedKcal: 2000,
    manualOverrideKcal: null,
    calorieIntakeActual: 2000,
    calorieIntakeSource: "planned",
    exerciseEntries: [],
    ...overrides,
  };
}

describe("createDailyLogGateway", () => {
  describe("対象日付にログが存在しない場合（Requirement 4.2 が前提とする空配列の返却）", () => {
    it("getExerciseEntriesForDate は空配列を返す", () => {
      const dailyLogService = createFakeDailyLogService(() => null);
      const gateway = createDailyLogGateway(dailyLogService);

      expect(gateway.getExerciseEntriesForDate("2026-08-20")).toEqual([]);
    });
  });

  describe("対象日付にログが存在し、追加運動記録が2件以上ある場合（Requirement 4.1）", () => {
    it("登録済みの追加運動記録一覧をそのまま返す", () => {
      const entries = [
        buildExerciseLogEntry({
          id: 1,
          activityName: "ランニング",
          durationMinutes: 30,
          estimatedCaloriesBurned: 250,
        }),
        buildExerciseLogEntry({
          id: 2,
          activityName: "筋トレ",
          durationMinutes: 45,
          estimatedCaloriesBurned: 180,
        }),
      ];
      const log = buildDailyLogEntry({
        exerciseEntries: entries,
        weightKg: 70,
        calorieIntakeActual: 1800,
      });
      const dailyLogService = createFakeDailyLogService(() => log);
      const gateway = createDailyLogGateway(dailyLogService);

      const result = gateway.getExerciseEntriesForDate("2026-08-20");

      expect(result).toEqual(entries);
    });

    it("weightKg/calorieIntakeActual等、ExerciseLogEntryが持たないフィールドを一切含まない（真の射影であることの証明）", () => {
      const entries = [
        buildExerciseLogEntry({ id: 1 }),
        buildExerciseLogEntry({ id: 2, activityName: "サイクリング" }),
      ];
      const log = buildDailyLogEntry({ exerciseEntries: entries });
      const dailyLogService = createFakeDailyLogService(() => log);
      const gateway = createDailyLogGateway(dailyLogService);

      const result = gateway.getExerciseEntriesForDate("2026-08-20");

      for (const entry of result) {
        expect(Object.keys(entry).sort()).toEqual(
          ["activityName", "durationMinutes", "estimatedCaloriesBurned", "id"].sort()
        );
      }
    });
  });

  describe("対象日付にログは存在するが追加運動記録が0件の場合（体重のみ記録され運動はなかった日）", () => {
    it("getExerciseEntriesForDate は空配列を返す", () => {
      const log = buildDailyLogEntry({ weightKg: 68, exerciseEntries: [] });
      const dailyLogService = createFakeDailyLogService(() => log);
      const gateway = createDailyLogGateway(dailyLogService);

      expect(gateway.getExerciseEntriesForDate("2026-08-20")).toEqual([]);
    });
  });

  describe("日付の受け渡し（Requirement 4.3: 指定日付以外のログを含めない）", () => {
    it("getExerciseEntriesForDate に渡した日付がそのまま dailyLogService.getLog に転送される", () => {
      const receivedDates: string[] = [];
      const logsByDate: Record<string, DailyLogEntry> = {
        "2026-08-01": buildDailyLogEntry({
          date: "2026-08-01",
          exerciseEntries: [buildExerciseLogEntry({ id: 10, activityName: "8/1の運動" })],
        }),
        "2026-08-15": buildDailyLogEntry({
          date: "2026-08-15",
          exerciseEntries: [buildExerciseLogEntry({ id: 20, activityName: "8/15の運動" })],
        }),
      };
      const dailyLogService = createFakeDailyLogService((date) => {
        receivedDates.push(date);
        return logsByDate[date] ?? null;
      });
      const gateway = createDailyLogGateway(dailyLogService);

      const result1 = gateway.getExerciseEntriesForDate("2026-08-01");
      const result2 = gateway.getExerciseEntriesForDate("2026-08-15");

      expect(receivedDates).toEqual(["2026-08-01", "2026-08-15"]);
      expect(result1).toEqual([logsByDate["2026-08-01"]!.exerciseEntries[0]]);
      expect(result2).toEqual([logsByDate["2026-08-15"]!.exerciseEntries[0]]);
      expect(result1[0]?.activityName).toBe("8/1の運動");
      expect(result2[0]?.activityName).toBe("8/15の運動");
    });
  });

  describe("getWeightLogsInRange（Requirement 14.1）", () => {
    /** `getWeightLogsInRange` は `getLog` を一切呼び出さないため、呼ばれたら失敗させる。 */
    function unusedGetLog(): DailyLogEntry | null {
      throw new Error("getWeightLogsInRange should not call dailyLogService.getLog");
    }

    it(
      "体重記録がある日付・ログ行はあるが体重未記録(null)の日付を含め、" +
        "ログ行自体が存在しない日付は結果から除外して、date/weightKgのみのWeightLogPoint[]を返す",
      () => {
        // 2026-08-02 は getLogsInRange の返り値に含まれない
        // （＝ログ行自体が存在しない）ことを模している。プレースホルダーが
        // 合成されて結果に混入しないことを、結果配列の要素数と内容の両方で検証する。
        const logsInRange: DailyLogEntry[] = [
          buildDailyLogEntry({ date: "2026-08-01", weightKg: 65 }),
          buildDailyLogEntry({ date: "2026-08-03", weightKg: null, exerciseEntries: [] }),
          buildDailyLogEntry({ date: "2026-08-04", weightKg: 64.5 }),
        ];
        const dailyLogService = createFakeDailyLogService(unusedGetLog, () => logsInRange);
        const gateway = createDailyLogGateway(dailyLogService);

        const result = gateway.getWeightLogsInRange("2026-08-01", "2026-08-04");

        expect(result).toEqual([
          { date: "2026-08-01", weightKg: 65 },
          { date: "2026-08-03", weightKg: null },
          { date: "2026-08-04", weightKg: 64.5 },
        ]);
      }
    );

    it("bodyFatPct/calorieIntakeActual/exerciseEntries等、WeightLogPointが持たないフィールドを一切含まない（真の射影であることの証明）", () => {
      const logsInRange: DailyLogEntry[] = [
        buildDailyLogEntry({
          date: "2026-08-01",
          weightKg: 65,
          bodyFatPct: 18,
          calorieIntakeActual: 2000,
          exerciseEntries: [buildExerciseLogEntry()],
        }),
      ];
      const dailyLogService = createFakeDailyLogService(unusedGetLog, () => logsInRange);
      const gateway = createDailyLogGateway(dailyLogService);

      const result = gateway.getWeightLogsInRange("2026-08-01", "2026-08-01");

      expect(result).toHaveLength(1);
      for (const point of result) {
        expect(Object.keys(point).sort()).toEqual(["date", "weightKg"].sort());
      }
    });

    it("dailyLogServiceが返した日付昇順の並びをそのまま保持する（並び替えを独自に行わない）", () => {
      const logsInRange: DailyLogEntry[] = [
        buildDailyLogEntry({ date: "2026-07-01", weightKg: 70 }),
        buildDailyLogEntry({ date: "2026-07-15", weightKg: 68 }),
        buildDailyLogEntry({ date: "2026-07-30", weightKg: 66 }),
      ];
      const dailyLogService = createFakeDailyLogService(unusedGetLog, () => logsInRange);
      const gateway = createDailyLogGateway(dailyLogService);

      const result = gateway.getWeightLogsInRange("2026-07-01", "2026-07-31");

      expect(result.map((point) => point.date)).toEqual(["2026-07-01", "2026-07-15", "2026-07-30"]);
    });

    it("from/toに渡した日付がそのまま dailyLogService.getLogsInRange に転送される", () => {
      const receivedRanges: Array<{ from: string; to: string }> = [];
      const dailyLogService = createFakeDailyLogService(unusedGetLog, (from, to) => {
        receivedRanges.push({ from, to });
        return [];
      });
      const gateway = createDailyLogGateway(dailyLogService);

      gateway.getWeightLogsInRange("2026-08-01", "2026-08-31");

      expect(receivedRanges).toEqual([{ from: "2026-08-01", to: "2026-08-31" }]);
    });

    it("該当するログ行が1件もない範囲を指定した場合は空配列を返す", () => {
      const dailyLogService = createFakeDailyLogService(unusedGetLog, () => []);
      const gateway = createDailyLogGateway(dailyLogService);

      expect(gateway.getWeightLogsInRange("2026-01-01", "2026-01-31")).toEqual([]);
    });
  });
});
