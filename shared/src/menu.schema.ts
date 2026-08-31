/**
 * 献立生成（menu-generation）の Zod スキーマ・型定義。
 *
 * design.md の Components and Interfaces に記載された各 Service Interface ブロック
 * （MenuPlanService, RecipeDetailService, FeedbackService）の型形状をそのまま Zod スキーマ
 * として表現し、型はスキーマから推論する。
 *
 * `IsoDate` 型は `shared/src/daily-log.schema.ts` が既に export しているものを再利用し、
 * 本ファイルでは独自の `IsoDate` 型エイリアスを再定義しない。日付文字列のZodバリデーションは
 * `daily-log.schema.ts` の `DailyLogEntry.date` フィールドの precedent（正規表現による
 * フォーマット検証を行わない単純な `z.string()`）に倣う。`nutrition.schema.ts` が独自に持つ
 * 非exportの `IsoDateStringSchema`（正規表現による厳密検証）はこのファイルからimportできない
 * （exportされていない）ため採用しない。
 */
import { z } from "zod";
import type { IsoDate } from "./daily-log.schema.js";

// --- 日付形式 ---

/**
 * "YYYY-MM-DD" 形式の日付文字列。`daily-log.schema.ts` が export する `IsoDate` 型を
 * そのまま再利用する（重複定義しない）。
 */
const IsoDateSchema: z.ZodType<IsoDate> = z.string();

// --- MealType ---

/** 食事種別 (design.md Service Interface: MealType) */
export const MealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealType = z.infer<typeof MealTypeSchema>;

// --- IngredientSelection (Requirement 4.3) ---

/**
 * 食材選択 (design.md Service Interface: IngredientSelection)
 * `foodId` は非空文字列という構造的な形状のみを検証する。食品成分参照データ（food_items）に
 * 実在するかどうかのクロステーブル検証はService/Repository層（task 3.1以降）の責務であり、
 * 本スキーマでは行わない（`nutrition-engine`の各スキーマも同様にクロステーブル検証を含まない）。
 */
export const IngredientSelectionSchema = z.object({
  foodId: z.string().min(1),
  quantity: z.number().positive(), // > 0
  unit: z.string().min(1), // unit_conversions.unit_code
});
export type IngredientSelection = z.infer<typeof IngredientSelectionSchema>;

// --- NutritionValues / VerifiedNutritionValues (Requirement 4.3, 4.7) ---

/**
 * 基本栄養価 (design.md Service Interface: NutritionValues)
 * `RecipeDetail.nutrition`（食品成分DBと突き合わせた絶対値、常に非負）と
 * `SupplementarySuggestion.nutritionDelta`（追加時の栄養価の増分であり、より軽い副菜に
 * よって特定の栄養素が減ることもあるため負の値を取り得る）の両方の形状として共有される。
 * 後者が負の値を正当に取り得る以上、値域を制約すると有効な負の増分を誤って拒否してしまう。
 * この判断は `nutrition-engine` の `shared/src/nutrition.schema.ts` における
 * `PfcTargetsSchema`（dietMode逆算値が理論上非正になり得るため値域を制約しないという
 * 同一の理由付け）と同じ precedent に倣ったものである。
 */
export const NutritionValuesSchema = z.object({
  energyKcal: z.number(),
  proteinG: z.number(),
  fatG: z.number(),
  carbG: z.number(),
});
export type NutritionValues = z.infer<typeof NutritionValuesSchema>;

/**
 * 検証済み栄養価 (design.md Service Interface: VerifiedNutritionValues)
 * `MealSlot.nutrition` / `DayMenu.dayNutrition` は食品成分DBと突き合わせて検証された絶対値
 * （デルタではない）であり、design.md DBスキーマの `meal_slots` の各栄養価カラムが
 * `NOT NULL, >= 0` であることに対応して常に非負となる。`NutritionValuesSchema` を
 * `.extend()` すると同名4フィールドの無制約な値域を引き継いでしまうため、ここでは13フィールド
 * すべてを独立した `z.object()` として定義し、非負制約を明示する
 * （`NutritionValuesSchema`自体の制約には影響しない）。
 */
export const VerifiedNutritionValuesSchema = z.object({
  energyKcal: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  carbG: z.number().nonnegative(),
  fiberG: z.number().nonnegative(),
  calciumMg: z.number().nonnegative(),
  ironMg: z.number().nonnegative(),
  vitaminAUg: z.number().nonnegative(),
  vitaminDUg: z.number().nonnegative(),
  vitaminB1Mg: z.number().nonnegative(),
  vitaminB2Mg: z.number().nonnegative(),
  vitaminCMg: z.number().nonnegative(),
  saltEquivalentG: z.number().nonnegative(),
});
export type VerifiedNutritionValues = z.infer<typeof VerifiedNutritionValuesSchema>;

