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

// --- ResolvedIngredient (Requirement 4.8) ---

/**
 * 食材名解決済みの食材選択 (design.md #RecipeDetailService Service Interface: `ResolvedIngredient`)
 * `IngredientSelection` に `FoodCompositionRepository` から解決した食材名（`name`）を付与した、
 * 表示専用の形状。`RecipeDetail.ingredients`（対象食事枠に既に確定している食材）と
 * `SupplementarySuggestion.ingredients`（補助副菜提案の食材）の両方がこの形状を用いる。
 *
 * `IngredientSelectionSchema` / `MealSlotSchema` 自体（Claudeのtool呼び出し入力スキーマであり、
 * requirement 1/3/4の永続化・検証の両方で使われる中核型）は変更しない。名前解決は
 * `RecipeDetailService` が返却の都度 `FoodCompositionRepository` で行い、永続化しない
 * （research.md「Decision: レシピ詳細・追加副菜提案の材料一覧への食材名解決の追加（追記）」の
 * 選択肢2を採用した判断に基づく）。
 */
export const ResolvedIngredientSchema = IngredientSelectionSchema.extend({
  name: z.string().min(1),
});
export type ResolvedIngredient = z.infer<typeof ResolvedIngredientSchema>;

// --- SupplementarySuggestion (Requirement 9.1, 9.3, 4.8) ---

/**
 * 補助的な副菜提案 (design.md Service Interface: SupplementarySuggestion)
 * `ingredients` は `ResolvedIngredient[]`（食材名解決済み、要件4.8）。永続化層
 * （`server/src/menu-generation/recipe-detail.repository.ts` の `PersistedSupplementarySuggestion`）
 * では未解決の `IngredientSelection[]` のまま保持され、`RecipeDetailService` が返却時に
 * `FoodCompositionRepository` で名前解決してからこの公開型へ変換する。
 */
export const SupplementarySuggestionSchema = z.object({
  dishName: z.string().min(1),
  ingredients: z.array(ResolvedIngredientSchema),
  nutritionDelta: NutritionValuesSchema,
});
export type SupplementarySuggestion = z.infer<typeof SupplementarySuggestionSchema>;

// --- RecipeDetail (Requirement 8.1, 8.2, 9.1, 4.8) ---

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
  // 対象食事枠に既に確定している食材（MealSlot.ingredients）を食材名解決したもの。Claudeによる
  // 新規生成ではなく、既存データ+FoodCompositionRepository参照の組み立てのみ（要件4.8）。
  ingredients: z.array(ResolvedIngredientSchema),
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

// --- ShoppingList (Requirement 14.1-14.7) ---

/**
 * 買い物リストの表示カテゴリ (design.md #買い物リスト生成フロー Service Interface:
 * `ShoppingListItem.category`)
 *
 * `server/src/menu-generation/category-display-groups.data.ts`（task 13.2）の `DisplayGroup`
 * と文字列レベルで完全に一致する4値のリテラルユニオンだが、`shared` パッケージは `server`
 * パッケージからimportできない（依存の向きが逆になる）ため、ここで独立して定義する
 * （意図的な重複）。要件14.4が定めるこの4カテゴリ自体が固定の仕様値であり、将来この集合が
 * 変更される可能性は低い。かつ両ファイルはそれぞれ独立したテスト
 * （`category-display-groups.data.test.ts` の「ALL_DISPLAY_GROUPSは4つの固定表示グループを
 * design.mdのShoppingListItem.categoryと同一の文字列で保持する」、およびこのファイルの
 * スキーマが `shopping-list.service.ts` 経由で `ShoppingListService` のテストに使われる
 * こと）で値そのものを検証しているため、万一どちらか一方だけを変更してしまった場合は
 * 型エラー（`ShoppingListService`の`resolveDisplayGroup`の戻り値が
 * `ShoppingListCategory`に構造的に一致しなくなる）として即座に検出される。
 */
