/**
 * 栄養計算エンジン（nutrition-engine）の Zod スキーマ・型定義。
 *
 * design.md の Components and Interfaces に記載された各 Service Interface ブロック
 * （NutritionService, PfcCalculator, MicronutrientCalculator, GuardrailEvaluator）の
 * 型形状をそのまま Zod スキーマとして表現し、型はスキーマから推論する。
 *
 * 性別・仕事中の活動度・通勤手段・運動強度・食事制限タイプ/強度等の列挙型は、本ファイルが
 * 定義する型の中では使用しない（NutritionSummary / PfcRatio / PfcTargets /
 * MicronutrientTargets / GuardrailResult / CalculationUnavailableError のいずれも、
 * design.md の Service Interface 上でこれらの列挙型をフィールドとして含まない。
 * `BmrInput` / `ActivityCoefficientInput` 等、これらの列挙型をフィールドに含む型は
 * 後続タスクで追加される計算モジュールの入力型であり、本タスクの対象外）。
 * 該当する型が本ファイルに追加される際は、`shared/src/profile.schema.ts` が既に
 * 定義する `GenderSchema` / `JobActivityLevelSchema` / `CommuteMethodSchema` /
 * `RestrictionTypeSchema` / `RestrictionIntensitySchema` / `SmokingHabitSchema` /
 * `AlcoholHabitSchema` を再利用し、重複定義しないこと。
 */
import { z } from "zod";

// --- 日付形式 (design.md: IsoDate = "YYYY-MM-DD") ---

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" 形式の日付文字列 */
const IsoDateStringSchema = z
  .string()
  .regex(ISO_DATE_REGEX, "日付は YYYY-MM-DD 形式で指定してください。");

// --- PfcCalculator Service Interface (Requirements 5.2, 7.*, 9.2) ---

/** PFC比率 (design.md PfcCalculator: PfcRatio, 3値の合計は1) */
export const PfcRatioSchema = z.object({
  proteinPct: z.number().min(0).max(1),
  fatPct: z.number().min(0).max(1),
  carbPct: z.number().min(0).max(1),
});
export type PfcRatio = z.infer<typeof PfcRatioSchema>;

/**
 * PFC目標量 (design.md PfcCalculator: PfcTargets)
 * グラム単位・カロリー比率の両形式で提供する (Requirement 5.2, 9.2)。
 * dietMode.pfc は逆算された目標カロリーに基づくため、ガードレール抵触時（要件10.3）は
 * 算出値をそのまま返す設計上、極端な入力では理論上非正の値になり得る。そのため本スキーマは
 * 値域を制約せず、数値型であることのみを検証する。
 */
export const PfcTargetsSchema = z.object({
  proteinG: z.number(),
  fatG: z.number(),
  carbG: z.number(),
  proteinKcal: z.number(),
  fatKcal: z.number(),
  carbKcal: z.number(),
});
export type PfcTargets = z.infer<typeof PfcTargetsSchema>;

// --- MicronutrientCalculator Service Interface (Requirement 6.1) ---

/**
 * 微量栄養素目標値 (design.md MicronutrientCalculator: MicronutrientTargets)
 * 性別×年齢区分の静的参照テーブルに基づく値であり、常に非負である (Requirement 6.1, 6.2)。
 */
export const MicronutrientTargetsSchema = z.object({
  vitaminAUg: z.number().nonnegative(), // µg RAE
  vitaminDUg: z.number().nonnegative(), // µg
  vitaminB1Mg: z.number().nonnegative(), // mg
  vitaminB2Mg: z.number().nonnegative(), // mg
  vitaminCMg: z.number().nonnegative(), // mg
  calciumMg: z.number().nonnegative(), // mg
  ironMg: z.number().nonnegative(), // mg
  fiberG: z.number().nonnegative(), // g
  saltEquivalentUpperLimitG: z.number().nonnegative(), // g（上限目安）
});
export type MicronutrientTargets = z.infer<typeof MicronutrientTargetsSchema>;

// --- GuardrailEvaluator Service Interface (Requirements 10.*, 11.1) ---

/** 修正提案の種別 (design.md GuardrailEvaluator: GuardrailSuggestionKind) */
export const GuardrailSuggestionKindSchema = z.enum(["extend_period", "ease_goal_weight"]);
export type GuardrailSuggestionKind = z.infer<typeof GuardrailSuggestionKindSchema>;

