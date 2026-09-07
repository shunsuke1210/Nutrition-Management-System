/**
 * RecipeDetailRepository — `recipe_details` / `supplementary_suggestions` /
 * `supplementary_ingredients` の永続化を担うリポジトリ。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #RecipeDetailRepository、
 * Requirements 8, 9）に定義されたService Interfaceをそのまま実装する。
 *
 * ## `PersistedRecipeDetail`/`PersistedSupplementarySuggestion`（task 16.1、Requirement 4.8）
 * `@nutrition/shared` の公開型 `RecipeDetail`/`SupplementarySuggestion` は、対象食事枠・補助副菜の
 * 食材一覧を `FoodCompositionRepository` で食材名解決した `ResolvedIngredient[]` を持つ
 * （task 16.1で追加）。本Repositoryは食材名解決を一切行わず、`food_items` との結合なしに
 * 復元可能な最小限の内部表現のみを扱うため、公開型とは別に本ファイル内でローカルな
 * `PersistedRecipeDetail`/`PersistedSupplementarySuggestion`（`ingredients: IngredientSelection[]`
 * のまま、`PersistedRecipeDetail` 自体は対象食事枠の `ingredients` フィールドを持たない）を
 * 定義し、`RecipeDetailRepository` の戻り値型とする。名前解決とpublic型への変換は
 * `RecipeDetailService` が返却の都度行う（`recipe_details`/`supplementary_suggestions`/
 * `supplementary_ingredients` の各テーブルスキーマ・SQL・書き込みロジックは本タスクで一切
 * 変更しない）。
 *
 * ## `PersistedRecipeDetail.nutrition` はどの列にも書き込まない（design.mdとの既知のギャップの解消）
 * `recipe_details` テーブル（`008_create_recipe_detail_tables.sql`）には栄養価カラムが
 * 一切存在しない。これは見落としではなく、対象食枠自身の栄養価は既に `meal_slots`
 * （`energy_kcal`/`protein_g`/`fat_g`/`carb_g`）に永続化済みであり（`MenuPlanRepository`、
 * task 5.1）、design.mdの `RecipeDetailService`（task 10.1）自身のPostconditionが
 * 「対象食枠の栄養価は変更しない」と明記している以上、同じ値を本テーブルへ二重に持たせない
 * という、このspecで既に確立された「導出する、二重管理しない」規約
 * （`MenuPlanRepository.getActivePlan` の `dayNutrition` と同じ判断）に倣ったものである。
 *
 * したがって `upsert` が受け取る `detail.nutrition` はどの列にも書き込まれない
 * （呼び出し元 `RecipeDetailService` が同じ `meal_slots` 行から得た値を渡してくる想定の
 * 冗長な引数）。`findByMealSlotId` / `upsert` の戻り値の `nutrition` は、常に
 * `recipe_details.meal_slot_id` が指す `meal_slots` 行の4列を読み取り時に組み立てて返す。
 * 受け取った `detail.nutrition` と読み直した値との突合・防御的検証は行わない
 * （design.mdのPreconditionsが「呼び出し元が検証済みであること」とする既存規約に倣う）。
 *
 * ## `supplementary_ingredients.quantity_g` の算出（注入する UnitConversionService）
 * design.mdの本コンポーネントのDependencies行は better-sqlite3 コネクションのみを挙げるが、
 * `quantity_g`（正規化後のグラム量）はデータフロー上どこにも存在しないため、
 * `MenuPlanRepository`（task 5.1）の `meal_ingredients.quantity_g` と全く同じ理由により
 * `UnitConversionService` をDIで受け取る。`toGrams` が失敗した場合は
 * `MenuPlanRepository` と同様、呼び出し元（`RecipeDetailService`、未実装）が
 * `NutritionVerificationService` による検証を済ませている前提の不変条件違反として例外を
 * 投げる（`Result` でラップしない）。例外はトランザクション内で投げられるため自動的に
 * ロールバックされる。
 *
 * ## upsertの実装方針: 単一トランザクション内で「削除してから再挿入」
 * design.mdのPersistence & consistency（「upsert は単一トランザクションで既存行を削除して
 * から再挿入する」）をそのまま実装する。`DELETE FROM recipe_details WHERE meal_slot_id = ?`
 * のみを行えば、`supplementary_suggestions`/`supplementary_ingredients` は
 * `008_create_recipe_detail_tables.sql` の `ON DELETE CASCADE` によって自動的に連鎖削除される
 * ため、これらを個別に削除するコードは書かない。書き込み後は
 * `MenuPlanRepository.replaceWeek`/`FeedbackRepository.upsert` と同じ「読み戻して返す」規約
 * に倣い、`findByMealSlotId` を呼んで実際にDBへ永続化された内容を返す。
 *
 * ## `supplementary_suggestions.sort_order` と読み取り順序
 * SQLは明示的な `ORDER BY` なしに挿入順を保証しないため、`findByMealSlotId` は
 * `sort_order ASC` で読み取る。`upsert` は配列のインデックスをそのまま `sort_order` として
 * 書き込む。
 */