// --- MealSlot (Requirement 4.3, 4.7) ---

/** 食事枠 (design.md Service Interface: MealSlot) */
export const MealSlotSchema = z.object({
  mealType: MealTypeSchema,
  dishName: z.string().min(1),
  ingredients: z.array(IngredientSelectionSchema),
  nutrition: VerifiedNutritionValuesSchema, // 検証済み（要件4.7の9項目を含む）
});
export type MealSlot = z.infer<typeof MealSlotSchema>;

// --- DayMenu (Requirement 1.1, 4.4, 4.5) ---

/**
 * 1日分の献立 (design.md Service Interface: DayMenu)
 * `meals` は1日あたり朝食・昼食・夕食・間食の4食枠で固定である（design.mdコメント「4件」、
 * Requirement 1.1: 7日間×4食種の合計28食枠）。`nutrition.schema.ts` の
 * `GuardrailWarningSchema.suggestions`（design.mdの「常に1件以上を含む」という不変条件を
 * `.min(1)` でスキーマレベルに明示するprecedent）に倣い、この不変条件も `.length(4)` として
 * 明示的にスキーマへ組み込む。
 */
export const DayMenuSchema = z.object({
  dayDate: IsoDateSchema,
  dayIndex: z.number().int().min(0).max(6), // 0-6
  meals: z.array(MealSlotSchema).length(4), // 4件
  dayNutrition: VerifiedNutritionValuesSchema, // 4食枠のverifyDish結果をverifyDayで合算した日次合計
  plannedKcal: z.number(),
  targetKcal: z.number().nullable(),
  varianceKcal: z.number().nullable(),
});
export type DayMenu = z.infer<typeof DayMenuSchema>;

// --- WeekMenuPlan (Requirement 1.1) ---

/**
 * 週間献立プラン (design.md Service Interface: WeekMenuPlan)
 * `days` は7日分で固定である（design.mdコメント「7件」、Requirement 1.1）。`DayMenu.meals`
 * と同じ判断により `.length(7)` で不変条件をスキーマレベルに明示する。
 */
export const WeekMenuPlanSchema = z.object({
  weekStartDate: IsoDateSchema,
  // ISO 8601。`nutrition.schema.ts` の `NutritionSummary.computedAt` と同様、
  // このリポジトリでは厳密なISO8601フォーマット検証を行わない単純な `z.string()` を用いる。
  generatedAt: z.string(),
  days: z.array(DayMenuSchema).length(7), // 7件
});
export type WeekMenuPlan = z.infer<typeof WeekMenuPlanSchema>;

// --- SupplementarySuggestion (Requirement 9.1, 9.3) ---

/** 補助的な副菜提案 (design.md Service Interface: SupplementarySuggestion) */
export const SupplementarySuggestionSchema = z.object({
  dishName: z.string().min(1),
  ingredients: z.array(IngredientSelectionSchema),
  nutritionDelta: NutritionValuesSchema,
});
export type SupplementarySuggestion = z.infer<typeof SupplementarySuggestionSchema>;

// --- RecipeDetail (Requirement 8.1, 8.2, 9.1) ---

/**
 * レシピ詳細 (design.md Service Interface: RecipeDetail)
 * `mealSlotId` は `meal_slots(id)`（`INTEGER PRIMARY KEY AUTOINCREMENT`）を参照するDB上の
 * 自動採番IDである。design.mdのDBスキーマ表（recipe_detailsテーブル）でも `meal_slot_id`
 * 自体には `quantity`/`servings`/`cooking_time_minutes` 等と異なり `> 0` のCHECK制約が
 * 明記されていない。また、このリポジトリで唯一の自動採番ID参照フィールドのprecedentである
 * `shared/src/daily-log.schema.ts` の `ExerciseLogEntry.id` も制約なしの単純な `z.number()`
 * である。したがってここでも同じprecedentに倣い、`.int().positive()` 等の追加制約を課さない
 * （詳細はCONCERNSを参照）。
 */
export const RecipeDetailSchema = z.object({
  mealSlotId: z.number(),
  servings: z.number().int().positive(), // design.md DBスキーマ: INTEGER NOT NULL DEFAULT 1, > 0
  cookingTimeMinutes: z.number().int().positive(), // design.md DBスキーマ: INTEGER NOT NULL, > 0
  steps: z.array(z.string()),
  nutrition: NutritionValuesSchema,
  supplementarySuggestions: z.array(SupplementarySuggestionSchema).min(1).max(2), // 1〜2件
});
export type RecipeDetail = z.infer<typeof RecipeDetailSchema>;

// --- FeedbackInput (Requirement 10.1) ---

/** 満足度フィードバック入力 (design.md Service Interface: FeedbackInput) */
export const FeedbackInputSchema = z.object({
  liked: z.boolean(),
});
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
