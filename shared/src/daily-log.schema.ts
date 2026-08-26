/**
 * 日次ログ集約の Zod スキーマ・型定義。
 *
 * design.md の Domain: Daily Log → DailyLogService Service Interface で定義された
 * `DailyLogInput` / `ExerciseEntryInput` の形状をそのまま Zod スキーマとして表現し、
 * 型はスキーマから推論する。
 */
import { z } from "zod";

export type IsoDate = string; // "YYYY-MM-DD"

/** 摂取カロリー実績の解決元 (design.md: DailyLogEntry.calorieIntakeSource) */
export const CalorieIntakeSourceSchema = z.enum(["manual", "planned", "unrecorded"]);
export type CalorieIntakeSource = z.infer<typeof CalorieIntakeSourceSchema>;

/**
 * 日次ログの部分更新入力。
 * 体重・体脂肪率・摂取カロリー手動上書きのうち、指定されたフィールドのみを更新する
 * （design.md: upsertLog は未指定フィールドは既存値を保持する）。
 */
export const DailyLogInputSchema = z.object({
  weightKg: z.number().positive().optional(), // > 0 (Requirement 8.5)
  bodyFatPct: z.number().min(0).max(100).nullable().optional(), // 0-100 (Requirement 8.5)
  manualOverrideKcal: z.number().min(0).nullable().optional(), // >= 0, null clears the override (Requirement 9.4)
});
export type DailyLogInput = z.infer<typeof DailyLogInputSchema>;

/** 追加運動記録の入力 (Requirement 10.2, 10.5) */
export const ExerciseEntryInputSchema = z.object({
  activityName: z.string().min(1),
  durationMinutes: z.number().positive(), // > 0 (Requirement 10.5)
  estimatedCaloriesBurned: z.number().positive(), // > 0 (Requirement 10.5)
});
export type ExerciseEntryInput = z.infer<typeof ExerciseEntryInputSchema>;

/** 永続化済みの追加運動記録 (design.md: ExerciseLogEntry extends ExerciseEntryInput) */
export const ExerciseLogEntrySchema = ExerciseEntryInputSchema.extend({
  id: z.number(),
});
export type ExerciseLogEntry = z.infer<typeof ExerciseLogEntrySchema>;

/** 日付単位の日次ログエントリ全体 (design.md: DailyLogEntry) */
export const DailyLogEntrySchema = z.object({
  date: z.string(), // IsoDate "YYYY-MM-DD"
  weightKg: z.number().nullable(),
  bodyFatPct: z.number().nullable(),
  plannedKcal: z.number().nullable(),
  manualOverrideKcal: z.number().nullable(),
  // derived: manualOverrideKcal ?? plannedKcal ?? null
  calorieIntakeActual: z.number().nullable(),
  calorieIntakeSource: CalorieIntakeSourceSchema,
  exerciseEntries: z.array(ExerciseLogEntrySchema),
});
export type DailyLogEntry = z.infer<typeof DailyLogEntrySchema>;