export const ShoppingListCategorySchema = z.enum([
  "野菜・きのこ",
  "肉・魚",
  "乳製品・卵・豆",
  "調味料・その他",
]);
export type ShoppingListCategory = z.infer<typeof ShoppingListCategorySchema>;

/**
 * 買い物リストの品目 (design.md #買い物リスト生成フロー Service Interface: ShoppingListItem)
 * `quantityGrams` は対象週の全食枠にわたって正規化済みグラム量を合算した値であり、
 * 合算対象が必ず1件以上存在する（0件の食品IDがitemsに現れることはない）ため常に正。
 * `displayQuantity` も要件14.7の「0.5刻み丸めで0になる場合は最小表示単位0.5を下限にする」
 * 仕様により常に正（0を取らない）。
 */
export const ShoppingListItemSchema = z.object({
  foodId: z.string().min(1),
  name: z.string().min(1),
  category: ShoppingListCategorySchema,
  quantityGrams: z.number().positive(),
  displayQuantity: z.number().positive(),
  displayUnit: z.string().min(1),
});
export type ShoppingListItem = z.infer<typeof ShoppingListItemSchema>;

/**
 * 週間買い物リスト (design.md #買い物リスト生成フロー Service Interface: ShoppingList)
 * `GET /api/menu-plans/:weekStartDate/shopping-list` のレスポンス本体
 * （`WeekMenuPlan`/`RecipeDetail`と同様、design.mdのFile Structure Planが
 * `shared/src/menu.schema.ts`に置くべき型として明記する）。
 */
export const ShoppingListSchema = z.object({
  weekStartDate: IsoDateSchema,
  items: z.array(ShoppingListItemSchema),
});
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

// --- EatingOutSuggestion / EatingOutSuggestionResult (Requirement 15.1-15.7) ---

/**
 * 外食代替提案 (design.md #外食代替提案生成フロー: `EatingOutSuggestion`)
 * `GET .../eating-out-suggestion` のレスポンス本体の一部（`EatingOutSuggestionResult.suggestion`）
 * であり、`ShoppingList`/`RecipeDetail`と同じ理由（design.mdのFile Structure Planが
 * `EatingOutSuggestionResult`を名指しで`shared/src/menu.schema.ts`が持つべき型として明記する）で
 * ここに定義する（`EatingOutSuggestionService`, task 13.5）。
 *
 * `typicalMenuKcal`/`alternativeMenuKcal`は静的参照データ（`eating-out-reference.data.ts`）の
 * 対応するフィールドと同じく常に正（実在する外食メニューのおおよそのカロリー）。
 * `proteinDeltaG`は`alternativeMenuの代表的なたんぱく質量 - typicalMenuの代表的なたんぱく質量`
 * であり、代替メニューの方がたんぱく質量が少ない実例が現実に存在する（例:
 * 「親子丼→かけうどん」で-18.5g）ため、値域を制約しない（`NutritionValuesSchema`の
 * `nutritionDelta`と同じ理由付け、本ファイル冒頭の`NutritionValuesSchema`コメント参照）。
 */
export const EatingOutSuggestionSchema = z.object({
  typicalMenuName: z.string().min(1),
  typicalMenuKcal: z.number().positive(),
  alternativeMenuName: z.string().min(1),
  alternativeMenuKcal: z.number().positive(),
  proteinDeltaG: z.number(), // 負値を正当に取り得る（代替メニューの方が低たんぱくな場合）
});
export type EatingOutSuggestion = z.infer<typeof EatingOutSuggestionSchema>;

/**
 * 外食代替提案生成フローのレスポンス本体 (design.md #外食代替提案生成フロー:
 * `EatingOutSuggestionResult`)。NG食材の除外により対象`mealType`の候補が残らない場合、これは
 * 生成失敗ではなく「該当なし」を表す正常応答であるため、`suggestion`は`null`を取り得る
 * （要件15.5）。
 */
export const EatingOutSuggestionResultSchema = z.object({
  suggestion: EatingOutSuggestionSchema.nullable(),
});
export type EatingOutSuggestionResult = z.infer<typeof EatingOutSuggestionResultSchema>;
