/**
 * NutritionVerificationService — 選択された食品ID・分量・単位から実際の栄養価
 * （エネルギー・PFC・主要な微量栄養素9項目）を計算し、日次合計・目標値との差分を算出する。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #NutritionVerificationService、
 * Requirements 4.3, 4.4, 4.5, 4.6, 4.7）に定義されたService Interfaceをそのまま実装する。
 *
 * チェック順序（task 3.3の設計判断、`verifyDish` 内の各食材について）:
 *   まず `FoodCompositionRepository.findById(foodId)` で食品IDの実在を確認し
 *   （存在しなければ即座に `food_id_not_found` を返す）、その後にのみ
 *   `UnitConversionService.toGrams` を呼び出して単位解決を行う。
 *   この順序を逆にする（先に `toGrams` を呼ぶ）と、`unitCode` が `"g"` の場合に
 *   `UnitConversionService.toGrams`（task 3.2）が `"g"` を特別扱いして
 *   `FoodCompositionRepository` に一切アクセスせず成功してしまうため、
 *   存在しない食品IDが `"g"` 単位と組み合わさったケースを、単位解決の成功という
 *   副作用によって誤って見逃してしまう。食品ID実在確認を独立したpreconditionとして
 *   最初に行うことで、要件4.6（「食品IDが実在しない場合」）の判定を
 *   単位解決ロジックの内部実装に依存させずに済む。
 *
 * `FoodItemNutrition.per100g` の微量栄養素9項目は食品によって `null`（未収載）
 * でありうるため、合算時は `null` を0として扱う（過小評価側に倒す設計、design.md
 * Responsibilities & Constraints、Revalidation Triggers参照）。基本4項目
 * （`energyKcal`/`proteinG`/`fatG`/`carbG`）は `food_items` のNOT NULL制約により
 * 常に非null値だが、`?? 0` を13項目すべてに一律適用しても実害はなく、コードが単純になる。
 *
 * `VerificationError` / `VerificationErrorType` は `unit-conversion.service.ts`
 * （task 3.2）がexportする型をそのまま再利用し、本ファイルでは再定義しない。
 */
import type { IngredientSelection, VerifiedNutritionValues } from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type { FoodCompositionRepository } from "./food-composition.repository.js";
import type { UnitConversionService, VerificationError } from "./unit-conversion.service.js";

export type { VerificationError, VerificationErrorType } from "./unit-conversion.service.js";

/** design.md #NutritionVerificationService Service Interface。 */
export interface NutritionVerificationService {
  verifyDish(ingredients: IngredientSelection[]): Result<VerifiedNutritionValues, VerificationError>;
  verifyDay(mealNutritionValues: VerifiedNutritionValues[]): VerifiedNutritionValues;
  computeVarianceKcal(actualKcal: number, targetKcal: number): number;
}

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

/**
 * `repository` / `unitConversionService`（いずれも既に構築済みの依存）に対する
 * `NutritionVerificationService` を生成する。`createUnitConversionService`
 * （`unit-conversion.service.ts`）と同じDIファクトリ関数パターンに揃えており、
 * 本Serviceは依存を自ら構築せず、渡されたインスタンスのみを利用する。
 */
export function createNutritionVerificationService(
  repository: FoodCompositionRepository,
  unitConversionService: UnitConversionService
): NutritionVerificationService {
  function verifyDish(
    ingredients: IngredientSelection[]
  ): Result<VerifiedNutritionValues, VerificationError> {
    const total: VerifiedNutritionValues = { ...ZERO_NUTRITION };

    for (const ingredient of ingredients) {
      // 1. 食品IDの実在確認を、単位解決より先に行う（チェック順序の設計判断、ファイル冒頭コメント参照）。
      const food = repository.findById(ingredient.foodId);
      if (!food) {
        return {
          ok: false,
          error: {
            type: "food_id_not_found",
            message: `食品ID "${ingredient.foodId}" は食品成分参照データに存在しません`,
            foodId: ingredient.foodId,
          },
        };
      }

      // 2. 単位をグラムに正規化する。失敗した場合はUnitConversionServiceのエラーをそのまま返す
      //    （再ラップしない。design.md Postconditionsの「部分的な計算結果を返さない」に従い、
      //    ここまでの合算値も一切返さない）。
      const gramsResult = unitConversionService.toGrams(
        ingredient.foodId,
        ingredient.quantity,
        ingredient.unit
      );
      if (!gramsResult.ok) {
        return gramsResult;
      }

      // 3. per100gあたりの栄養価を実際のグラム量にスケールして合算する。
      const factor = gramsResult.value / 100;
      const per100g = food.per100g;

      total.energyKcal += per100g.energyKcal * factor;
      total.proteinG += per100g.proteinG * factor;
      total.fatG += per100g.fatG * factor;
      total.carbG += per100g.carbG * factor;
      total.fiberG += (per100g.fiberG ?? 0) * factor;
      total.calciumMg += (per100g.calciumMg ?? 0) * factor;
      total.ironMg += (per100g.ironMg ?? 0) * factor;
      total.vitaminAUg += (per100g.vitaminAUg ?? 0) * factor;
      total.vitaminDUg += (per100g.vitaminDUg ?? 0) * factor;
      total.vitaminB1Mg += (per100g.vitaminB1Mg ?? 0) * factor;
      total.vitaminB2Mg += (per100g.vitaminB2Mg ?? 0) * factor;
      total.vitaminCMg += (per100g.vitaminCMg ?? 0) * factor;
      total.saltEquivalentG += (per100g.saltEquivalentG ?? 0) * factor;
    }

    return { ok: true, value: total };
  }

  function verifyDay(mealNutritionValues: VerifiedNutritionValues[]): VerifiedNutritionValues {
    // design.mdのコメントは「4食枠分」と述べるが、本関数自体は配列長を仮定・検証しない
    // （その不変条件は、配列を組み立てる後続タスクの呼び出し元の責務とする）。
    const total: VerifiedNutritionValues = { ...ZERO_NUTRITION };
    for (const meal of mealNutritionValues) {
      total.energyKcal += meal.energyKcal;
      total.proteinG += meal.proteinG;
      total.fatG += meal.fatG;
      total.carbG += meal.carbG;
      total.fiberG += meal.fiberG;
      total.calciumMg += meal.calciumMg;
      total.ironMg += meal.ironMg;
      total.vitaminAUg += meal.vitaminAUg;
      total.vitaminDUg += meal.vitaminDUg;
      total.vitaminB1Mg += meal.vitaminB1Mg;
      total.vitaminB2Mg += meal.vitaminB2Mg;
      total.vitaminCMg += meal.vitaminCMg;
      total.saltEquivalentG += meal.saltEquivalentG;
    }
    return total;
  }

  function computeVarianceKcal(actualKcal: number, targetKcal: number): number {
    // 符号規約: actualKcal - targetKcal（実績が目標を超過していれば正、下回っていれば負）。
    // design.mdは符号の向きを明示していないため、実績と目標の差分表現として一般的な
    // 「実績 - 目標」（超過=プラス、不足=マイナス）を採用した。呼び出し元（後続タスクの
    // MenuPlanService等）が逆の符号を期待している場合は、この関数の1行を反転するだけで
    // 修正できる。
    return actualKcal - targetKcal;
  }

  return { verifyDish, verifyDay, computeVarianceKcal };
}
