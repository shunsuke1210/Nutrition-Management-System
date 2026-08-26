import type Database from "better-sqlite3";
import type {
  CalorieIntakeSource,
  DailyLogEntry,
  DailyLogInput,
  ExerciseEntryInput,
  ExerciseLogEntry,
  IsoDate,
} from "@nutrition/shared";

/**
 * `daily_logs` / `exercise_log_entries` の永続化とクエリを担うリポジトリ
 * （design.md: Domain: Daily Log → DailyLogRepository）。
 *
 * - `daily_logs` は日付（`log_date`）を主キーとする時系列テーブル。指定日付の行が
 *   存在しない場合、いずれの書き込み操作（`upsertCore` / `upsertPlannedKcal` /
 *   `addExerciseEntry`）の前でも自動的に行を作成する（design.md: Responsibilities「書き込み
 *   操作の前に自動作成する」、Requirement 8.1, 9.1, 10.1）。
 * - `calorieIntakeActual` / `calorieIntakeSource` は保存された値ではなく、返却時に
 *   `manualOverrideKcal ?? plannedKcal ?? null` の優先順位から導出する（design.md:
 *   Invariants、Requirement 9.1, 9.3）。この導出は検証や優先順位の業務判断を伴わない
 *   単純な写像であり、`DailyLogEntry` の返却型を誠実に満たすために Repository 層で行う
 *   （優先順位そのものの業務的根拠は Service 層である `DailyLogService` の責務）。
 * - `findInRange` は日付昇順でレコードを返し、記録のない日付は欠損として結果配列から
 *   単純に除外する（プレースホルダー行を合成しない）。これは Requirement 11.2 が
 *   「欠損が他日付の記録に影響を与えない」ことを求めるものであり、欠損日を穴埋めする
 *   ことを求めていない、という design.md の記述に基づく（Requirement 11.2, 11.4）。
 */
export interface DailyLogRepository {
  findByDate(date: IsoDate): DailyLogEntry | null;
  findInRange(from: IsoDate, to: IsoDate): DailyLogEntry[];
  upsertCore(date: IsoDate, fields: DailyLogInput): DailyLogEntry;
  upsertPlannedKcal(date: IsoDate, plannedKcal: number): DailyLogEntry;
  addExerciseEntry(date: IsoDate, entry: ExerciseEntryInput): ExerciseLogEntry;
  removeExerciseEntry(date: IsoDate, entryId: number): boolean;
}

interface DailyLogRow {
  log_date: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  planned_kcal: number | null;
  manual_override_kcal: number | null;
  updated_at: string;
}

interface ExerciseLogEntryRow {
  id: number;
  activity_name: string;
  duration_minutes: number;
  estimated_calories_burned: number;
}

/**
 * `db`（マイグレーション適用済みの better-sqlite3 コネクション）に対する
 * `DailyLogRepository` を生成する。
 */