/** 修正提案 (design.md GuardrailEvaluator: GuardrailSuggestion) */
export const GuardrailSuggestionSchema = z.object({
  kind: GuardrailSuggestionKindSchema,
  suggestedGoalPeriodWeeks: z.number().positive().optional(),
  suggestedGoalWeightKg: z.number().positive().optional(),
});
export type GuardrailSuggestion = z.infer<typeof GuardrailSuggestionSchema>;

/** ガードレール警告の種別 (design.md GuardrailEvaluator: GuardrailWarningType) */
export const GuardrailWarningTypeSchema = z.enum(["min_calorie_floor", "max_weekly_loss_pace"]);
export type GuardrailWarningType = z.infer<typeof GuardrailWarningTypeSchema>;

/**
 * ガードレール警告 (design.md GuardrailEvaluator: GuardrailWarning)
 * suggestions は常に1件以上を含む (design.md コメント参照, Requirement 10.2, 11.2)。
 */
export const GuardrailWarningSchema = z.object({
  type: GuardrailWarningTypeSchema,
  message: z.string(),
  suggestions: z.array(GuardrailSuggestionSchema).min(1),
});
export type GuardrailWarning = z.infer<typeof GuardrailWarningSchema>;

/**
 * ガードレール判定結果 (design.md GuardrailEvaluator: GuardrailResult)
 * 抵触なしの場合は空配列 (Requirement 11.1 で保持する基準に抵触しない場合)。
 */
export const GuardrailResultSchema = z.object({
  warnings: z.array(GuardrailWarningSchema),
});
export type GuardrailResult = z.infer<typeof GuardrailResultSchema>;

// --- NutritionService Service Interface / Error Envelope (Requirements 12.1, 12.2, 14.2) ---

/** 算出不可の理由 (design.md Error Envelope: CalculationUnavailableReason) */
export const CalculationUnavailableReasonSchema = z.enum([
  "profile_missing",
  "incomplete_exercise_data",
  "incomplete_diet_mode_data",
  "diet_mode_disabled",
]);
export type CalculationUnavailableReason = z.infer<typeof CalculationUnavailableReasonSchema>;

/** 算出不可エラー (design.md Error Envelope: CalculationUnavailableError) */
export const CalculationUnavailableErrorSchema = z.object({
  type: z.literal("calculation_unavailable"),
  reason: CalculationUnavailableReasonSchema,
  message: z.string(),
});
export type CalculationUnavailableError = z.infer<typeof CalculationUnavailableErrorSchema>;

// --- NutritionService Service Interface (Requirements 5.2, 6.1, 9.2, 11.1) ---

/**
 * 栄養サマリー (design.md NutritionService: NutritionSummary)
 * `activityLevelLabel` は Addendum「活動レベル表示ラベル」で追加された表示専用フィールドであり、
 * `ActivityCoefficientCalculator` 自体の出力には含まれない4段階カテゴリラベル。
 */
export const NutritionSummarySchema = z.object({
  computedAt: z.string(), // ISO 8601、算出時刻（永続化されない）
  bmr: z.number().positive(), // Requirement 2.5: 常に正の数値
  activityCoefficient: z.number().min(1.2).max(1.9), // Requirement 1.5: 妥当な範囲(1.20-1.90)にクランプ済み
  activityLevelLabel: z.string(), // Addendum: 活動レベル表示ラベル
  tdee: z.number().positive(), // Requirement 3.3: 常に正の数値
  dailyExpenditure: z.object({
    date: IsoDateStringSchema,
    value: z.number().positive(),
  }),
  normalMode: z.object({
    calorieTarget: z.number().positive(), // TDEEと一致 (Requirement 5.3)
    pfcRatio: PfcRatioSchema,
    pfc: PfcTargetsSchema,
    micronutrients: MicronutrientTargetsSchema,
  }),
  dietMode: z
    .object({
      calorieTarget: z.number(),
      pfcRatio: PfcRatioSchema,
      pfc: PfcTargetsSchema,
      guardrails: GuardrailResultSchema,
    })
    .nullable(),
});
export type NutritionSummary = z.infer<typeof NutritionSummarySchema>;

// --- NutritionController API Contract (date クエリパラメータ) ---

/**
 * `GET /api/nutrition/summary` および `GET /api/nutrition/diet-insights` の
 * 共通クエリパラメータスキーマ (design.md API Contract: date省略時は当日日付を使用)。
 * 両エンドポイントが同一のクエリ形状を共有するため、特定のエンドポイント名を冠さない
 * 汎用的な名称とする。
 */
export const NutritionDateQuerySchema = z.object({
  date: IsoDateStringSchema.optional(),
});
export type NutritionDateQuery = z.infer<typeof NutritionDateQuerySchema>;
