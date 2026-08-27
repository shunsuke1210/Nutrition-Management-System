import { describe, expect, it } from "vitest";
import { calculateBmr, type BmrInput } from "./bmr.calculator.js";

/**
 * design.md #BmrCalculator (Requirements 2.1, 2.2, 2.3, 2.5)
 *
 * 期待値は design.md の計算式から手計算で導出する:
 *   Katch-McArdle（bodyFatPct !== null）:
 *     leanBodyMassKg = weightKg × (1 − bodyFatPct / 100)
 *     bmr = 370 + 21.6 × leanBodyMassKg
 *   Mifflin-St Jeor（bodyFatPct === null）:
 *     bmr = 10 × weightKg + 6.25 × heightCm − 5 × age + MIFFLIN_GENDER_OFFSET[gender]
 *     （MIFFLIN_GENDER_OFFSET: male=5, female=-161, undisclosed=-78）
 *
 * 浮動小数点誤差を吸収するため toBeCloseTo(expected, 9) を用いるが、
 * 期待値そのものは式をそのまま手計算した値であり、実質的に厳密一致を検証する。
 */
describe("calculateBmr", () => {
  describe("体脂肪率が登録されている場合（Katch-McArdle式, Requirement 2.1）", () => {
    it("gender=male: 370 + 21.6 × (70 × (1 − 20/100)) = 1579.6", () => {
      const input: BmrInput = {
        weightKg: 70,
        heightCm: 175,
        age: 30,
        gender: "male",
        bodyFatPct: 20,
      };

      // leanBodyMassKg = 70 × 0.8 = 56, bmr = 370 + 21.6 × 56 = 1579.6
      expect(calculateBmr(input)).toBeCloseTo(1579.6, 9);
    });

    it("gender=female: 370 + 21.6 × (55 × (1 − 25/100)) = 1261", () => {
      const input: BmrInput = {
        weightKg: 55,
        heightCm: 160,
        age: 25,
        gender: "female",
        bodyFatPct: 25,
      };

      // leanBodyMassKg = 55 × 0.75 = 41.25, bmr = 370 + 21.6 × 41.25 = 1261
      expect(calculateBmr(input)).toBeCloseTo(1261, 9);
    });

    it("gender=undisclosed: 370 + 21.6 × (60 × (1 − 15/100)) = 1471.6", () => {
      const input: BmrInput = {
        weightKg: 60,
        heightCm: 168,
        age: 40,
        gender: "undisclosed",
        bodyFatPct: 15,
      };

      // leanBodyMassKg = 60 × 0.85 = 51, bmr = 370 + 21.6 × 51 = 1471.6
      expect(calculateBmr(input)).toBeCloseTo(1471.6, 9);
    });
  });

  describe("体脂肪率が登録されていない場合（Mifflin-St Jeor式, Requirement 2.2, 2.3）", () => {
    it("gender=male: 10×70 + 6.25×175 − 5×30 + 5 = 1648.75", () => {
      const input: BmrInput = {
        weightKg: 70,
        heightCm: 175,
        age: 30,
        gender: "male",
        bodyFatPct: null,
      };

      // 700 + 1093.75 - 150 + 5 = 1648.75
      expect(calculateBmr(input)).toBeCloseTo(1648.75, 9);
    });

    it("gender=female: 10×55 + 6.25×160 − 5×25 − 161 = 1264", () => {
      const input: BmrInput = {
        weightKg: 55,
        heightCm: 160,
        age: 25,
        gender: "female",
        bodyFatPct: null,
      };

      // 550 + 1000 - 125 - 161 = 1264
      expect(calculateBmr(input)).toBeCloseTo(1264, 9);
    });

    it("gender=undisclosed（性別未回答でも算出可能, Requirement 2.3）: 10×65 + 6.25×168 − 5×40 − 78 = 1422", () => {
      const input: BmrInput = {
        weightKg: 65,
        heightCm: 168,
        age: 40,
        gender: "undisclosed",
        bodyFatPct: null,
      };

      // 650 + 1050 - 200 - 78 = 1422
      expect(calculateBmr(input)).toBeCloseTo(1422, 9);
    });
  });

  describe("算出結果が常に正の数値であることを保証する（Requirement 2.5）", () => {
    const cases: Array<{ label: string; input: BmrInput; expected: number }> = [
      {
        label: "Katch-McArdle / male",
        input: { weightKg: 70, heightCm: 175, age: 30, gender: "male", bodyFatPct: 20 },
        expected: 1579.6,
      },
      {
        label: "Katch-McArdle / female",
        input: { weightKg: 55, heightCm: 160, age: 25, gender: "female", bodyFatPct: 25 },
        expected: 1261,
      },
      {
        label: "Katch-McArdle / undisclosed",
        input: { weightKg: 60, heightCm: 168, age: 40, gender: "undisclosed", bodyFatPct: 15 },
        expected: 1471.6,
      },
      {
        label: "Mifflin-St Jeor / male",
        input: { weightKg: 70, heightCm: 175, age: 30, gender: "male", bodyFatPct: null },
        expected: 1648.75,
      },
      {
        label: "Mifflin-St Jeor / female",
        input: { weightKg: 55, heightCm: 160, age: 25, gender: "female", bodyFatPct: null },
        expected: 1264,
      },
      {
        label: "Mifflin-St Jeor / undisclosed",
        input: { weightKg: 65, heightCm: 168, age: 40, gender: "undisclosed", bodyFatPct: null },
        expected: 1422,
      },
    ];

    it.each(cases)("$label の結果が正の数値である", ({ input, expected }) => {
      const bmr = calculateBmr(input);
      expect(bmr).toBeGreaterThan(0);
      expect(bmr).toBeCloseTo(expected, 9);
    });

    it("非現実的な入力（極端な低体重・低身長・高年齢によりMifflin-St Jeor式が負値を導く場合）は内部アサーションにより例外を投げる", () => {
      // 10×1 + 6.25×50 - 5×200 - 161 = 10 + 312.5 - 1000 - 161 = -838.5 (負値)
      const input: BmrInput = {
        weightKg: 1,
        heightCm: 50,
        age: 200,
        gender: "female",
        bodyFatPct: null,
      };

      expect(() => calculateBmr(input)).toThrow();
    });
  });
});
