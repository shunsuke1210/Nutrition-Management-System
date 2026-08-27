import { describe, expect, it } from "vitest";
import { ENERGY_DENSITY_KCAL_PER_KG } from "./constants.js";
import { calculateDietModeTargetCalorie } from "./diet-mode.calculator.js";

/**
 * design.md #DietModeCalculator (Requirements 8.1, 8.3)
 *
 * 期待値は design.md の計算式から手計算で導出する:
 *   dailyCalorieAdjustment = (currentWeightKg - goalWeightKg) * ENERGY_DENSITY_KCAL_PER_KG / (goalPeriodWeeks * 7)
 *   targetCalorie = tdee - dailyCalorieAdjustment
 *
 * ENERGY_DENSITY_KCAL_PER_KG は constants.ts の値（7700）を用いる。数値をハードコードせず
 * 定数を import して前提を明示する（テストが constants.ts の値とズレて誤って通過しないため）。
 *
 * 減量方向のケースは goalPeriodWeeks に 1100（= ENERGY_DENSITY_KCAL_PER_KG / 7）の約数
 * （10, 20 等）を用いることで、割り算の結果が浮動小数点誤差なしの整数になるようにし、
 * `toBe` による厳密一致を可能にしている。加えて、1100の約数ではない goalPeriodWeeks=6 の
 * ケースを追加し、"/(goalPeriodWeeks * 7)" の除算が単純に割り切れる値だけでなく、割り切れない
 * 現実的な期間でも正しく計算されることを確認する。
 */
describe("calculateDietModeTargetCalorie", () => {
  it("前提: ENERGY_DENSITY_KCAL_PER_KG は constants.ts で 7700 と定義されている", () => {
    expect(ENERGY_DENSITY_KCAL_PER_KG).toBe(7700);
  });

  describe("減量方向（goalWeightKg < currentWeightKg, Requirement 8.1）", () => {
    it("currentWeightKg=80, goalWeightKg=70, goalPeriodWeeks=10, tdee=2500 → targetCalorie=1400", () => {
      // dailyCalorieAdjustment = (80 - 70) * 7700 / (10 * 7) = 77000 / 70 = 1100
      // targetCalorie = 2500 - 1100 = 1400
      const result = calculateDietModeTargetCalorie(80, 70, 10, 2500);

      expect(result).toBe(1400);
      expect(result).toBeLessThan(2500); // 減量方向 → targetCalorie < tdee
    });

    it("currentWeightKg=88, goalWeightKg=80, goalPeriodWeeks=6（1100の約数ではない）, tdee=2600 → targetCalorie≈1133.333", () => {
      // dailyCalorieAdjustment = (88 - 80) * 7700 / (6 * 7) = 61600 / 42 = 1466.6666666666667
      // targetCalorie = 2600 - 1466.6666666666667 = 1133.3333333333333
      const result = calculateDietModeTargetCalorie(88, 80, 6, 2600);

      expect(result).toBeCloseTo(1133.333333333, 6);
      expect(result).toBeLessThan(2600); // 減量方向 → targetCalorie < tdee
    });
  });

  describe("維持方向（goalWeightKg === currentWeightKg, Requirement 8.3）", () => {
    it("currentWeightKg=65, goalWeightKg=65, goalPeriodWeeks=8, tdee=2200 → dailyCalorieAdjustmentが厳密に0となりtargetCalorie===tdee", () => {
      // dailyCalorieAdjustment = (65 - 65) * 7700 / (8 * 7) = 0
      // targetCalorie = 2200 - 0 = 2200
      const result = calculateDietModeTargetCalorie(65, 65, 8, 2200);

      expect(result).toBe(2200);
    });
  });

  describe("増量方向（goalWeightKg > currentWeightKg, Requirement 8.3）", () => {
    it("currentWeightKg=60, goalWeightKg=65, goalPeriodWeeks=20, tdee=2000 → targetCalorie=2275", () => {
      // dailyCalorieAdjustment = (60 - 65) * 7700 / (20 * 7) = -38500 / 140 = -275
      // targetCalorie = 2000 - (-275) = 2275
      const result = calculateDietModeTargetCalorie(60, 65, 20, 2000);

      expect(result).toBe(2275);
      expect(result).toBeGreaterThan(2000); // 増量方向 → targetCalorie > tdee
    });
  });
});