import type Database from "better-sqlite3";
import type { IngredientSelection, NutritionValues } from "@nutrition/shared";
import type { UnitConversionService } from "./unit-conversion.service.js";

/**
 * 永続化される内部表現 (design.md #RecipeDetailRepository)。food_itemsとの結合（食材名解決）は
 * 行わず、food_id/quantity/unitのみを保持する（`supplementary_ingredients`テーブルに`name`列を
 * 追加しない）。食材名解決は`RecipeDetailService`が返却時に都度`FoodCompositionRepository`で
 * 行う（Requirement 4.8）。公開型`SupplementarySuggestion`（`@nutrition/shared`、
 * `ingredients: ResolvedIngredient[]`）とは異なり、ここでの`ingredients`は
 * `IngredientSelection[]`のまま変更しない。
 */
export interface PersistedSupplementarySuggestion {
  dishName: string;
  ingredients: IngredientSelection[];
  nutritionDelta: NutritionValues;
}

/**
 * 永続化される`RecipeDetail`の内部表現 (design.md #RecipeDetailRepository)。公開型
 * `RecipeDetail`（`@nutrition/shared`）とは異なり`ingredients`フィールドを持たない
 * （対象食事枠の食材一覧は本Repositoryが永続化・読み取る対象ではなく、`RecipeDetailService`が
 * `MealSlot.ingredients`から都度組み立てて公開型へ付与する。Requirement 4.8）。
 */
export interface PersistedRecipeDetail {
  mealSlotId: number;
  servings: number;
  cookingTimeMinutes: number;
  steps: string[];
  nutrition: NutritionValues;
  supplementarySuggestions: PersistedSupplementarySuggestion[]; // 1〜2件
}

/** design.md #RecipeDetailRepository Service Interface。 */
export interface RecipeDetailRepository {
  findByMealSlotId(mealSlotId: number): PersistedRecipeDetail | null;
  upsert(
    mealSlotId: number,
    detail: Omit<PersistedRecipeDetail, "mealSlotId">
  ): PersistedRecipeDetail;
}

// --- 行の型 ---

interface RecipeDetailRow {
  id: number;
  meal_slot_id: number;
  servings: number;
  cooking_time_minutes: number;
  steps_json: string;
}

/** `RecipeDetail.nutrition`（`NutritionValues` 4項目）を導出するための `meal_slots` の該当4列。 */
interface MealSlotNutritionRow {
  energy_kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
}

interface SupplementarySuggestionRow {
  id: number;
  dish_name: string;
  energy_kcal_delta: number;
  protein_g_delta: number;
  fat_g_delta: number;
  carb_g_delta: number;
}

interface SupplementaryIngredientRow {
  food_id: string;
  quantity: number;
  unit_code: string;
}

function mapMealSlotNutritionRow(row: MealSlotNutritionRow): NutritionValues {
  return {
    energyKcal: row.energy_kcal,
    proteinG: row.protein_g,
    fatG: row.fat_g,
    carbG: row.carb_g,
  };
}

