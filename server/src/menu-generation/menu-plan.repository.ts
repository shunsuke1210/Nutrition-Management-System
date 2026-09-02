/**
 * MenuPlanRepository — `week_menu_plans` / `day_menus` / `meal_slots` / `meal_ingredients`
 * の永続化と取得を担うリポジトリ。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #MenuPlanRepository、
 * Requirements 1.3, 1.6, 4.7, 6.1, 6.3, 7.1, 7.2, 7.4）に定義されたService Interfaceを
 * そのまま実装する。
 *
 * ## 読み取り時に合算する `DayMenu.dayNutrition`（design.md #MenuPlanRepository）
 * `day_menus` テーブルには栄養価カラムを一切持たせない（微量栄養素9項目を含む13項目の
 * 冗長な二重管理を避けるという design.md の明示的な設計判断）。`getActivePlan` /
 * `replaceDay` が返す `DayMenu.dayNutrition` は、当該日の4件の `meal_slots` 行（13カラム）を
 * **読み取り時に単純合算して**構築する。
 *
 * この合算は「4行の13カラムを項目ごとに足す」だけの純粋な算術であり、
 * `NutritionVerificationService.verifyDay`（task 3.3）をimportしてRepository→Serviceの
 * 依存を作ることはしない。Repositoryは可能な限りService層より下に留めるという一般原則に従い、
 * ここではローカルな `sumNutrition` で完結させる（下記「注入する UnitConversionService」の
 * 例外が正当化されるのは、`quantity_g` が他のどこからも得られないデータであるためで、
 * 単純な合算にはそうした外部依存の必要がない）。
 *
 * ## `getActivePlan` は主キー1件の素朴なルックアップ
 * `week_menu_plans.week_start_date` は PRIMARY KEY であり、1つの週に対して常に0件または1件しか
 * 行が存在しない（再生成は同一行をその場で置き換え、同一週の履歴行を並行して作らない）。
 * したがって design.md の「対象週の最新の献立プラン」は「その `week_start_date` の行（あれば）」
 * に一意に定まり、`ORDER BY` / `LIMIT` による最新行の選択ロジックは不要である（Requirement 1.6）。
 *
 * ## 設計判断1: `week_menu_plans.generation_source` の決定方法（design.md のギャップ）
 * `007_create_menu_plan_tables.sql` の `generation_source` は
 * `NOT NULL CHECK IN ('initial', 'week_regenerate')` である一方、design.md の
 * `replaceWeek(weekStartDate, days)` のシグネチャには `generationSource` 引数が存在せず、
 * design.md 本文にもこの列値の決定方法についての記述がない（`MenuPlanService` は
 * `generateWeek` と `regenerateWeek` という2メソッドを持つが、どちらも同じ `replaceWeek` を
 * 呼び出す）。
 *
 * そこで本実装は **`replaceWeek` 自身が、置き換え前に当該 `weekStartDate` の
 * `week_menu_plans` 行が既に存在するかを確認し**、
 *   - 既に存在した場合 → `'week_regenerate'`（Requirement 6.1: 既存の有効なプランの置き換え）
 *   - 存在しなかった場合 → `'initial'`（Requirement 1.3: 初回生成の永続化）
 * を書き込む。この存在確認は、置き換え処理と同一トランザクション内で行う。シングルユーザー・
 * 単一プロセス前提（Requirement 13.2、design.md Concurrency strategy）の本アプリでは実際の
 * 競合は起こり得ないが、「確認 → 書き込み」を分割不能に保つ方が正しく、かつ実装も単純になるため。
 *
 * ## 設計判断2: `meal_ingredients.quantity_g` の算出（注入する UnitConversionService）
 * `meal_ingredients.quantity_g` は `REAL NOT NULL CHECK (quantity_g > 0)`（正規化後のグラム量）
 * である一方、`MealSlot.ingredients`（`IngredientSelection[]`、`@nutrition/shared`）は
 * `{foodId, quantity, unit}` という**正規化前**の選択内容しか持たず、グラム量はデータフロー上の
 * どこにも存在しない。したがって本Repositoryが書き込み時に算出する必要があり、そのために
 * `UnitConversionService`（task 3.2）をDIで受け取り、食材ごとに
 * `toGrams(foodId, quantity, unit)` を呼ぶ。
 *
 * `UnitConversionService` はピアであるRepository（`FoodCompositionRepository`）にのみ依存するため、
 * これを `MenuPlanRepository` に注入しても依存の循環は生じない。「RepositoryはServiceに依存しない」
 * という一般規約に対する狭く限定的な例外であり、その正当化は上記のとおり
 * 「`quantity_g` は他のどこからも得られない」ことに尽きる（design.md のこのコンポーネントの
 * Dependencies行が better-sqlite3 コネクションのみを挙げている点との差異については
 * task 5.1 の CONCERNS を参照）。
 *
 * `toGrams` が失敗した場合（`unit_not_found`）は **不変条件違反として例外を投げる**。
 * design.md の Preconditions が「呼び出し元（`MenuPlanService`）が入力を検証済みであること」と
 * するとおり、`MenuPlanService` は本Repositoryを呼ぶ前に
 * `NutritionVerificationService.verifyDish` を成功させており、それが内部で同じ `toGrams` を
 * 既に呼んでいる。したがって単位が解決できない食材が本Repositoryに到達することは通常あり得ない。
 * また `replaceWeek` / `replaceDay` の戻り型は design.md 上で `Result` ではなく
 * `WeekMenuPlan` / `DayMenu` そのものであり、検証済み入力に対して失敗しないことが前提とされている。
 * 例外はトランザクション内で投げられるため、書き込みは自動的にロールバックされる
 * （部分的な献立プランを永続化しない: Requirement 1.4, 4.6）。
 */
