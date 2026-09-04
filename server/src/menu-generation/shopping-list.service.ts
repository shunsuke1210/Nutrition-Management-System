/**
 * ShoppingListService — 対象週の有効な週間献立プランに含まれる全28食枠（7日×4食種）の
 * 確定済み食材を、食品ID単位で正規化済みグラム量に合算し、4つの固定カテゴリに分類した
 * 週間買い物リストを生成する。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #買い物リスト生成フロー、
 * Requirements 14.1-14.7）に定義されたオーケストレーションを実装する。
 *
 * ## design.mdのシーケンス図の字面と、実際に必要な実装との乖離について
 * design.mdのシーケンス図は `MenuPlanRepository.getActivePlan` が「全28食枠のmeal_ingredients
 * 含む」`WeekMenuPlan` を返し、あたかも既に正規化済みのグラム量（`quantity_g`）を
 * 直接読み取れるかのように書かれている。しかし実際の `MealSlot.ingredients`
 * （`IngredientSelection[]`, `@nutrition/shared`）は `{foodId, quantity, unit}` という
 * **正規化前**の選択内容のみを持ち、`quantity_g` はデータフロー上どこにも存在しない
 * （`MenuPlanRepository`は書き込み時にのみ`UnitConversionService.toGrams`で算出し、
 * `meal_ingredients.quantity_g`列に保存するが、読み取り経路（`IngredientSelection`）には
 * 一切含めない設計になっている。`menu-plan.repository.ts`のファイル冒頭コメント
 * 「`readIngredients`は`quantity_g`を読み出さない」を参照）。
 *
 * これがtask 13.1自身のタスク文が「`UnitConversionService`で正規化したグラム量で...合算し」と
 * 明記し、かつtask 3.2（`UnitConversionService`）への依存を明示している理由である。
 * 本Serviceは28食枠すべての食材について自ら`toGrams`を呼び、foodId単位で合算する。
 *
 * ## toGrams失敗の扱い（不変条件違反として例外）
 * `unitConversionService.toGrams`が失敗を返すことは、`menu-plan.repository.ts`の
 * `toGramsOrThrow`・`recipe-detail.repository.ts`の同種の箇所と同じ理由により、
 * 通常は起こり得ない不変条件違反である。対象週の食材は、生成時点で既に
 * `NutritionVerificationService.verifyDish`（内部で同じ`toGrams`を呼ぶ）による検証を
 * 通過済みであるため、ここで単位が解決できないことはDB破損かロジックエラーを意味する。
 * したがってResultで包まず、そのまま例外を投げる（`MenuPlanRepository.replaceWeek`の
 * トランザクションと異なり本Serviceは読み取り専用のためロールバック対象はないが、
 * 「検証済みの入力に対して失敗しない」という前提は同一）。
 *
 * ## `foodCompositionRepository.findById` が失敗した場合（不変条件違反として例外）
 * 対象週の食材の`foodId`は生成時点で既に実在確認済みであるため、`findById`が`null`を返すことは
 * 不変条件違反であり、例外を投げる。
 *
 * ## `findUnitConversion` が失敗した場合（グラム表示へのグレースフルデグレード、task 15.2）
 * 当初は`findById`と同様、「`display_unit_code`設定済みの食品に対応する`unit_conversions`
 * エントリはtask 2.2のシード保証により必ず存在する」という前提のもと、`findUnitConversion`の
 * `null`も同じく不変条件違反として例外を投げていた。しかし`/kiro-validate-impl menu-generation`
 * 1回目の最終統合検証（Implementation Notes参照）で、この前提はtask 2.2自身が意図的に
 * 破っていることが判明した——信頼できる出典が確認できない`(food_id, display_unit_code)`の
 * 組み合わせ（例: `'01034'` ロールパン）は、推定値を捏造するより`unit_conversions`への
 * 投入を見送る方針が`011_seed_unit_conversions.sql`冒頭コメントに明記されており
 * （task 2.1/2.2の「実データのみ・出典なき換算は捏造しない」方針）、`display_unit_code`
 * 設定済み152食品中73件（48%）がこれに該当する。したがってこの欠落は例外的なDB破損では
 * なく、シード方針自体が生む通常のデータ形状であり、例外で扱うべきではない。
 *
 * task 15.2はこれを、要件14.7が`display_unit_code`未設定食品に対して既に定義している
 * グラム表示フォールバック（`displayQuantity = totalGrams`, `displayUnit = "g"`）と
 * 同一の扱いへ合流させる（`gramDisplayItem`ヘルパー、下記参照）。これにより「その食品を
 * どんな単位で買い物リストに表示するか決定できない」という一点では両ケースが本質的に
 * 同じ状況であることが、コード上も表現される。
 *
 * ## `findGenericUnitConversion`を呼ばないことについて
 * `display_unit_code`は task 2.2 の知見により常に個数ベースの単位（個/本/枚/パック/玉/束/缶/丁）
 * であり、これらは食材固有の換算エントリしか持たず、汎用（`food_id IS NULL`）エントリを
 * 一切持たない（汎用エントリを持つのは大さじ/小さじ/カップ/ml/ccのような体積ベースの単位のみ）。
 * したがって本Serviceは`findUnitConversion`（食材固有ルックアップ）のみを呼び、
 * `findGenericUnitConversion`は一切呼ばない。
 *
 * ## `ShoppingListItem` / `ShoppingList` を `@nutrition/shared` の型として再利用することについて
 * （task 13.1 review round 1の指摘を反映）
 * この2つの型は当初、本ファイルのローカルなTypeScript interfaceとして定義していたが、
 * design.mdのFile Structure Planが`WeekMenuPlan`/`DayMenu`/`MealSlot`/`RecipeDetail`/
 * `FeedbackInput`と同じ並びで`ShoppingList`を`shared/src/menu.schema.ts`が持つべき型として
 * 明記しており、かつ`ShoppingList`は`GET /api/menu-plans/:weekStartDate/shopping-list`の
 * HTTPレスポンス本体そのものである（`RecipeDetail`が`RecipeDetailService`とは別コンポーネントの
 * `MealSlotController`のAPI契約として`shared`に昇格されているのと同型の状況）。したがって
 * `ShoppingListItemSchema`/`ShoppingListSchema`（`shared/src/menu.schema.ts`）へ昇格し、
 * 本ファイルはそこから推論された型をimportして使う。`category`フィールドの4値リテラル
 * ユニオンは`shared`が`server`をimportできないため`ShoppingListCategorySchema`として
 * `shared`側に独立定義されており（`category-display-groups.data.ts`の`DisplayGroup`と
 * 文字列レベルで一致するが型としては独立）、`resolveDisplayGroup`の戻り値（`DisplayGroup`）は
 * 構造的部分型として`ShoppingListCategory`にそのまま代入できる。
 *
 * `ShoppingListService`（このオーケストレーションのService Interfaceそのもの）は、
 * design.mdの他の全Service（`NutritionVerificationService`等）と同じ規約により、
 * データ形状ではなくコンポーネント固有の振る舞い契約であるためローカルに留める。
 */