/**
 * `db`（マイグレーション適用済みの better-sqlite3 コネクション）と
 * `unitConversionService`（既に構築済みの `UnitConversionService`。実装またはテスト用フェイク）
 * に対する `RecipeDetailRepository` を生成する。`createMenuPlanRepository`
 * （`menu-plan.repository.ts`）と同じDIファクトリ関数パターンに揃えており、本Repositoryは
 * 自らDBコネクションも依存も構築しない。
 */
export function createRecipeDetailRepository(
  db: Database.Database,
  unitConversionService: UnitConversionService
): RecipeDetailRepository {
  // --- 読み取り ---

  /**
   * `mealSlotId` が指す `meal_slots` 行の4栄養価列を読み取る。呼び出し元は必ず
   * `recipe_details.meal_slot_id`（`meal_slots(id)` へのFK、`NOT NULL`）由来の値を渡すため、
   * 該当行が存在しないのは不変条件違反であり例外にする。
   */
  function readMealSlotNutrition(mealSlotId: number): NutritionValues {
    const row = db
      .prepare(`SELECT energy_kcal, protein_g, fat_g, carb_g FROM meal_slots WHERE id = ?`)
      .get(mealSlotId) as MealSlotNutritionRow | undefined;

    if (!row) {
      throw new Error(
        `RecipeDetailRepository: meal_slot_id が指す meal_slots 行が見つかりませんでした` +
          `（mealSlotId: ${mealSlotId}）。recipe_details.meal_slot_id は meal_slots(id) への` +
          ` NOT NULL 外部キーであるため、通常到達不能です`
      );
    }
    return mapMealSlotNutritionRow(row);
  }

  function readIngredients(supplementarySuggestionId: number): IngredientSelection[] {
    const rows = db
      .prepare(
        `SELECT food_id, quantity, unit_code
           FROM supplementary_ingredients
          WHERE supplementary_suggestion_id = ?
          ORDER BY id ASC`
      )
      .all(supplementarySuggestionId) as SupplementaryIngredientRow[];

    return rows.map((row) => ({
      foodId: row.food_id,
      quantity: row.quantity,
      unit: row.unit_code,
    }));
  }

  function readSuggestions(recipeDetailId: number): PersistedSupplementarySuggestion[] {
    // `sort_order ASC` で読み取る（SQLは明示的なORDER BYなしに挿入順を保証しないため）。
    const rows = db
      .prepare(
        `SELECT id, dish_name, energy_kcal_delta, protein_g_delta, fat_g_delta, carb_g_delta
           FROM supplementary_suggestions
          WHERE recipe_detail_id = ?
          ORDER BY sort_order ASC`
      )
      .all(recipeDetailId) as SupplementarySuggestionRow[];

    return rows.map((row) => ({
      dishName: row.dish_name,
      ingredients: readIngredients(row.id),
      nutritionDelta: {
        energyKcal: row.energy_kcal_delta,
        proteinG: row.protein_g_delta,
        fatG: row.fat_g_delta,
        carbG: row.carb_g_delta,
      },
    }));
  }

  function findByMealSlotId(mealSlotId: number): PersistedRecipeDetail | null {
    const row = db
      .prepare(
        `SELECT id, meal_slot_id, servings, cooking_time_minutes, steps_json
           FROM recipe_details
          WHERE meal_slot_id = ?`
      )
      .get(mealSlotId) as RecipeDetailRow | undefined;

    if (!row) {
      return null;
    }

    return {
      mealSlotId: row.meal_slot_id,
      servings: row.servings,
      cookingTimeMinutes: row.cooking_time_minutes,
      steps: JSON.parse(row.steps_json) as string[],
      // design.md #RecipeDetailRepository: `recipe_details` の列からではなく、
      // `meal_slot_id` が指す `meal_slots` 行の4列を読み取り時に組み立てて返す（ファイル冒頭コメント）。
      nutrition: readMealSlotNutrition(row.meal_slot_id),
      supplementarySuggestions: readSuggestions(row.id),
    };
  }

  // --- 書き込み ---

  /**
   * `IngredientSelection` をグラムへ正規化する。失敗はファイル冒頭コメントのとおり
   * 不変条件違反として例外にする（トランザクション内で投げられるためロールバックされる）。
   */
  function toGramsOrThrow(ingredient: IngredientSelection): number {
    const result = unitConversionService.toGrams(
      ingredient.foodId,
      ingredient.quantity,
      ingredient.unit
    );
    if (!result.ok) {
      throw new Error(
        `RecipeDetailRepository: 副菜の食材の分量をグラムへ正規化できませんでした` +
          `（foodId: ${ingredient.foodId}, quantity: ${ingredient.quantity},` +
          ` unit: ${ingredient.unit}, type: ${result.error.type}）。` +
          `呼び出し元（RecipeDetailService）が NutritionVerificationService による検証を` +
          `済ませている前提が破られています`
      );
    }
    return result.value;
  }

  /**
   * upsertの本体。design.mdの明示的な「既存行を削除してから再挿入する」を単一トランザクション
   * として実行する。`DELETE FROM recipe_details` のみで
   * `supplementary_suggestions`/`supplementary_ingredients` もCASCADEで連鎖削除される。
   */
  const runUpsert = db.transaction(
    (mealSlotId: number, detail: Omit<PersistedRecipeDetail, "mealSlotId">): void => {
      db.prepare(`DELETE FROM recipe_details WHERE meal_slot_id = ?`).run(mealSlotId);

      const generatedAt = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO recipe_details (meal_slot_id, servings, cooking_time_minutes, steps_json, generated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(mealSlotId, detail.servings, detail.cookingTimeMinutes, JSON.stringify(detail.steps), generatedAt);
      const recipeDetailId = Number(info.lastInsertRowid);

      const insertSuggestion = db.prepare(
        `INSERT INTO supplementary_suggestions (
           recipe_detail_id, dish_name, energy_kcal_delta, protein_g_delta, fat_g_delta, carb_g_delta, sort_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const insertIngredient = db.prepare(
        `INSERT INTO supplementary_ingredients (supplementary_suggestion_id, food_id, quantity, unit_code, quantity_g)
         VALUES (?, ?, ?, ?, ?)`
      );

      detail.supplementarySuggestions.forEach((suggestion, index) => {
        const suggestionInfo = insertSuggestion.run(
          recipeDetailId,
          suggestion.dishName,
          suggestion.nutritionDelta.energyKcal,
          suggestion.nutritionDelta.proteinG,
          suggestion.nutritionDelta.fatG,
          suggestion.nutritionDelta.carbG,
          index // sort_order は配列インデックスをそのまま使う
        );
        const supplementarySuggestionId = Number(suggestionInfo.lastInsertRowid);

        for (const ingredient of suggestion.ingredients) {
          insertIngredient.run(
            supplementarySuggestionId,
            ingredient.foodId,
            ingredient.quantity,
            ingredient.unit,
            // `quantity_g` はデータフロー上どこにも存在しないため、ここで
            // `UnitConversionService` により算出する（ファイル冒頭コメント参照）。
            toGramsOrThrow(ingredient)
          );
        }
      });
    }
  );

  function upsert(
    mealSlotId: number,
    detail: Omit<PersistedRecipeDetail, "mealSlotId">
  ): PersistedRecipeDetail {
    runUpsert(mealSlotId, detail);

    // 永続化した内容をそのまま読み戻して返す（`MenuPlanRepository`/`FeedbackRepository` と同じ規約）。
    const result = findByMealSlotId(mealSlotId);
    if (!result) {
      throw new Error(
        `RecipeDetailRepository.upsert: 永続化直後のレシピ詳細を読み戻せませんでした` +
          `（mealSlotId: ${mealSlotId}）`
      );
    }
    return result;
  }

  return { findByMealSlotId, upsert };
}