import type Database from "better-sqlite3";
import type {
  DayMenu,
  IngredientSelection,
  IsoDate,
  MealSlot,
  MealType,
  VerifiedNutritionValues,
  WeekMenuPlan,
} from "@nutrition/shared";
import type { UnitConversionService } from "./unit-conversion.service.js";

/**
 * 日単位再生成のプロンプトコンテキストとして渡す「対象日以外の1日分」の射影
 * （design.md #MenuPromptBuilder Service Interface、Requirement 7.2）。
 *
 * この型は design.md の本文上では `MenuPromptBuilder`（task 6.3、未着手）のセクションで
 * 初めて登場するが、実際にこの値を**生成する**のは `MenuPlanRepository.findOtherDays` であり、
 * そちらが先に実装されるため、`VerificationError`（task 3.2 → 3.3）や
 * `MenuProfileSnapshot`（task 4.1）で既に確立された「型はそれを最初に生成する場所に置き、
 * 後続タスクがそこからimportする」という規約に倣ってここで定義・exportする。
 *
 * 料理名と食品IDのみを射影し、栄養価・分量・単位は一切含めない（Requirement 7.2 が
 * 「残り6日分の料理名と食材の食品ID」のみを生成コンテキストとして与えると定めているため）。
 */
export interface OtherDayContext {
  dayIndex: number;
  meals: { mealType: MealType; dishName: string; foodIds: string[] }[];
}

/** design.md #MenuPlanRepository Service Interface。 */
export interface MenuPlanRepository {
  getActivePlan(weekStartDate: IsoDate): WeekMenuPlan | null;
  findOtherDays(weekStartDate: IsoDate, excludeDayIndex: number): OtherDayContext[];
  findMealSlot(
    weekStartDate: IsoDate,
    dayIndex: number,
    mealType: MealType
  ): (MealSlot & { id: number }) | null;
  replaceWeek(weekStartDate: IsoDate, days: DayMenu[]): WeekMenuPlan;
  replaceDay(
    weekStartDate: IsoDate,
    dayIndex: number,
    meals: MealSlot[],
    plannedKcal: number,
    targetKcal: number | null
  ): DayMenu;
}

