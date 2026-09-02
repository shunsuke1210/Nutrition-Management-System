import { describe, expect, it, vi } from "vitest";
import type { DailyLogEntry, IsoDate } from "@nutrition/shared";
import type { Result, ValidationError } from "../shared/result.js";
import type { DailyLogService } from "../daily-log/daily-log.service.js";
import { createPlannedCalorieGateway } from "./planned-calorie.gateway.js";

/**
 * design.md #PlannedCalorieGateway (Requirements 11.2, 11.4)
 *
 * `PlannedCalorieGateway` は `user-profile` の `DailyLogService.setPlannedCalories(date, plannedKcal)`
 * をプロセス内で呼び出す薄いアダプタである。`DailyLogService.setPlannedCalories` は成功時に
 * `DailyLogEntry` を返すが、本Gatewayの `submitPlannedCalories` は `Result<void, ...>` を返す
 * ため、成功時は返された `DailyLogEntry` を discard する。
 *
 * `DailyLogService.setPlannedCalories` は通常のバリデーション失敗を `Result` の失敗値として
 * 返す（例外を投げない）ドキュメント化された契約を持つが、Requirement 11.4「送信が失敗しても
 * 処理全体は失敗としない」という意図を守るため、本Gatewayは想定外の例外（DB層の障害など）が
 * 発生した場合にも例外を伝播させず `Result` の失敗値へ変換する防御的な実装が要求される。
 * よって本テストは (a) ドキュメント化された `ValidationError` の Result失敗パスと、
 * (b) フェイクの `DailyLogService` が実際に例外をスローするパスの両方を検証する。
 *
 * `DailyLogService` 自体の正しさ（`setPlannedCalories` の実装）は `user-profile` の
 * `daily-log.service.test.ts` で既に検証済みのため、本テストはフェイクの `DailyLogService` を
 * 用いて `PlannedCalorieGateway` 自身のロジック（discard・エラー変換・例外捕捉・委譲）のみを
 * 検証する（`profile.gateway.test.ts` / `nutrition.gateway.test.ts` と同じ方針）。
 */

const TEST_DATE: IsoDate = "2026-01-08";
const TEST_PLANNED_KCAL = 2100;

/** `setPlannedCalories` 成功時に返される、完全な `DailyLogEntry` フィクスチャ。 */
function buildDailyLogEntry(overrides: Partial<DailyLogEntry> = {}): DailyLogEntry {
  return {
    date: TEST_DATE,
    weightKg: 65,
    bodyFatPct: 18,
    plannedKcal: TEST_PLANNED_KCAL,
    manualOverrideKcal: null,
    calorieIntakeActual: TEST_PLANNED_KCAL,
    calorieIntakeSource: "planned",
    exerciseEntries: [],
    ...overrides,
  };
}

/** `setPlannedCalories` 失敗時に返される、`fieldErrors` に複数フィールドを含む `ValidationError`。 */
function buildValidationError(): ValidationError {
  return {
    type: "validation",
    fieldErrors: {
      plannedKcal: ["plannedKcal must be a non-negative number"],
      date: ["date must be a valid ISO date"],
    },
  };
}

/** `PlannedCalorieGateway` の唯一の依存を差し替えるための、挙動を固定したフェイク。 */
function createFakeDailyLogService(
  setPlannedCaloriesResult: Result<DailyLogEntry, ValidationError>
): DailyLogService {
  return {
    getLog: () => {
      throw new Error("createFakeDailyLogService: getLog is not used by PlannedCalorieGateway tests");
    },
    getLogsInRange: () => {
      throw new Error(
        "createFakeDailyLogService: getLogsInRange is not used by PlannedCalorieGateway tests"
      );
    },
    upsertLog: () => {
      throw new Error("createFakeDailyLogService: upsertLog is not used by PlannedCalorieGateway tests");
    },
    setPlannedCalories: () => setPlannedCaloriesResult,
    addExerciseEntry: () => {
      throw new Error(
        "createFakeDailyLogService: addExerciseEntry is not used by PlannedCalorieGateway tests"
      );
    },
    removeExerciseEntry: () => {
      throw new Error(
        "createFakeDailyLogService: removeExerciseEntry is not used by PlannedCalorieGateway tests"
      );
    },
  };
}

/** `setPlannedCalories` が想定外の例外をスローするフェイク（(b) 防御的try/catchの検証用）。 */
function createThrowingFakeDailyLogService(): DailyLogService {
  return {
    getLog: () => {
      throw new Error("createThrowingFakeDailyLogService: getLog is not used");
    },
    getLogsInRange: () => {
      throw new Error("createThrowingFakeDailyLogService: getLogsInRange is not used");
    },
    upsertLog: () => {
      throw new Error("createThrowingFakeDailyLogService: upsertLog is not used");
    },
    setPlannedCalories: () => {
      throw new Error("unexpected db failure");
    },
    addExerciseEntry: () => {
      throw new Error("createThrowingFakeDailyLogService: addExerciseEntry is not used");
    },
    removeExerciseEntry: () => {
      throw new Error("createThrowingFakeDailyLogService: removeExerciseEntry is not used");
    },
  };
}

