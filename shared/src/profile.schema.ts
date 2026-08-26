/**
 * プロフィール集約の Zod スキーマ・型定義。
 *
 * design.md の Domain: Profile → ProfileService Service Interface で定義された
 * `ProfileInput` の形状をそのまま Zod スキーマとして表現し、型はスキーマから推論する。
 * 条件付き必須項目（食事制限の強度、ダイエットモード有効時の目標体重・目標達成期間）は
 * `.superRefine` で検証する。
 */
import { z } from "zod";

// --- 列挙型 (Requirements 1.4, 2.5, 2.6, 2.7, 4.1, 4.2, 4.6, 5.1, 5.2) ---

/** 性別 (Requirement 1.4) */
export const GenderSchema = z.enum(["female", "male", "undisclosed"]);
export type Gender = z.infer<typeof GenderSchema>;

/** 妊娠/授乳の状況 (Requirement 2.5) */
export const PregnancyStatusSchema = z.enum(["none", "pregnant", "lactating"]);
export type PregnancyStatus = z.infer<typeof PregnancyStatusSchema>;

/** お仕事中の活動度 (Requirement 4.1) */
export const JobActivityLevelSchema = z.enum(["mostly_sedentary", "mixed", "mostly_active"]);
export type JobActivityLevel = z.infer<typeof JobActivityLevelSchema>;

/** 通勤手段 (Requirement 4.2) */
export const CommuteMethodSchema = z.enum(["walk_or_bike", "transit", "car"]);
export type CommuteMethod = z.infer<typeof CommuteMethodSchema>;

/** 運動量の場面 (Requirement 4.6) */
export const RoutineSceneSchema = z.enum(["commute", "work", "after_work", "holiday", "other"]);
export type RoutineScene = z.infer<typeof RoutineSceneSchema>;

/** 運動量の強度 (Requirement 4.6) */
export const ExerciseIntensitySchema = z.enum(["light", "moderate", "vigorous"]);
export type ExerciseIntensity = z.infer<typeof ExerciseIntensitySchema>;

/** 食事制限のタイプ (Requirement 5.1) */
export const RestrictionTypeSchema = z.enum([
  "none",
  "low_carb",
  "low_fat",
  "high_protein",
  "calorie_only",
]);
export type RestrictionType = z.infer<typeof RestrictionTypeSchema>;

/** 食事制限の強度 (Requirement 5.2) */
export const RestrictionIntensitySchema = z.enum(["light", "standard", "strict"]);
export type RestrictionIntensity = z.infer<typeof RestrictionIntensitySchema>;

/** 喫煙習慣 (Requirement 2.6) */
export const SmokingHabitSchema = z.enum(["non_smoker", "smoker"]);
export type SmokingHabit = z.infer<typeof SmokingHabitSchema>;

/** 飲酒習慣 (Requirement 2.7) */
export const AlcoholHabitSchema = z.enum(["none", "occasional", "frequent"]);
export type AlcoholHabit = z.infer<typeof AlcoholHabitSchema>;

// --- 運動量テーブルの行 (Requirement 4.6, 4.10) ---

export const ExerciseRoutineEntryInputSchema = z.object({
  scene: RoutineSceneSchema,
  content: z.string(),
  frequencyPerWeek: z.number().positive(), // > 0 (Requirement 4.10)
  durationMinutes: z.number().positive(), // > 0 (Requirement 4.10)
  intensity: ExerciseIntensitySchema,
});
export type ExerciseRoutineEntryInput = z.infer<typeof ExerciseRoutineEntryInputSchema>;

// --- ProfileInput (Requirements 1.1-1.5, 2.1-2.7, 3.1-3.5, 4.1-4.10, 5.1-5.5, 6.1-6.5) ---

const ProfileInputShape = z.object({
  heightCm: z.number().positive(), // > 0, required (Requirement 1.3)
  weightKg: z.number().positive(), // > 0, required (Requirement 1.3)
  age: z.number().positive(), // > 0, required (Requirement 1.3)
  gender: GenderSchema, // required (Requirement 1.4)
  bodyFatPct: z.number().min(0).max(100).nullable(), // 0-100 (Requirement 2.3)
  medicalNotes: z.string().nullable(),
  pregnancyStatus: PregnancyStatusSchema,
  sleepHours: z.number().min(0).nullable(), // >= 0 (Requirement 2.4)
  alcoholHabit: AlcoholHabitSchema.nullable(),
  smokingHabit: SmokingHabitSchema.nullable(),
  cookingSkill: z.string().nullable(),
  cookingTimePreference: z.string().nullable(),
  budgetPreference: z.string().nullable(),
  jobActivityLevel: JobActivityLevelSchema, // required (Requirement 4.1, 4.3)
  commuteMethod: CommuteMethodSchema, // required (Requirement 4.2, 4.3)
  averageDailySteps: z.number().min(0).nullable(), // >= 0 (Requirement 4.5)
  exerciseRoutine: z.array(ExerciseRoutineEntryInputSchema), // Requirement 4.6-4.9
  ngIngredients: z.array(z.string()), // Requirement 3.1, 3.3, 3.4
  preferredIngredients: z.array(z.string()), // Requirement 3.2, 3.3, 3.4
  restrictionType: RestrictionTypeSchema, // Requirement 5.1
  restrictionIntensity: RestrictionIntensitySchema.nullable(), // required unless restrictionType === "none" (Requirement 5.2, 5.3, 5.4)
  restrictionNotes: z.string().nullable(), // Requirement 5.5
  dietModeEnabled: z.boolean(), // Requirement 6.1
  goalWeightKg: z.number().positive().nullable(), // required (> 0) when dietModeEnabled (Requirement 6.2, 6.4)
  goalPeriodWeeks: z.number().positive().nullable(), // required (> 0) when dietModeEnabled (Requirement 6.2, 6.4)
});

export const ProfileInputSchema = ProfileInputShape.superRefine((input, ctx) => {
  // Requirement 5.3, 5.4: 制限タイプが「制限なし」以外のとき強度選択を必須とする
  if (input.restrictionType !== "none" && input.restrictionIntensity === null) {
    ctx.addIssue({
      code: "custom",
      path: ["restrictionIntensity"],
      message: "restrictionType が 'none' 以外の場合、restrictionIntensity は必須です。",
    });
  }

  // Requirement 6.2, 6.4: ダイエットモード有効時は目標体重・目標達成期間を必須とする
  if (input.dietModeEnabled) {
    if (input.goalWeightKg === null || input.goalWeightKg === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["goalWeightKg"],
        message: "dietModeEnabled が true の場合、goalWeightKg は必須です。",
      });
    }
    if (input.goalPeriodWeeks === null || input.goalPeriodWeeks === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["goalPeriodWeeks"],
        message: "dietModeEnabled が true の場合、goalPeriodWeeks は必須です。",
      });
    }
  }
});

export type ProfileInput = z.infer<typeof ProfileInputShape>;

/** 永続化済みプロフィール (design.md: Profile extends ProfileInput) */
export const ProfileSchema = ProfileInputShape.extend({
  createdAt: z.string(), // ISO 8601
  updatedAt: z.string(), // ISO 8601
});
export type Profile = z.infer<typeof ProfileSchema>;