/** `week_menu_plans.generation_source` の取り得る値（007マイグレーションのCHECK制約）。 */
type GenerationSource = "initial" | "week_regenerate";

// --- 行の型 ---

interface WeekMenuPlanRow {
  week_start_date: string;
  generated_at: string;
}

interface DayMenuRow {
  id: number;
  day_date: string;
  day_index: number;
  planned_kcal: number | null;
  target_kcal: number | null;
  variance_kcal: number | null;
}

interface DayMenuIdentityRow {
  id: number;
  day_index: number;
}

/** `meal_slots` の栄養価13カラム（`VerifiedNutritionValues` と1対1対応）。 */
interface MealSlotNutritionColumns {
  energy_kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  fiber_g: number;
  calcium_mg: number;
  iron_mg: number;
  vitamin_a_ug: number;
  vitamin_d_ug: number;
  vitamin_b1_mg: number;
  vitamin_b2_mg: number;
  vitamin_c_mg: number;
  salt_equivalent_g: number;
}

interface MealSlotRow extends MealSlotNutritionColumns {
  id: number;
  meal_type: string;
  dish_name: string;
}

interface MealSlotIdentityRow {
  id: number;
  meal_type: string;
  dish_name: string;
}

interface MealIngredientRow {
  food_id: string;
  quantity: number;
  unit_code: string;
}

interface FoodIdRow {
  food_id: string;
}

// --- SQL断片 ---

/** `MealSlotRow`（`MealSlot` + `id`）を組み立てるために必要な `meal_slots` の全カラム。 */
const MEAL_SLOT_COLUMN_NAMES = [
  "id",
  "meal_type",
  "dish_name",
  "energy_kcal",
  "protein_g",
  "fat_g",
  "carb_g",
  "fiber_g",
  "calcium_mg",
  "iron_mg",
  "vitamin_a_ug",
  "vitamin_d_ug",
  "vitamin_b1_mg",
  "vitamin_b2_mg",
  "vitamin_c_mg",
  "salt_equivalent_g",
] as const;

/** `meal_slots` 単独クエリ用のSELECT句。 */
const MEAL_SLOT_COLUMNS = MEAL_SLOT_COLUMN_NAMES.join(", ");

/** `day_menus` とJOINするクエリ用の、`ms.` で修飾したSELECT句。 */
const MEAL_SLOT_COLUMNS_QUALIFIED = MEAL_SLOT_COLUMN_NAMES.map((column) => `ms.${column}`).join(
  ", "
);

// --- 栄養価のマッピングと合算 ---

/** `VerifiedNutritionValues` の13項目すべてを0で初期化した値（合算の起点）。 */
const ZERO_NUTRITION: VerifiedNutritionValues = {
  energyKcal: 0,
  proteinG: 0,
  fatG: 0,
  carbG: 0,
  fiberG: 0,
  calciumMg: 0,
  ironMg: 0,
  vitaminAUg: 0,
  vitaminDUg: 0,
  vitaminB1Mg: 0,
  vitaminB2Mg: 0,
  vitaminCMg: 0,
  saltEquivalentG: 0,
};

function mapRowToNutrition(row: MealSlotNutritionColumns): VerifiedNutritionValues {
  return {
    energyKcal: row.energy_kcal,
    proteinG: row.protein_g,
    fatG: row.fat_g,
    carbG: row.carb_g,
    fiberG: row.fiber_g,
    calciumMg: row.calcium_mg,
    ironMg: row.iron_mg,
    vitaminAUg: row.vitamin_a_ug,
    vitaminDUg: row.vitamin_d_ug,
    vitaminB1Mg: row.vitamin_b1_mg,
    vitaminB2Mg: row.vitamin_b2_mg,
    vitaminCMg: row.vitamin_c_mg,
    saltEquivalentG: row.salt_equivalent_g,
  };
}

