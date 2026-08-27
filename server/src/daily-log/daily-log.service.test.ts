import { describe, expect, it } from "vitest";
import type {
  DailyLogEntry,
  DailyLogInput,
  ExerciseEntryInput,
  ExerciseLogEntry,
  IsoDate,
} from "@nutrition/shared";
import type { DailyLogRepository } from "./daily-log.repository.js";
import { createDailyLogService } from "./daily-log.service.js";

/**
 * `DailyLogService` の単体テスト（design.md: Testing Strategy > Unit Tests）。
 *
 * `DailyLogRepository` はフェイク（インメモリ）で代替する。ただし `upsertPlannedKcal` /
 * `upsertCore` の相互作用（Req 9.3 のハイブリッド解決保護）を意味のある形で検証するため、
 * フェイクは task 3.1 の実装（`daily-log.repository.ts`）と同じ
 * `manualOverrideKcal ?? plannedKcal ?? null` の導出ロジックを内部状態に対して適用する。
 * これにより「呼び出しをスパイした」だけでなく「実際に手動上書き値が保持される」ことを
 * 確認できる。
 */

type FakeRow = {
  weightKg: number | null;
  bodyFatPct: number | null;
  plannedKcal: number | null;
  manualOverrideKcal: number | null;
  exerciseEntries: ExerciseLogEntry[];
};

function deriveCalorieFields(
  plannedKcal: number | null,
  manualOverrideKcal: number | null
): Pick<DailyLogEntry, "calorieIntakeActual" | "calorieIntakeSource"> {
  if (manualOverrideKcal !== null) {
    return { calorieIntakeActual: manualOverrideKcal, calorieIntakeSource: "manual" };
  }
  if (plannedKcal !== null) {
    return { calorieIntakeActual: plannedKcal, calorieIntakeSource: "planned" };
  }
  return { calorieIntakeActual: null, calorieIntakeSource: "unrecorded" };
}

interface FakeDailyLogRepository {
  repository: DailyLogRepository;
  upsertCoreCalls: Array<{ date: IsoDate; fields: DailyLogInput }>;
  upsertPlannedKcalCalls: Array<{ date: IsoDate; plannedKcal: number }>;
  addExerciseEntryCalls: Array<{ date: IsoDate; entry: ExerciseEntryInput }>;
}

function createFakeDailyLogRepository(): FakeDailyLogRepository {
  const rows = new Map<IsoDate, FakeRow>();
  let nextId = 1;

  const upsertCoreCalls: Array<{ date: IsoDate; fields: DailyLogInput }> = [];
  const upsertPlannedKcalCalls: Array<{ date: IsoDate; plannedKcal: number }> = [];
  const addExerciseEntryCalls: Array<{ date: IsoDate; entry: ExerciseEntryInput }> = [];

  function ensure(date: IsoDate): FakeRow {
    let row = rows.get(date);
    if (!row) {
      row = {
        weightKg: null,
        bodyFatPct: null,
        plannedKcal: null,
        manualOverrideKcal: null,
        exerciseEntries: [],
      };
      rows.set(date, row);
    }
    return row;
  }

  function toEntry(date: IsoDate): DailyLogEntry {
    const row = ensure(date);
    const derived = deriveCalorieFields(row.plannedKcal, row.manualOverrideKcal);
    return {
      date,
      weightKg: row.weightKg,
      bodyFatPct: row.bodyFatPct,
      plannedKcal: row.plannedKcal,
      manualOverrideKcal: row.manualOverrideKcal,
      ...derived,
      exerciseEntries: row.exerciseEntries,
    };
  }

  const repository: DailyLogRepository = {
    findByDate: (date) => (rows.has(date) ? toEntry(date) : null),
    findInRange: (from, to) =>
      [...rows.keys()]
        .filter((date) => date >= from && date <= to)
        .sort()
        .map((date) => toEntry(date)),
    upsertCore: (date, fields) => {
      upsertCoreCalls.push({ date, fields });
      const row = ensure(date);
      if (Object.prototype.hasOwnProperty.call(fields, "weightKg") && fields.weightKg !== undefined) {
        row.weightKg = fields.weightKg;
      }
      if (
        Object.prototype.hasOwnProperty.call(fields, "bodyFatPct") &&
        fields.bodyFatPct !== undefined
      ) {
        row.bodyFatPct = fields.bodyFatPct;
      }
      if (
        Object.prototype.hasOwnProperty.call(fields, "manualOverrideKcal") &&
        fields.manualOverrideKcal !== undefined
      ) {
        row.manualOverrideKcal = fields.manualOverrideKcal;
      }
      return toEntry(date);
    },
    upsertPlannedKcal: (date, plannedKcal) => {
      upsertPlannedKcalCalls.push({ date, plannedKcal });
      const row = ensure(date);
      row.plannedKcal = plannedKcal;
      return toEntry(date);
    },
    addExerciseEntry: (date, entry) => {
      addExerciseEntryCalls.push({ date, entry });
      const row = ensure(date);
      const logEntry: ExerciseLogEntry = { id: nextId++, ...entry };
      row.exerciseEntries.push(logEntry);
      return logEntry;
    },
    removeExerciseEntry: (date, entryId) => {
      const row = rows.get(date);
      if (!row) {
        return false;
      }
      const index = row.exerciseEntries.findIndex((e) => e.id === entryId);
      if (index === -1) {
        return false;
      }
      row.exerciseEntries.splice(index, 1);
      return true;
    },
  };

  return { repository, upsertCoreCalls, upsertPlannedKcalCalls, addExerciseEntryCalls };
}

