import type Database from "better-sqlite3";
import type {
  ExerciseIntensity,
  ExerciseRoutineEntryInput,
  RoutineScene,
  Profile,
  ProfileInput,
  AlcoholHabit,
  CommuteMethod,
  Gender,
  JobActivityLevel,
  PregnancyStatus,
  RestrictionIntensity,
  RestrictionType,
  SmokingHabit,
} from "@nutrition/shared";

/**
 * `profiles` / `exercise_routine_entries` / `ng_ingredients` / `preferred_ingredients`
 * の永続化を担うリポジトリ（design.md: Domain: Profile → ProfileRepository）。
 *
 * - `profiles` はシングルトン行（`id = 1`、スキーマの CHECK (id = 1) で保証）として扱う。
 * - 子リスト（運動量テーブル・NG食材・好みの食材）は `upsert` のたびに全件削除してから
 *   入力内容を再挿入する（design.md の State Management に準拠）。
 * - 本体・3つの子テーブルの更新はすべて単一トランザクション内で行い、途中で失敗した場合は
 *   ロールバックされる（design.md: Postconditions「部分更新失敗時はロールバック」）。
 */
export interface ProfileRepository {
  findCurrent(): Profile | null;
  upsert(profile: ProfileInput): Profile;
}

const PROFILE_ID = 1;

type IngredientTable = "ng_ingredients" | "preferred_ingredients";

interface ProfileRow {
  id: number;
  height_cm: number;
  weight_kg: number;
  age: number;
  gender: string;
  body_fat_pct: number | null;
  medical_notes: string | null;
  pregnancy_status: string;
  sleep_hours: number | null;
  alcohol_habit: string | null;
  smoking_habit: string | null;
  cooking_skill: string | null;
  cooking_time_preference: string | null;
  budget_preference: string | null;
  job_activity_level: string;
  commute_method: string;
  average_daily_steps: number | null;
  restriction_type: string;
  restriction_intensity: string | null;
  restriction_notes: string | null;
  diet_mode_enabled: number;
  goal_weight_kg: number | null;
  goal_period_weeks: number | null;
  created_at: string;
  updated_at: string;
}

interface ExerciseRoutineEntryRow {
  scene: string;
  content: string;
  frequency_per_week: number;
  duration_minutes: number;
  intensity: string;
}

interface IngredientNameRow {
  name: string;
}

/**
 * `db`（マイグレーション適用済みの better-sqlite3 コネクション）に対する
 * `ProfileRepository` を生成する。
 */
