/**
 * UnitConversionService — 分量と単位をグラムへ正規化する。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #UnitConversionService、
 * Requirements 5.2, 5.3, 5.4）に定義されたService Interfaceをそのまま実装する。
 *
 * 解決順序（Responsibilities & Constraints）:
 *   1. `unitCode === "g"` の場合、`quantity` をそのままグラムとして返す。この場合、
 *      `unit_conversions` テーブル（`FoodCompositionRepository` の単位ルックアップ2メソッド）
 *      には一切アクセスしない
 *   2. gram以外の単位について、`(foodId, unitCode)` に一致する食材固有のエントリが存在すれば
 *      それを優先して使用する（5.2）。この場合、汎用エントリの参照は行わない（短絡評価）
 *   3. 食材固有のエントリが存在しない場合、`(null, unitCode)` の汎用エントリが存在すれば
 *      それを使用する（5.3）
 *   4. いずれのエントリも存在しない場合は `VerificationError(type: "unit_not_found")` を
 *      返す（5.4）
 *
 * `VerificationError` はdesign.mdの `NutritionVerificationService` セクション（task 3.3、
 * 本タスク時点では未実装）と型を共有する。design.mdのContractsマーカー
 * （`Service [x] / API [ ] / ...`）がHTTP境界を持たないService専用の内部契約であることに
 * 対応し、`shared/src/menu.schema.ts`（Zodスキーマ）には追加せず、ここでexportした型を
 * task 3.3が本ファイルからimportする想定とする（`food-composition.repository.ts` の
 * 「internal contracts stay local」規約に倣う）。
 *
 * `quantity` が正の数値であることはdesign.mdが呼び出し側のprecondition（責務）として
 * 明記しているため、`BmrCalculator` 等の既存precedentに倣い、本Service内では
 * 非正値に対する防御的な再検証を行わない。
 */
import type { Result } from "../shared/result.js";
import type { FoodCompositionRepository } from "./food-composition.repository.js";

/** design.md #NutritionVerificationService Service Interface（`UnitConversionService`と共有）。 */
export type VerificationErrorType = "food_id_not_found" | "unit_not_found";

/** design.md #NutritionVerificationService Service Interface（`UnitConversionService`と共有）。 */
export interface VerificationError {
  type: VerificationErrorType;
  message: string;
  foodId?: string;
  unit?: string;
}

/** design.md #UnitConversionService Service Interface。 */
export interface UnitConversionService {
  toGrams(foodId: string, quantity: number, unitCode: string): Result<number, VerificationError>;
}

const GRAM_UNIT_CODE = "g";

/**
 * `repository`（既に構築済みの `FoodCompositionRepository`。実装またはテスト用フェイク）
 * に対する `UnitConversionService` を生成する。`createFoodCompositionRepository`
 * （`food-composition.repository.ts`）と同じDIファクトリ関数パターンに揃えており、
 * 本Serviceは自らDBコネクションを構築せず、渡された `repository` の
 * `findUnitConversion` / `findGenericUnitConversion` のみを呼び出す。
 */
export function createUnitConversionService(
  repository: FoodCompositionRepository
): UnitConversionService {
  function toGrams(
    foodId: string,
    quantity: number,
    unitCode: string
  ): Result<number, VerificationError> {
    if (unitCode === GRAM_UNIT_CODE) {
      return { ok: true, value: quantity };
    }

    const foodSpecificEntry = repository.findUnitConversion(foodId, unitCode);
    if (foodSpecificEntry) {
      return { ok: true, value: quantity * foodSpecificEntry.gramsPerUnit };
    }

    const genericEntry = repository.findGenericUnitConversion(unitCode);
    if (genericEntry) {
      return { ok: true, value: quantity * genericEntry.gramsPerUnit };
    }

    return {
      ok: false,
      error: {
        type: "unit_not_found",
        message: `単位 "${unitCode}" に対する換算エントリが見つかりません（食品ID: ${foodId}）`,
        foodId,
        unit: unitCode,
      },
    };
  }

  return { toGrams };
}