import type { IsoDate, ShoppingList, ShoppingListItem, WeekMenuPlan } from "@nutrition/shared";
import { resolveDisplayGroup } from "./category-display-groups.data.js";
import type {
  FoodCompositionRepository,
  FoodItemNutrition,
} from "./food-composition.repository.js";
import type { MenuPlanRepository } from "./menu-plan.repository.js";
import type { UnitConversionService } from "./unit-conversion.service.js";

/** design.md #買い物リスト生成フロー Service Interface。 */
export interface ShoppingListService {
  buildForWeek(weekStartDate: IsoDate): ShoppingList | null;
}

/** 表示用数量の丸め幅（要件14.7「0.5刻み」）。 */
const DISPLAY_QUANTITY_ROUNDING_STEP = 0.5;

/** 0.5刻み丸めの結果が0になった場合の最小表示単位（要件14.7）。 */
const MIN_DISPLAY_QUANTITY = 0.5;

/** `display_unit_code`が未設定の食品の表示単位（要件14.7）。 */
const GRAM_DISPLAY_UNIT = "g";

/**
 * `value`を`DISPLAY_QUANTITY_ROUNDING_STEP`（0.5）刻みで四捨五入する。結果が0になる場合は
 * `MIN_DISPLAY_QUANTITY`（0.5）を下限として返す（要件14.7の「少量の調味料等」対応）。
 */
function roundToDisplayStep(value: number): number {
  const rounded =
    Math.round(value / DISPLAY_QUANTITY_ROUNDING_STEP) * DISPLAY_QUANTITY_ROUNDING_STEP;
  return rounded === 0 ? MIN_DISPLAY_QUANTITY : rounded;
}

/**
 * `menuPlanRepository` / `foodCompositionRepository` / `unitConversionService`
 * （いずれも既に構築済みの依存）に対する`ShoppingListService`を生成する。
 * `createNutritionVerificationService`（`nutrition-verification.service.ts`）と同じ
 * 位置引数のDIファクトリ関数パターンに揃えている。
 */