export function createProfileRepository(db: Database.Database): ProfileRepository {
  function readExerciseRoutine(): ExerciseRoutineEntryInput[] {
    const rows = db
      .prepare(
        `SELECT scene, content, frequency_per_week, duration_minutes, intensity
         FROM exercise_routine_entries
         WHERE profile_id = ?
         ORDER BY sort_order ASC, id ASC`
      )
      .all(PROFILE_ID) as ExerciseRoutineEntryRow[];

    return rows.map((row) => ({
      scene: row.scene as RoutineScene,
      content: row.content,
      frequencyPerWeek: row.frequency_per_week,
      durationMinutes: row.duration_minutes,
      intensity: row.intensity as ExerciseIntensity,
    }));
  }

  function readIngredientNames(table: IngredientTable): string[] {
    const rows = db
      .prepare(`SELECT name FROM ${table} WHERE profile_id = ? ORDER BY id ASC`)
      .all(PROFILE_ID) as IngredientNameRow[];
    return rows.map((row) => row.name);
  }

  function mapRowToProfile(row: ProfileRow): Profile {
    return {
      heightCm: row.height_cm,
      weightKg: row.weight_kg,
      age: row.age,
      gender: row.gender as Gender,
      bodyFatPct: row.body_fat_pct,
      medicalNotes: row.medical_notes,
      pregnancyStatus: row.pregnancy_status as PregnancyStatus,
      sleepHours: row.sleep_hours,
      alcoholHabit: row.alcohol_habit as AlcoholHabit | null,
      smokingHabit: row.smoking_habit as SmokingHabit | null,
      cookingSkill: row.cooking_skill,
      cookingTimePreference: row.cooking_time_preference,
      budgetPreference: row.budget_preference,
      jobActivityLevel: row.job_activity_level as JobActivityLevel,
      commuteMethod: row.commute_method as CommuteMethod,
      averageDailySteps: row.average_daily_steps,
      exerciseRoutine: readExerciseRoutine(),
      ngIngredients: readIngredientNames("ng_ingredients"),
      preferredIngredients: readIngredientNames("preferred_ingredients"),
      restrictionType: row.restriction_type as RestrictionType,
      restrictionIntensity: row.restriction_intensity as RestrictionIntensity | null,
      restrictionNotes: row.restriction_notes,
      dietModeEnabled: row.diet_mode_enabled === 1,
      goalWeightKg: row.goal_weight_kg,
      goalPeriodWeeks: row.goal_period_weeks,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function findCurrent(): Profile | null {
    const row = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(PROFILE_ID) as
      | ProfileRow
      | undefined;
    if (!row) {
      return null;
    }
    return mapRowToProfile(row);
  }

  function replaceExerciseRoutine(entries: readonly ExerciseRoutineEntryInput[]): void {
    db.prepare(`DELETE FROM exercise_routine_entries WHERE profile_id = ?`).run(PROFILE_ID);

    const insert = db.prepare(
      `INSERT INTO exercise_routine_entries
         (profile_id, scene, content, frequency_per_week, duration_minutes, intensity, sort_order)
       VALUES (@profileId, @scene, @content, @frequencyPerWeek, @durationMinutes, @intensity, @sortOrder)`
    );

    entries.forEach((entry, index) => {
      insert.run({
        profileId: PROFILE_ID,
        scene: entry.scene,
        content: entry.content,
        frequencyPerWeek: entry.frequencyPerWeek,
        durationMinutes: entry.durationMinutes,
        intensity: entry.intensity,
        sortOrder: index,
      });
    });
  }

  function replaceIngredientList(table: IngredientTable, names: readonly string[]): void {
    db.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(PROFILE_ID);

    const insert = db.prepare(`INSERT INTO ${table} (profile_id, name) VALUES (?, ?)`);
    for (const name of names) {
      insert.run(PROFILE_ID, name);
    }
  }

  const runUpsert = db.transaction((input: ProfileInput) => {
    const now = new Date().toISOString();

    // id = 1 固定のシングルトン行を UPSERT する。ON CONFLICT の SET句には created_at を
    // 含めないため、既存行がある場合は最初の挿入時の created_at がそのまま保持される
    // （design.md: 「既存プロフィールを更新するか、存在しなければ新規作成する」）。
    db.prepare(
      `INSERT INTO profiles (
         id, height_cm, weight_kg, age, gender, body_fat_pct, medical_notes,
         pregnancy_status, sleep_hours, alcohol_habit, smoking_habit,
         cooking_skill, cooking_time_preference, budget_preference,
         job_activity_level, commute_method, average_daily_steps,
         restriction_type, restriction_intensity, restriction_notes,
         diet_mode_enabled, goal_weight_kg, goal_period_weeks,
         created_at, updated_at
       ) VALUES (
         @id, @heightCm, @weightKg, @age, @gender, @bodyFatPct, @medicalNotes,
         @pregnancyStatus, @sleepHours, @alcoholHabit, @smokingHabit,
         @cookingSkill, @cookingTimePreference, @budgetPreference,
         @jobActivityLevel, @commuteMethod, @averageDailySteps,
         @restrictionType, @restrictionIntensity, @restrictionNotes,
         @dietModeEnabled, @goalWeightKg, @goalPeriodWeeks,
         @createdAt, @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         height_cm = excluded.height_cm,
         weight_kg = excluded.weight_kg,
         age = excluded.age,
         gender = excluded.gender,
         body_fat_pct = excluded.body_fat_pct,
         medical_notes = excluded.medical_notes,
         pregnancy_status = excluded.pregnancy_status,
         sleep_hours = excluded.sleep_hours,
         alcohol_habit = excluded.alcohol_habit,
         smoking_habit = excluded.smoking_habit,
         cooking_skill = excluded.cooking_skill,
         cooking_time_preference = excluded.cooking_time_preference,
         budget_preference = excluded.budget_preference,
         job_activity_level = excluded.job_activity_level,
         commute_method = excluded.commute_method,
         average_daily_steps = excluded.average_daily_steps,
         restriction_type = excluded.restriction_type,
         restriction_intensity = excluded.restriction_intensity,
         restriction_notes = excluded.restriction_notes,
         diet_mode_enabled = excluded.diet_mode_enabled,
         goal_weight_kg = excluded.goal_weight_kg,
         goal_period_weeks = excluded.goal_period_weeks,
         updated_at = excluded.updated_at`
    ).run({
      id: PROFILE_ID,
      heightCm: input.heightCm,
      weightKg: input.weightKg,
      age: input.age,
      gender: input.gender,
      bodyFatPct: input.bodyFatPct,
      medicalNotes: input.medicalNotes,
      pregnancyStatus: input.pregnancyStatus,
      sleepHours: input.sleepHours,
      alcoholHabit: input.alcoholHabit,
      smokingHabit: input.smokingHabit,
      cookingSkill: input.cookingSkill,
      cookingTimePreference: input.cookingTimePreference,
      budgetPreference: input.budgetPreference,
      jobActivityLevel: input.jobActivityLevel,
      commuteMethod: input.commuteMethod,
      averageDailySteps: input.averageDailySteps,
      restrictionType: input.restrictionType,
      restrictionIntensity: input.restrictionIntensity,
      restrictionNotes: input.restrictionNotes,
      dietModeEnabled: input.dietModeEnabled ? 1 : 0,
      goalWeightKg: input.goalWeightKg,
      goalPeriodWeeks: input.goalPeriodWeeks,
      createdAt: now,
      updatedAt: now,
    });

    // 子リストは全件削除してから入力内容を再挿入する（design.md: State Management）。
    replaceExerciseRoutine(input.exerciseRoutine);
    replaceIngredientList("ng_ingredients", input.ngIngredients);
    replaceIngredientList("preferred_ingredients", input.preferredIngredients);
  });

  function upsert(profile: ProfileInput): Profile {
    runUpsert(profile);

    const result = findCurrent();
    if (!result) {
      // upsert 直後に findCurrent() が null を返すのはトランザクションの不整合を意味する
      // 到達不能なはずの状態であり、呼び出し元に不正確な結果を返さないよう例外にする。
      throw new Error("ProfileRepository.upsert: failed to read back the persisted profile");
    }
    return result;
  }

  return { findCurrent, upsert };
}