export function createDailyLogRepository(db: Database.Database): DailyLogRepository {
  /** 指定日付の `daily_logs` 行が存在しない場合のみ、最小限の行を作成する。 */
  function ensureRow(date: IsoDate): void {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO daily_logs (log_date, updated_at)
       VALUES (@date, @now)
       ON CONFLICT(log_date) DO NOTHING`
    ).run({ date, now });
  }

  function readExerciseEntries(date: IsoDate): ExerciseLogEntry[] {
    const rows = db
      .prepare(
        `SELECT id, activity_name, duration_minutes, estimated_calories_burned
         FROM exercise_log_entries
         WHERE log_date = ?
         ORDER BY id ASC`
      )
      .all(date) as ExerciseLogEntryRow[];

    return rows.map((row) => ({
      id: row.id,
      activityName: row.activity_name,
      durationMinutes: row.duration_minutes,
      estimatedCaloriesBurned: row.estimated_calories_burned,
    }));
  }

  /** `manualOverrideKcal ?? plannedKcal ?? null` の優先順位から実績値と解決元を導出する。 */
  function deriveCalorieFields(
    plannedKcal: number | null,
    manualOverrideKcal: number | null
  ): { calorieIntakeActual: number | null; calorieIntakeSource: CalorieIntakeSource } {
    if (manualOverrideKcal !== null) {
      return { calorieIntakeActual: manualOverrideKcal, calorieIntakeSource: "manual" };
    }
    if (plannedKcal !== null) {
      return { calorieIntakeActual: plannedKcal, calorieIntakeSource: "planned" };
    }
    return { calorieIntakeActual: null, calorieIntakeSource: "unrecorded" };
  }

  function mapRowToEntry(row: DailyLogRow): DailyLogEntry {
    const { calorieIntakeActual, calorieIntakeSource } = deriveCalorieFields(
      row.planned_kcal,
      row.manual_override_kcal
    );

    return {
      date: row.log_date,
      weightKg: row.weight_kg,
      bodyFatPct: row.body_fat_pct,
      plannedKcal: row.planned_kcal,
      manualOverrideKcal: row.manual_override_kcal,
      calorieIntakeActual,
      calorieIntakeSource,
      exerciseEntries: readExerciseEntries(row.log_date),
    };
  }

  function findByDate(date: IsoDate): DailyLogEntry | null {
    const row = db.prepare(`SELECT * FROM daily_logs WHERE log_date = ?`).get(date) as
      | DailyLogRow
      | undefined;
    if (!row) {
      return null;
    }
    return mapRowToEntry(row);
  }

  function findInRange(from: IsoDate, to: IsoDate): DailyLogEntry[] {
    const rows = db
      .prepare(
        `SELECT * FROM daily_logs
         WHERE log_date >= @from AND log_date <= @to
         ORDER BY log_date ASC`
      )
      .all({ from, to }) as DailyLogRow[];

    return rows.map(mapRowToEntry);
  }

  const runUpsertCore = db.transaction((date: IsoDate, fields: DailyLogInput) => {
    ensureRow(date);

    const now = new Date().toISOString();
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { date, now };

    // `fields` に「キーが存在しない」（未指定＝既存値を保持）と「キーが存在し値が null」
    // （明示的な解除、特に manualOverrideKcal のクリア用途）を区別するため、
    // 値そのものではなく `hasOwnProperty` でキーの有無を判定する（design.md:
    // DailyLogInput の `manualOverrideKcal?: number | null` コメント「null clears the
    // override」、Requirement 9.3）。
    if (Object.prototype.hasOwnProperty.call(fields, "weightKg") && fields.weightKg !== undefined) {
      setClauses.push("weight_kg = @weightKg");
      params.weightKg = fields.weightKg;
    }
    if (
      Object.prototype.hasOwnProperty.call(fields, "bodyFatPct") &&
      fields.bodyFatPct !== undefined
    ) {
      setClauses.push("body_fat_pct = @bodyFatPct");
      params.bodyFatPct = fields.bodyFatPct;
    }
    if (
      Object.prototype.hasOwnProperty.call(fields, "manualOverrideKcal") &&
      fields.manualOverrideKcal !== undefined
    ) {
      setClauses.push("manual_override_kcal = @manualOverrideKcal");
      params.manualOverrideKcal = fields.manualOverrideKcal;
    }
    setClauses.push("updated_at = @now");

    db.prepare(`UPDATE daily_logs SET ${setClauses.join(", ")} WHERE log_date = @date`).run(
      params
    );
  });

  function upsertCore(date: IsoDate, fields: DailyLogInput): DailyLogEntry {
    runUpsertCore(date, fields);
    return findByDate(date) as DailyLogEntry;
  }

  const runUpsertPlannedKcal = db.transaction((date: IsoDate, plannedKcal: number) => {
    ensureRow(date);
    const now = new Date().toISOString();
    // manual_override_kcal は SET句に含めないため、既存の手動上書き値は変更されない
    // （design.md: Requirement 9.3 の保護機構）。
    db.prepare(
      `UPDATE daily_logs SET planned_kcal = @plannedKcal, updated_at = @now WHERE log_date = @date`
    ).run({ date, plannedKcal, now });
  });

  function upsertPlannedKcal(date: IsoDate, plannedKcal: number): DailyLogEntry {
    runUpsertPlannedKcal(date, plannedKcal);
    return findByDate(date) as DailyLogEntry;
  }

  const runAddExerciseEntry = db.transaction((date: IsoDate, entry: ExerciseEntryInput) => {
    ensureRow(date);
    const result = db
      .prepare(
        `INSERT INTO exercise_log_entries
           (log_date, activity_name, duration_minutes, estimated_calories_burned)
         VALUES (@date, @activityName, @durationMinutes, @estimatedCaloriesBurned)`
      )
      .run({
        date,
        activityName: entry.activityName,
        durationMinutes: entry.durationMinutes,
        estimatedCaloriesBurned: entry.estimatedCaloriesBurned,
      });
    return Number(result.lastInsertRowid);
  });

  function addExerciseEntry(date: IsoDate, entry: ExerciseEntryInput): ExerciseLogEntry {
    const id = runAddExerciseEntry(date, entry);
    return {
      id,
      activityName: entry.activityName,
      durationMinutes: entry.durationMinutes,
      estimatedCaloriesBurned: entry.estimatedCaloriesBurned,
    };
  }

  function removeExerciseEntry(date: IsoDate, entryId: number): boolean {
    const result = db
      .prepare(`DELETE FROM exercise_log_entries WHERE id = @entryId AND log_date = @date`)
      .run({ entryId, date });
    return result.changes > 0;
  }

  return {
    findByDate,
    findInRange,
    upsertCore,
    upsertPlannedKcal,
    addExerciseEntry,
    removeExerciseEntry,
  };
}