/**
 * 13項目を項目ごとに単純合算する（`DayMenu.dayNutrition` の構築）。
 * ファイル冒頭のコメントのとおり、この算術は意図的にローカルで完結させており、
 * `NutritionVerificationService.verifyDay` には依存しない。
 */
function sumNutrition(values: readonly VerifiedNutritionValues[]): VerifiedNutritionValues {
  const total: VerifiedNutritionValues = { ...ZERO_NUTRITION };
  for (const value of values) {
    total.energyKcal += value.energyKcal;
    total.proteinG += value.proteinG;
    total.fatG += value.fatG;
    total.carbG += value.carbG;
    total.fiberG += value.fiberG;
    total.calciumMg += value.calciumMg;
    total.ironMg += value.ironMg;
    total.vitaminAUg += value.vitaminAUg;
    total.vitaminDUg += value.vitaminDUg;
    total.vitaminB1Mg += value.vitaminB1Mg;
    total.vitaminB2Mg += value.vitaminB2Mg;
    total.vitaminCMg += value.vitaminCMg;
    total.saltEquivalentG += value.saltEquivalentG;
  }
  return total;
}

/**
 * `db`（マイグレーション適用済みの better-sqlite3 コネクション）と
 * `unitConversionService`（既に構築済みの `UnitConversionService`。実装またはテスト用フェイク）
 * に対する `MenuPlanRepository` を生成する。`createFoodCompositionRepository`
 * （`food-composition.repository.ts`）/ `createProfileRepository`
 * （`server/src/profile/profile.repository.ts`）と同じDIファクトリ関数パターンに揃えており、
 * 本Repositoryは自らDBコネクションも依存も構築しない。
 */