export function createShoppingListService(
  menuPlanRepository: MenuPlanRepository,
  foodCompositionRepository: FoodCompositionRepository,
  unitConversionService: UnitConversionService
): ShoppingListService {
  /**
   * 食材1件をグラムへ正規化する。失敗はファイル冒頭コメントのとおり不変条件違反として
   * 例外にする（`MenuPlanRepository.toGramsOrThrow`と同じ規約）。
   */
  function toGramsOrThrow(foodId: string, quantity: number, unitCode: string): number {
    const result = unitConversionService.toGrams(foodId, quantity, unitCode);
    if (!result.ok) {
      throw new Error(
        `ShoppingListService: 食材の分量をグラムへ正規化できませんでした` +
          `（foodId: ${foodId}, quantity: ${quantity}, unit: ${unitCode}, type: ${result.error.type}）。` +
          `対象週の食材は生成時点でNutritionVerificationServiceによる検証を済ませている前提が破られています`
      );
    }
    return result.value;
  }

  /**
   * 対象週の全28食枠（7日×4食種）の食材を走査し、foodId単位で正規化済みグラム量を合算する
   * （要件14.1, 14.2）。走査順は`plan.days`→各日の`meals`→各食枠の`ingredients`の順。
   */
  function accumulateGramsByFoodId(plan: WeekMenuPlan): Map<string, number> {
    const totalsByFoodId = new Map<string, number>();

    for (const day of plan.days) {
      for (const meal of day.meals) {
        for (const ingredient of meal.ingredients) {
          const grams = toGramsOrThrow(ingredient.foodId, ingredient.quantity, ingredient.unit);
          totalsByFoodId.set(
            ingredient.foodId,
            (totalsByFoodId.get(ingredient.foodId) ?? 0) + grams
          );
        }
      }
    }

    return totalsByFoodId;
  }

  /**
   * グラム量をそのまま表示用数量とする`ShoppingListItem`を組み立てる（要件14.7）。
   * `displayUnitCode`未設定の食品、および設定済みだが対応する`unit_conversions`エントリが
   * 存在しない食品（task 15.2、ファイル冒頭コメント「`findUnitConversion` が失敗した場合」
   * 参照）の両方から共有される、同一の返却形状。
   */
  function gramDisplayItem(
    foodId: string,
    food: FoodItemNutrition,
    category: ShoppingListItem["category"],
    totalGrams: number
  ): ShoppingListItem {
    return {
      foodId,
      name: food.name,
      category,
      quantityGrams: totalGrams,
      displayQuantity: totalGrams,
      displayUnit: GRAM_DISPLAY_UNIT,
    };
  }

  /**
   * 合算済みの`totalGrams`（foodId単位）から、品目名・カテゴリ・表示用数量/単位を解決した
   * `ShoppingListItem`を1件組み立てる（要件14.3, 14.4, 14.5, 14.7）。
   */
  function buildItem(foodId: string, totalGrams: number): ShoppingListItem {
    const food = foodCompositionRepository.findById(foodId);
    if (!food) {
      // ファイル冒頭コメント「findById が失敗した場合」参照。
      throw new Error(
        `ShoppingListService: 食品ID "${foodId}" が食品成分参照データに見つかりません。` +
          `この食品IDは対象週の献立生成時点で既に実在確認済みのはずです`
      );
    }

    const category = resolveDisplayGroup(food.category);

    if (food.displayUnitCode === null) {
      // 未設定: グラム量をそのまま表示用数量とする（要件14.7）。
      return gramDisplayItem(foodId, food, category, totalGrams);
    }

    // 設定済み: 対応する食材固有のunit_conversionsエントリでグラム量を除算し、
    // 0.5刻みで丸めた表示用数量を算出する（要件14.7）。
    const conversion = foodCompositionRepository.findUnitConversion(foodId, food.displayUnitCode);
    if (!conversion) {
      // 食材固有のunit_conversionsエントリが存在しない（task 2.2が信頼できる出典なしに
      // 意図的に未投入とした組み合わせ、例: '01034'）。ファイル冒頭コメント
      // 「`findUnitConversion` が失敗した場合」参照。例外にせず、displayUnitCode未設定と
      // 同じグラム表示フォールバックへ合流させる（task 15.2）。
      return gramDisplayItem(foodId, food, category, totalGrams);
    }

    return {
      foodId,
      name: food.name,
      category,
      quantityGrams: totalGrams,
      displayQuantity: roundToDisplayStep(totalGrams / conversion.gramsPerUnit),
      displayUnit: food.displayUnitCode,
    };
  }

  function buildForWeek(weekStartDate: IsoDate): ShoppingList | null {
    const plan = menuPlanRepository.getActivePlan(weekStartDate);
    if (!plan) {
      // 対象週の有効なプランが存在しない場合はnullを返す（要件14.6）。専用のエラー型は
      // 導入しない（design.md「既存の GET /api/menu-plans/:weekStartDate と同様」）。
      return null;
    }

    const totalsByFoodId = accumulateGramsByFoodId(plan);

    // foodId昇順で決定論的な順序にする（design.mdは品目の順序を規定しないが、テスト・
    // デバッグのしやすさのため、`FoodCompositionRepository.listAllIds`と同じ
    // `ORDER BY food_id ASC`規約に倣う）。
    const items = Array.from(totalsByFoodId.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([foodId, totalGrams]) => buildItem(foodId, totalGrams));

    return { weekStartDate, items };
  }

  return { buildForWeek };
}