describe("DailyLogService", () => {
  describe("getLog", () => {
    it("returns null when the repository has no record for the date", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      expect(service.getLog("2026-08-01")).toBeNull();
    });

    it("delegates to dailyLogRepository.findByDate() and returns its value unchanged", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);
      service.upsertLog("2026-08-01", { weightKg: 65 });

      const result = service.getLog("2026-08-01");

      expect(result).toEqual(repository.findByDate("2026-08-01"));
      expect(result?.weightKg).toBe(65);
    });
  });

  describe("getLogsInRange", () => {
    it("returns an empty array when the repository has no records in range (Req 11.2)", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      expect(service.getLogsInRange("2026-08-01", "2026-08-31")).toEqual([]);
    });

    it("delegates to dailyLogRepository.findInRange() and returns entries in ascending date order (Req 11.4)", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);
      service.upsertLog("2026-08-03", { weightKg: 63 });
      service.upsertLog("2026-08-01", { weightKg: 65 });

      const result = service.getLogsInRange("2026-08-01", "2026-08-03");

      expect(result.map((entry) => entry.date)).toEqual(["2026-08-01", "2026-08-03"]);
    });
  });

  describe("upsertLog - weight range validation (Req 8.2, 8.5)", () => {
    it("rejects weightKg <= 0", () => {
      const { repository, upsertCoreCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.upsertLog("2026-08-01", { weightKg: 0 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
        expect(result.error.fieldErrors.weightKg?.length).toBeGreaterThan(0);
      }
      expect(upsertCoreCalls).toHaveLength(0);
    });

    it("rejects a negative weightKg", () => {
      const { repository, upsertCoreCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.upsertLog("2026-08-01", { weightKg: -1 });

      expect(result.ok).toBe(false);
      expect(upsertCoreCalls).toHaveLength(0);
    });
  });

  describe("upsertLog - bodyFatPct range validation (Req 8.5)", () => {
    it("rejects bodyFatPct below 0", () => {
      const { repository, upsertCoreCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.upsertLog("2026-08-01", { bodyFatPct: -1 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.bodyFatPct?.length).toBeGreaterThan(0);
      }
      expect(upsertCoreCalls).toHaveLength(0);
    });

    it("rejects bodyFatPct above 100", () => {
      const { repository, upsertCoreCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.upsertLog("2026-08-01", { bodyFatPct: 100.5 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.bodyFatPct?.length).toBeGreaterThan(0);
      }
      expect(upsertCoreCalls).toHaveLength(0);
    });
  });

  describe("upsertLog - manualOverrideKcal validation (Req 9.4)", () => {
    it("rejects a negative manualOverrideKcal", () => {
      const { repository, upsertCoreCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.upsertLog("2026-08-01", { manualOverrideKcal: -1 });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.manualOverrideKcal?.length).toBeGreaterThan(0);
      }
      expect(upsertCoreCalls).toHaveLength(0);
    });
  });

  describe("upsertLog - success path (Req 8.3, 8.4, 9.2)", () => {
    it("accepts valid input, calls repository.upsertCore with it, and returns the repository's result", () => {
      const { repository, upsertCoreCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.upsertLog("2026-08-01", { weightKg: 65, bodyFatPct: 20 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(repository.findByDate("2026-08-01"));
        expect(result.value.weightKg).toBe(65);
        expect(result.value.bodyFatPct).toBe(20);
      }
      expect(upsertCoreCalls).toHaveLength(1);
      expect(upsertCoreCalls[0]?.date).toBe("2026-08-01");
    });

    it("overwrites an existing record on re-record for the same date with the latest value (Req 8.4)", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      service.upsertLog("2026-08-01", { weightKg: 65 });
      const second = service.upsertLog("2026-08-01", { weightKg: 64.5 });

      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.weightKg).toBe(64.5);
      }
      expect(service.getLog("2026-08-01")?.weightKg).toBe(64.5);
    });

    it("manually overriding calorie intake resolves calorieIntakeActual/calorieIntakeSource to manual (Req 9.2)", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.upsertLog("2026-08-01", { manualOverrideKcal: 1800 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.calorieIntakeActual).toBe(1800);
        expect(result.value.calorieIntakeSource).toBe("manual");
      }
    });
  });

  describe("calorie intake resolution order - planned and unrecorded cases (Req 9.1, 9.5)", () => {
    it("resolves calorieIntakeActual/calorieIntakeSource to the planned value when no manual override exists (Req 9.1)", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.setPlannedCalories("2026-08-01", 2000);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.calorieIntakeActual).toBe(2000);
        expect(result.value.calorieIntakeSource).toBe("planned");
      }
    });

    it("resolves calorieIntakeActual to null and calorieIntakeSource to 'unrecorded' when neither a manual override nor a planned value exists (Req 9.5)", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.upsertLog("2026-08-01", { weightKg: 65 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.calorieIntakeActual).toBeNull();
        expect(result.value.calorieIntakeSource).toBe("unrecorded");
      }
    });
  });

  describe("setPlannedCalories - validation", () => {
    it("rejects a negative plannedKcal", () => {
      const { repository, upsertPlannedKcalCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.setPlannedCalories("2026-08-01", -1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("validation");
        expect(result.error.fieldErrors.plannedKcal?.length).toBeGreaterThan(0);
      }
      expect(upsertPlannedKcalCalls).toHaveLength(0);
    });
  });

  describe("setPlannedCalories - primary completion condition: manual override survives (Req 9.1, 9.3)", () => {
    it("calls ONLY repository.upsertPlannedKcal (never upsertCore) when setting planned calories", () => {
      const { repository, upsertCoreCalls, upsertPlannedKcalCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      service.setPlannedCalories("2026-08-01", 2000);

      expect(upsertPlannedKcalCalls).toHaveLength(1);
      expect(upsertPlannedKcalCalls[0]).toEqual({ date: "2026-08-01", plannedKcal: 2000 });
      expect(upsertCoreCalls).toHaveLength(0);
    });

    it("does not replace a previously-saved manual override, and getLog still reflects the manual override afterwards", () => {
      const { repository, upsertCoreCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      service.upsertLog("2026-08-01", { manualOverrideKcal: 1800 });
      upsertCoreCalls.length = 0; // reset call log after the setup upsert, isolating the assertion below

      const result = service.setPlannedCalories("2026-08-01", 2200);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.manualOverrideKcal).toBe(1800);
        expect(result.value.plannedKcal).toBe(2200);
        expect(result.value.calorieIntakeActual).toBe(1800);
        expect(result.value.calorieIntakeSource).toBe("manual");
      }
      // setPlannedCalories itself must not have gone through upsertCore
      expect(upsertCoreCalls).toHaveLength(0);

      const afterward = service.getLog("2026-08-01");
      expect(afterward?.calorieIntakeActual).toBe(1800);
      expect(afterward?.calorieIntakeSource).toBe("manual");
    });
  });

  describe("addExerciseEntry - positivity validation (Req 10.2, 10.5)", () => {
    it("rejects durationMinutes <= 0", () => {
      const { repository, addExerciseEntryCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.addExerciseEntry("2026-08-01", {
        activityName: "ジョギング",
        durationMinutes: 0,
        estimatedCaloriesBurned: 100,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.durationMinutes?.length).toBeGreaterThan(0);
      }
      expect(addExerciseEntryCalls).toHaveLength(0);
    });

    it("rejects estimatedCaloriesBurned <= 0", () => {
      const { repository, addExerciseEntryCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.addExerciseEntry("2026-08-01", {
        activityName: "ジョギング",
        durationMinutes: 30,
        estimatedCaloriesBurned: -10,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fieldErrors.estimatedCaloriesBurned?.length).toBeGreaterThan(0);
      }
      expect(addExerciseEntryCalls).toHaveLength(0);
    });

    it("accepts valid input, calls repository.addExerciseEntry, and returns the created entry (Req 10.3)", () => {
      const { repository, addExerciseEntryCalls } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.addExerciseEntry("2026-08-01", {
        activityName: "ジョギング",
        durationMinutes: 30,
        estimatedCaloriesBurned: 250,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.activityName).toBe("ジョギング");
        expect(result.value.id).toBeTypeOf("number");
      }
      expect(addExerciseEntryCalls).toHaveLength(1);

      const found = service.getLog("2026-08-01");
      expect(found?.exerciseEntries).toHaveLength(1);
    });
  });

  describe("removeExerciseEntry (Req 10.4)", () => {
    it("returns ok:false with a NotFoundError when the repository reports no deletion", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);

      const result = service.removeExerciseEntry("2026-08-01", 9999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("not_found");
      }
    });

    it("returns ok:true and removes the entry from the log when the repository reports a deletion", () => {
      const { repository } = createFakeDailyLogRepository();
      const service = createDailyLogService(repository);
      const added = service.addExerciseEntry("2026-08-01", {
        activityName: "ジョギング",
        durationMinutes: 30,
        estimatedCaloriesBurned: 250,
      });
      const entryId = added.ok ? added.value.id : -1;

      const result = service.removeExerciseEntry("2026-08-01", entryId);

      expect(result.ok).toBe(true);
      expect(service.getLog("2026-08-01")?.exerciseEntries).toHaveLength(0);
    });
  });
});