export function createMenuPlanRepository(
  db: Database.Database,
  unitConversionService: UnitConversionService
): MenuPlanRepository {
  // --- 読み取り ---

  function readFoodIds(mealSlotId: number): string[] {
    const rows = db
      .prepare(`SELECT food_id FROM meal_ingredients WHERE meal_slot_id = ? ORDER BY id ASC`)
      .all(mealSlotId) as FoodIdRow[];
    return rows.map((row) => row.food_id);
  }

  function readIngredients(mealSlotId: number): IngredientSelection[] {
    // `quantity_g` は読み出さない。`IngredientSelection` は正規化前の選択内容
    // （`quantity` / `unit`）のみを表す形状であり、正規化後のグラム量は
    // 書き込み専用の派生値（買い物リスト集計等が直接SQLで参照する）である。
    const rows = db
      .prepare(
        `SELECT food_id, quantity, unit_code
           FROM meal_ingredients
          WHERE meal_slot_id = ?
          ORDER BY id ASC`
      )
      .all(mealSlotId) as MealIngredientRow[];

    return rows.map((row) => ({
      foodId: row.food_id,
      quantity: row.quantity,
      unit: row.unit_code,
    }));
  }

  function mapRowToMealSlot(row: MealSlotRow): MealSlot {
    return {
      mealType: row.meal_type as MealType,
      dishName: row.dish_name,
      ingredients: readIngredients(row.id),
      nutrition: mapRowToNutrition(row),
    };
  }

  function readMealSlotRows(dayMenuId: number): MealSlotRow[] {
    // `ORDER BY id ASC` は挿入順（=呼び出し元が渡した食枠の順序。Requirement 1.1 の
    // 朝食・昼食・夕食・間食の順）を保持する。`ProfileRepository` の子リスト読み取りが
    // `ORDER BY sort_order ASC, id ASC` で呼び出し元の順序を保持するのと同じ規約。
    return db
      .prepare(
        `SELECT ${MEAL_SLOT_COLUMNS} FROM meal_slots WHERE day_menu_id = ? ORDER BY id ASC`
      )
      .all(dayMenuId) as MealSlotRow[];
  }

  function mapRowToDayMenu(row: DayMenuRow): DayMenu {
    const meals = readMealSlotRows(row.id).map(mapRowToMealSlot);

    return {
      dayDate: row.day_date,
      dayIndex: row.day_index,
      meals,
      // design.md #MenuPlanRepository: `day_menus` の列からではなく、当該日の
      // `meal_slots` 行（13項目）を読み取り時に合算して構築する（Requirement 4.4, 4.7）。
      dayNutrition: sumNutrition(meals.map((meal) => meal.nutrition)),
      // `planned_kcal` はスキーマ上NULL許容だが、本Repositoryは常に非null値を書き込む
      // （`DayMenu.plannedKcal` は非nullable）。NULLは本Repository以外の経路で書かれた
      // データを意味する到達不能なケースであり、週全体の読み取りを例外で失敗させるより
      // 0として可視化するほうが読み取り経路として穏当なため `?? 0` にフォールバックする。
      plannedKcal: row.planned_kcal ?? 0,
      targetKcal: row.target_kcal,
      varianceKcal: row.variance_kcal,
    };
  }

  function readDayMenuById(dayMenuId: number): DayMenu | null {
    const row = db
      .prepare(
        `SELECT id, day_date, day_index, planned_kcal, target_kcal, variance_kcal
           FROM day_menus WHERE id = ?`
      )
      .get(dayMenuId) as DayMenuRow | undefined;

    if (!row) {
      return null;
    }
    return mapRowToDayMenu(row);
  }

  function getActivePlan(weekStartDate: IsoDate): WeekMenuPlan | null {
    // `week_start_date` は PRIMARY KEY なので、最新行を選ぶためのORDER BY/LIMITは不要
    // （ファイル冒頭コメント参照）。
    const weekRow = db
      .prepare(
        `SELECT week_start_date, generated_at FROM week_menu_plans WHERE week_start_date = ?`
      )
      .get(weekStartDate) as WeekMenuPlanRow | undefined;

    if (!weekRow) {
      return null;
    }

    const dayRows = db
      .prepare(
        `SELECT id, day_date, day_index, planned_kcal, target_kcal, variance_kcal
           FROM day_menus
          WHERE week_start_date = ?
          ORDER BY day_index ASC`
      )
      .all(weekStartDate) as DayMenuRow[];

    return {
      weekStartDate: weekRow.week_start_date,
      generatedAt: weekRow.generated_at,
      days: dayRows.map(mapRowToDayMenu),
    };
  }

  function findOtherDays(weekStartDate: IsoDate, excludeDayIndex: number): OtherDayContext[] {
    const dayRows = db
      .prepare(
        `SELECT id, day_index
           FROM day_menus
          WHERE week_start_date = ? AND day_index <> ?
          ORDER BY day_index ASC`
      )
      .all(weekStartDate, excludeDayIndex) as DayMenuIdentityRow[];

    return dayRows.map((dayRow) => {
      // 料理名と食品IDのみを射影する（栄養価カラム・分量・単位はSELECTしない）。
      const slotRows = db
        .prepare(
          `SELECT id, meal_type, dish_name
             FROM meal_slots
            WHERE day_menu_id = ?
            ORDER BY id ASC`
        )
        .all(dayRow.id) as MealSlotIdentityRow[];

      return {
        dayIndex: dayRow.day_index,
        meals: slotRows.map((slotRow) => ({
          mealType: slotRow.meal_type as MealType,
          dishName: slotRow.dish_name,
          // `meal_ingredients` の行順のまま返す（重複排除は行わない）。同一料理内で同じ
          // 食品IDが複数行に分かれている場合もそのまま列挙され、プロンプト側で
          // 「使用されている食品ID」として解釈できる。
          foodIds: readFoodIds(slotRow.id),
        })),
      };
    });
  }

  function findMealSlot(
    weekStartDate: IsoDate,
    dayIndex: number,
    mealType: MealType
  ): (MealSlot & { id: number }) | null {
    const row = db
      .prepare(
        `SELECT ${MEAL_SLOT_COLUMNS_QUALIFIED}
           FROM meal_slots ms
           JOIN day_menus dm ON ms.day_menu_id = dm.id
          WHERE dm.week_start_date = ? AND dm.day_index = ? AND ms.meal_type = ?`
      )
      .get(weekStartDate, dayIndex, mealType) as MealSlotRow | undefined;

    if (!row) {
      return null;
    }

    // `id` は `meal_slots.id`（`INTEGER PRIMARY KEY AUTOINCREMENT`）の実IDであり、
    // 後続タスクが `recipe_details.meal_slot_id` / `satisfaction_feedback.meal_slot_id`
    // の外部キーとしてそのまま利用できる。
    return { ...mapRowToMealSlot(row), id: row.id };
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
        `MenuPlanRepository: 食材の分量をグラムへ正規化できませんでした` +
          `（foodId: ${ingredient.foodId}, quantity: ${ingredient.quantity},` +
          ` unit: ${ingredient.unit}, type: ${result.error.type}）。` +
          `呼び出し元（MenuPlanService）が NutritionVerificationService による検証を` +
          `済ませている前提が破られています`
      );
    }
    return result.value;
  }

  /** 対象日の `meal_slots` と `meal_ingredients` を挿入する（`meal_slots` の13カラムをそのまま書き込む）。 */
  function insertMealSlots(
    dayMenuId: number,
    meals: readonly MealSlot[],
    generatedAt: string
  ): void {
    const insertSlot = db.prepare(
      `INSERT INTO meal_slots (
         day_menu_id, meal_type, dish_name,
         energy_kcal, protein_g, fat_g, carb_g, fiber_g, calcium_mg, iron_mg,
         vitamin_a_ug, vitamin_d_ug, vitamin_b1_mg, vitamin_b2_mg, vitamin_c_mg,
         salt_equivalent_g, generated_at
       ) VALUES (
         @dayMenuId, @mealType, @dishName,
         @energyKcal, @proteinG, @fatG, @carbG, @fiberG, @calciumMg, @ironMg,
         @vitaminAUg, @vitaminDUg, @vitaminB1Mg, @vitaminB2Mg, @vitaminCMg,
         @saltEquivalentG, @generatedAt
       )`
    );
    const insertIngredient = db.prepare(
      `INSERT INTO meal_ingredients (meal_slot_id, food_id, quantity, unit_code, quantity_g)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const meal of meals) {
      const info = insertSlot.run({
        dayMenuId,
        mealType: meal.mealType,
        dishName: meal.dishName,
        // `MealSlot.nutrition`（`VerifiedNutritionValues` 13項目）を加工せず
        // 対応する列へそのまま書き込む（design.md #MenuPlanRepository、Requirement 4.7）。
        energyKcal: meal.nutrition.energyKcal,
        proteinG: meal.nutrition.proteinG,
        fatG: meal.nutrition.fatG,
        carbG: meal.nutrition.carbG,
        fiberG: meal.nutrition.fiberG,
        calciumMg: meal.nutrition.calciumMg,
        ironMg: meal.nutrition.ironMg,
        vitaminAUg: meal.nutrition.vitaminAUg,
        vitaminDUg: meal.nutrition.vitaminDUg,
        vitaminB1Mg: meal.nutrition.vitaminB1Mg,
        vitaminB2Mg: meal.nutrition.vitaminB2Mg,
        vitaminCMg: meal.nutrition.vitaminCMg,
        saltEquivalentG: meal.nutrition.saltEquivalentG,
        generatedAt,
      });
      const mealSlotId = Number(info.lastInsertRowid);

      for (const ingredient of meal.ingredients) {
        insertIngredient.run(
          mealSlotId,
          ingredient.foodId,
          ingredient.quantity,
          ingredient.unit,
          // `quantity_g` はデータフロー上のどこにも存在しないため、ここで
          // `UnitConversionService` により算出する（設計判断2、ファイル冒頭コメント参照）。
          toGramsOrThrow(ingredient)
        );
      }
    }
  }

  /** 対象日の子行（`meal_ingredients` → `meal_slots`）のみを削除する。 */
  function deleteDayChildRows(dayMenuId: number): void {
    db.prepare(
      `DELETE FROM meal_ingredients
        WHERE meal_slot_id IN (SELECT id FROM meal_slots WHERE day_menu_id = ?)`
    ).run(dayMenuId);
    db.prepare(`DELETE FROM meal_slots WHERE day_menu_id = ?`).run(dayMenuId);
  }

  /**
   * 対象週の `meal_ingredients` / `meal_slots` / `day_menus` を全件削除する
   * （design.md #MenuPlanRepository の「既存の `day_menus`/`meal_slots`/`meal_ingredients` を
   * 全件削除」）。`ON DELETE CASCADE` でも同じ結果になるが、design.md が挙げる3テーブルを
   * 依存順に明示的に削除することで、この振る舞いを `PRAGMA foreign_keys` の設定に
   * 依存させない。`week_menu_plans` の行自体は削除せず、後述のUPSERTでその場更新する
   * （週開始日は主キーであり、同一週に対する行は常に0または1件）。
   */
  function deleteWeekChildRows(weekStartDate: IsoDate): void {
    db.prepare(
      `DELETE FROM meal_ingredients
        WHERE meal_slot_id IN (
          SELECT ms.id
            FROM meal_slots ms
            JOIN day_menus dm ON ms.day_menu_id = dm.id
           WHERE dm.week_start_date = ?)`
    ).run(weekStartDate);
    db.prepare(
      `DELETE FROM meal_slots
        WHERE day_menu_id IN (SELECT id FROM day_menus WHERE week_start_date = ?)`
    ).run(weekStartDate);
    db.prepare(`DELETE FROM day_menus WHERE week_start_date = ?`).run(weekStartDate);
  }

  /**
   * 対象週の既存データを全置換する処理の本体。`db.transaction(...)` でラップしているため、
   * 削除・挿入・`week_menu_plans` のUPSERTのすべてが単一トランザクションとして実行され、
   * 途中で例外が投げられた場合は全体がロールバックされる（Requirement 1.3, 1.4, 6.1）。
   */
  const runReplaceWeek = db.transaction((weekStartDate: IsoDate, days: readonly DayMenu[]) => {
    // 設計判断1: 置き換え前に行の存在を確認し、`generation_source` を推論する
    // （この確認自体もトランザクション内で行う）。
    const existingRow = db
      .prepare(`SELECT 1 AS present FROM week_menu_plans WHERE week_start_date = ?`)
      .get(weekStartDate);
    const generationSource: GenerationSource =
      existingRow === undefined ? "initial" : "week_regenerate";
    const generatedAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO week_menu_plans (week_start_date, generated_at, generation_source)
       VALUES (?, ?, ?)
       ON CONFLICT(week_start_date) DO UPDATE SET
         generated_at = excluded.generated_at,
         generation_source = excluded.generation_source`
    ).run(weekStartDate, generatedAt, generationSource);

    deleteWeekChildRows(weekStartDate);

    const insertDay = db.prepare(
      `INSERT INTO day_menus
         (week_start_date, day_date, day_index, planned_kcal, target_kcal, variance_kcal)
       VALUES (@weekStartDate, @dayDate, @dayIndex, @plannedKcal, @targetKcal, @varianceKcal)`
    );

    for (const day of days) {
      const info = insertDay.run({
        weekStartDate,
        dayDate: day.dayDate,
        dayIndex: day.dayIndex,
        // `replaceWeek` は完成済みの `DayMenu` を受け取るため、`plannedKcal` /
        // `targetKcal` / `varianceKcal` は呼び出し元が算出した値をそのまま保存する
        // （`replaceDay` は生の `meals` を受け取るため `varianceKcal` を自ら導出する。
        //  この非対称性はdesign.mdの2メソッドのシグネチャの違いに由来する）。
        plannedKcal: day.plannedKcal,
        targetKcal: day.targetKcal,
        varianceKcal: day.varianceKcal,
      });
      insertMealSlots(Number(info.lastInsertRowid), day.meals, generatedAt);
    }
  });

  function replaceWeek(weekStartDate: IsoDate, days: DayMenu[]): WeekMenuPlan {
    runReplaceWeek(weekStartDate, days);

    // 永続化した内容をそのまま読み戻して返す（`ProfileRepository.upsert` と同じ規約）。
    // これにより、戻り値の `DayMenu.dayNutrition` も `getActivePlan` と同一の
    // 「`meal_slots` 4行の読み取り時合算」で構築され、両者が常に一致する。
    const plan = getActivePlan(weekStartDate);
    if (!plan) {
      throw new Error(
        `MenuPlanRepository.replaceWeek: 永続化直後のプランを読み戻せませんでした（weekStartDate: ${weekStartDate}）`
      );
    }
    return plan;
  }

  /**
   * 対象日の食枠のみを置換する処理の本体。`meal_slots` / `meal_ingredients` は対象日の
   * `day_menu_id` に紐づく行だけを削除・再挿入し、`day_menus` の行自体は削除せず
   * kcal3列をその場更新するため、他6日の行（および `week_menu_plans` の
   * `generation_source`）には一切触れない（Requirement 7.1, 7.4）。
   * 置換した `day_menus` の行IDを返す。
   */
  const runReplaceDay = db.transaction(
    (
      weekStartDate: IsoDate,
      dayIndex: number,
      meals: readonly MealSlot[],
      plannedKcal: number,
      targetKcal: number | null
    ): number => {
      const dayRow = db
        .prepare(`SELECT id FROM day_menus WHERE week_start_date = ? AND day_index = ?`)
        .get(weekStartDate, dayIndex) as { id: number } | undefined;

      if (!dayRow) {
        // Requirement 7.4 の日単位再生成は「有効な週間献立プランのうち対象日の食枠のみを
        // 置き換える」操作であり、対象日の `day_menus` 行が存在しないことは
        // Preconditions（呼び出し元が入力を検証済み）が破られた不変条件違反である。
        throw new Error(
          `MenuPlanRepository.replaceDay: 対象日の day_menus 行が存在しません` +
            `（weekStartDate: ${weekStartDate}, dayIndex: ${dayIndex}）`
        );
      }

      // `varianceKcal` は当該日の4食枠の栄養価合算（`dayNutrition.energyKcal`）と目標値の差。
      // `targetKcal` が null の場合は差分を定義できないため null とする（Requirement 4.5）。
      // 符号規約は `NutritionVerificationService.computeVarianceKcal` と同じ「実績 - 目標」。
      const dayNutrition = sumNutrition(meals.map((meal) => meal.nutrition));
      const varianceKcal = targetKcal === null ? null : dayNutrition.energyKcal - targetKcal;
      const generatedAt = new Date().toISOString();

      deleteDayChildRows(dayRow.id);

      db.prepare(
        `UPDATE day_menus
            SET planned_kcal = ?, target_kcal = ?, variance_kcal = ?
          WHERE id = ?`
      ).run(plannedKcal, targetKcal, varianceKcal, dayRow.id);

      insertMealSlots(dayRow.id, meals, generatedAt);

      return dayRow.id;
    }
  );

  function replaceDay(
    weekStartDate: IsoDate,
    dayIndex: number,
    meals: MealSlot[],
    plannedKcal: number,
    targetKcal: number | null
  ): DayMenu {
    const dayMenuId = runReplaceDay(weekStartDate, dayIndex, meals, plannedKcal, targetKcal);

    const day = readDayMenuById(dayMenuId);
    if (!day) {
      throw new Error(
        `MenuPlanRepository.replaceDay: 永続化直後の日別献立を読み戻せませんでした（weekStartDate: ${weekStartDate}, dayIndex: ${dayIndex}）`
      );
    }
    return day;
  }

  return { getActivePlan, findOtherDays, findMealSlot, replaceWeek, replaceDay };
}