describe("createPlannedCalorieGateway", () => {
  describe("setPlannedCaloriesが成功する場合（Requirement 11.2）", () => {
    it("Result<void, ...>のok:trueを返し、返されたDailyLogEntryをvalueに含めない（discardする）", () => {
      const entry = buildDailyLogEntry();
      const dailyLogService = createFakeDailyLogService({ ok: true, value: entry });
      const gateway = createPlannedCalorieGateway(dailyLogService);

      const result = gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);

      expect(result).toEqual({ ok: true, value: undefined });
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
    });
  });

  describe("setPlannedCaloriesがValidationErrorのResult失敗を返す場合（Requirement 11.4）", () => {
    it("PlannedCalorieSubmissionErrorへ変換し、ValidationErrorの情報を含む有意なmessageを持つ", () => {
      const validationError = buildValidationError();
      const dailyLogService = createFakeDailyLogService({ ok: false, error: validationError });
      const gateway = createPlannedCalorieGateway(dailyLogService);

      const result = gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected ok:false");
      }
      expect(result.error.type).toBe("planned_calorie_submission_failed");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
      // fieldErrorsの各フィールドのメッセージが要約に含まれていることを確認する
      // （メッセージ組み立て方針の具体的な検証、CONCERNS参照）。
      expect(result.error.message).toContain("plannedKcal must be a non-negative number");
      expect(result.error.message).toContain("date must be a valid ISO date");
    });

    it("元のValidationErrorオブジェクト自体はerrorに含まれない（PlannedCalorieSubmissionErrorの形状のみ）", () => {
      const validationError = buildValidationError();
      const dailyLogService = createFakeDailyLogService({ ok: false, error: validationError });
      const gateway = createPlannedCalorieGateway(dailyLogService);

      const result = gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected ok:false");
      }
      expect(Object.keys(result.error).sort()).toEqual(["message", "type"]);
      expect(result.error).not.toHaveProperty("fieldErrors");
    });
  });

  describe("setPlannedCaloriesが想定外の例外をスローする場合（Requirement 11.4、防御的try/catch）", () => {
    it("例外を捕捉し、submitPlannedCaloriesからは例外を伝播させずResultの失敗値を返す", () => {
      const dailyLogService = createThrowingFakeDailyLogService();
      const gateway = createPlannedCalorieGateway(dailyLogService);

      // ここで try/catch を使わず直接呼び出す。Gatewayが例外を捕捉していなければ、
      // このテスト自体が「クリーンなアサーション失敗」ではなく「捕捉されない例外」で
      // 失敗する（タスクの完了条件そのものを検証する呼び出し方）。
      const result = gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected ok:false");
      }
      expect(result.error.type).toBe("planned_calorie_submission_failed");
      expect(typeof result.error.message).toBe("string");
      expect(result.error.message.length).toBeGreaterThan(0);
      expect(result.error.message).toContain("unexpected db failure");
    });
  });

  describe("呼び出しの委譲", () => {
    it("setPlannedCaloriesへdate/plannedKcalをそのまま透過する（変換なし）", () => {
      const entry = buildDailyLogEntry();
      const setPlannedCalories = vi.fn().mockReturnValue({ ok: true, value: entry });
      const dailyLogService: DailyLogService = {
        getLog: () => {
          throw new Error("not used");
        },
        getLogsInRange: () => {
          throw new Error("not used");
        },
        upsertLog: () => {
          throw new Error("not used");
        },
        setPlannedCalories,
        addExerciseEntry: () => {
          throw new Error("not used");
        },
        removeExerciseEntry: () => {
          throw new Error("not used");
        },
      };
      const gateway = createPlannedCalorieGateway(dailyLogService);

      gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);

      expect(setPlannedCalories).toHaveBeenCalledWith(TEST_DATE, TEST_PLANNED_KCAL);
      expect(setPlannedCalories).toHaveBeenCalledTimes(1);
    });
  });

  describe("決定性", () => {
    it("同一の入力・同一のフェイク設定で2回呼び出すと、成功時は同一の結果を返す", () => {
      const entry = buildDailyLogEntry();
      const dailyLogService = createFakeDailyLogService({ ok: true, value: entry });
      const gateway = createPlannedCalorieGateway(dailyLogService);

      const first = gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);
      const second = gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);

      expect(first).toEqual(second);
    });

    it("同一の入力・同一のフェイク設定で2回呼び出すと、失敗時も同一の結果を返す", () => {
      const validationError = buildValidationError();
      const dailyLogService = createFakeDailyLogService({ ok: false, error: validationError });
      const gateway = createPlannedCalorieGateway(dailyLogService);

      const first = gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);
      const second = gateway.submitPlannedCalories(TEST_DATE, TEST_PLANNED_KCAL);

      expect(first).toEqual(second);
    });
  });
});
