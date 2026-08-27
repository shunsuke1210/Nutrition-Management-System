/**
 * DietModeCalculator（ダイエットモード目標カロリー逆算モジュール）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `DietModeCalculator` セクション
 * （Requirements 8.1-8.3）に定義された計算式をそのまま実装する純粋関数モジュール。
 *
 * - `dietModeEnabled` が `true` の場合のみ呼び出される（`NutritionService` 側で判定する。
 *   Requirement 8.2「ダイエットモードが無効な場合は通常モードの結果のみを提供し、
 *   ダイエットモードの目標カロリーを算出しない」は、本コンポーネントを呼び出さないことで
 *   表現される — 本コンポーネントが `dietModeEnabled` を入力として受け取ることはない）。
 * - 体重1kgあたり `ENERGY_DENSITY_KCAL_PER_KG`（7700kcal、`constants.ts`）の静的換算定数を
 *   用いて、目標体重差分を日々のカロリー収支に変換する（8.1）。
 * - 目標体重が現在の体重以上の場合、`currentWeightKg - goalWeightKg` が0以下になり
 *   `dailyCalorieAdjustment` も0以下となるため、`targetCalorie = tdee - dailyCalorieAdjustment`
 *   は自然に `tdee` 以上（維持・増量方向）になる（8.3）。方向判定のための特別分岐は不要で、
 *   同一の式がそのまま減量・維持・増量の3方向をすべてカバーする。
 */
import { ENERGY_DENSITY_KCAL_PER_KG } from "./constants.js";

/**
 * ダイエットモードの1日あたり目標カロリーを逆算する
 * （design.md DietModeCalculator Service Interface: `calculateTargetCalorie`）。
 *
 * 計算式（design.md #DietModeCalculator）:
 *   dailyCalorieAdjustment = (currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG / (goalPeriodWeeks * 7)
 *   targetCalorie = tdee - dailyCalorieAdjustment
 *
 * @param currentWeightKg 現在の体重（kg）
 * @param goalWeightKg 目標体重（kg）
 * @param goalPeriodWeeks 目標達成期間（週）
 * @param tdee 総消費カロリー（kcal/day）
 * @returns ダイエットモードの1日あたり目標カロリー（kcal/day）。
 *   減量方向（currentWeightKg > goalWeightKg）では tdee 未満、
 *   維持・増量方向（currentWeightKg <= goalWeightKg）では tdee 以上になる。
 */
export function calculateDietModeTargetCalorie(
  currentWeightKg: number,
  goalWeightKg: number,
  goalPeriodWeeks: number,
  tdee: number,
): number {
  const dailyCalorieAdjustment =
    ((currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG) / (goalPeriodWeeks * 7);

  return tdee - dailyCalorieAdjustment;
}
