import { describe, expect, it } from "vitest";
import { calculatePfcRatio, calculatePfcTargets } from "./pfc.calculator.js";
import type { PfcRatio, RestrictionIntensity, RestrictionType } from "@nutrition/shared";

/**
 * design.md #PfcCalculator (Requirements 5.1, 5.2, 5.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.1, 9.2)
 *
 * 期待値は design.md の PFC比率調整テーブル（11行）から独立に転記する（`constants.ts` の
 * `PFC_RATIO_ADJUSTMENT_TABLE` を読み込んで比較する形にはしない。それではテーブル自体に
 * 誤りがあった場合にテストがすり抜けてしまう「同語反復」になるため、design.md 本文の表を
 * このテストファイル内で独立に再現する）。
 *
 *   | restrictionType | intensity | protein | fat | carb |
 *   |---|---|---|---|---|
 *   | none | - | 0.15 | 0.25 | 0.60 |
 *   | calorie_only | - | 0.15 | 0.25 | 0.60 |
 *   | low_carb | light | 0.20 | 0.35 | 0.45 |
 *   | low_carb | standard | 0.25 | 0.40 | 0.35 |
 *   | low_carb | strict | 0.30 | 0.50 | 0.20 |
 *   | low_fat | light | 0.18 | 0.20 | 0.62 |
 *   | low_fat | standard | 0.20 | 0.15 | 0.65 |
 *   | low_fat | strict | 0.20 | 0.10 | 0.70 |
 *   | high_protein | light | 0.25 | 0.25 | 0.50 |
 *   | high_protein | standard | 0.30 | 0.25 | 0.45 |
 *   | high_protein | strict | 0.35 | 0.25 | 0.40 |
 *
 * グラム換算はAtwater係数（たんぱく質4kcal/g、脂質9kcal/g、炭水化物4kcal/g）を用いる。
 */

interface AdjustedRow {
  restrictionType: RestrictionType;
  restrictionIntensity: RestrictionIntensity | null;
  expected: PfcRatio;
}

// design.md PfcCalculator の11行の調整テーブルをそのまま転記する
const ADJUSTED_ROWS: AdjustedRow[] = [
  {
    restrictionType: "low_carb",
    restrictionIntensity: "light",
    expected: { proteinPct: 0.2, fatPct: 0.35, carbPct: 0.45 },
  },
  {
    restrictionType: "low_carb",
    restrictionIntensity: "standard",
    expected: { proteinPct: 0.25, fatPct: 0.4, carbPct: 0.35 },
  },
  {
    restrictionType: "low_carb",
    restrictionIntensity: "strict",
    expected: { proteinPct: 0.3, fatPct: 0.5, carbPct: 0.2 },
  },
  {
    restrictionType: "low_fat",
    restrictionIntensity: "light",
    expected: { proteinPct: 0.18, fatPct: 0.2, carbPct: 0.62 },
  },
  {
    restrictionType: "low_fat",
    restrictionIntensity: "standard",
    expected: { proteinPct: 0.2, fatPct: 0.15, carbPct: 0.65 },
  },
  {
    restrictionType: "low_fat",
    restrictionIntensity: "strict",
    expected: { proteinPct: 0.2, fatPct: 0.1, carbPct: 0.7 },
  },
  {
    restrictionType: "high_protein",
    restrictionIntensity: "light",
    expected: { proteinPct: 0.25, fatPct: 0.25, carbPct: 0.5 },
  },
  {
    restrictionType: "high_protein",
    restrictionIntensity: "standard",
    expected: { proteinPct: 0.3, fatPct: 0.25, carbPct: 0.45 },
  },
  {
    restrictionType: "high_protein",
    restrictionIntensity: "strict",
    expected: { proteinPct: 0.35, fatPct: 0.25, carbPct: 0.4 },
  },
];

const BASE_RATIO: PfcRatio = { proteinPct: 0.15, fatPct: 0.25, carbPct: 0.6 };

// calculatePfcTargets の網羅チェックに用いる全11行（none/calorie_only含む）
const ALL_ROWS: AdjustedRow[] = [
  { restrictionType: "none", restrictionIntensity: null, expected: BASE_RATIO },
  { restrictionType: "calorie_only", restrictionIntensity: null, expected: BASE_RATIO },
  ...ADJUSTED_ROWS,
];

function expectRatioCloseTo(actual: PfcRatio, expected: PfcRatio): void {
  expect(actual.proteinPct).toBeCloseTo(expected.proteinPct, 9);
  expect(actual.fatPct).toBeCloseTo(expected.fatPct, 9);
  expect(actual.carbPct).toBeCloseTo(expected.carbPct, 9);
}

describe("calculatePfcRatio", () => {
  describe("restrictionType='none'（Requirement 7.3: 強度に関わらずベース比率を維持する）", () => {
    it("restrictionIntensity=null: ベース比率(0.15/0.25/0.60)を返す", () => {
      expectRatioCloseTo(calculatePfcRatio("none", null), BASE_RATIO);
    });

    it("restrictionIntensity='strict'（非null）が渡ってもベース比率を維持する", () => {
      expectRatioCloseTo(calculatePfcRatio("none", "strict"), BASE_RATIO);
    });
  });

  describe("restrictionType='calorie_only'（Requirement 7.3: 強度に関わらずベース比率を維持する）", () => {
    it("restrictionIntensity=null: ベース比率(0.15/0.25/0.60)を返す", () => {
      expectRatioCloseTo(calculatePfcRatio("calorie_only", null), BASE_RATIO);
    });

    it("restrictionIntensity='strict'（非null）が渡ってもベース比率を維持する", () => {
      expectRatioCloseTo(calculatePfcRatio("calorie_only", "strict"), BASE_RATIO);
    });
  });

  describe("低糖質・低脂質・高たんぱく × 強度の全9組み合わせ（Requirements 7.1, 7.2）", () => {
    it.each(ADJUSTED_ROWS)(
      "$restrictionType × $restrictionIntensity: 調整テーブル通りの比率を返す",
      ({ restrictionType, restrictionIntensity, expected }) => {
        expectRatioCloseTo(
          calculatePfcRatio(restrictionType, restrictionIntensity),
          expected,
        );
      },
    );
  });

  describe("各比率の3値の合計が1であること", () => {
    it.each(ALL_ROWS)(
      "$restrictionType × $restrictionIntensity: proteinPct + fatPct + carbPct = 1",
      ({ restrictionType, restrictionIntensity }) => {
        const ratio = calculatePfcRatio(restrictionType, restrictionIntensity);
        expect(ratio.proteinPct + ratio.fatPct + ratio.carbPct).toBeCloseTo(1, 9);
      },
    );
  });

  describe("restrictionType!=='none'/'calorie_only' に restrictionIntensity=null が渡った場合（契約違反）", () => {
    // `restrictionIntensity` の型は `RestrictionIntensity | null` であり、`null` は
    // どの `restrictionType` に対しても型キャスト無しでそのまま渡せる。
    // `user-profile` の `ProfileInputSchema.superRefine` により `restrictionType !== "none"`
    // の場合は `restrictionIntensity` が必須（非null）として上流で保証されるはずだが、
    // その契約が破られた場合に本モジュールが誤った比率を静かに返さず例外を投げることを
    // `low_carb` / `low_fat` / `high_protein` の3タイプそれぞれについて検証する
    // （各タイプはテーブル上で異なる行集合を持つため、ガード条件が全タイプで機能することを
    // 個別に確認する必要がある）。
    const invalidTypes: RestrictionType[] = ["low_carb", "low_fat", "high_protein"];

    it.each(invalidTypes)(
      "restrictionType='%s' × restrictionIntensity=null は例外を投げる",
      (restrictionType) => {
        expect(() => calculatePfcRatio(restrictionType, null)).toThrow();
      },
    );

    it("投げられる例外メッセージに restrictionType と restrictionIntensity の値が含まれる", () => {
      try {
        calculatePfcRatio("low_carb", null);
        expect.unreachable("calculatePfcRatio は例外を投げるはずである");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("low_carb");
      }
    });
  });
});

describe("calculatePfcTargets", () => {
  describe("手計算による個別ケースの検証（Atwater係数: protein=4kcal/g, fat=9kcal/g, carb=4kcal/g）", () => {
    it("ベース比率 × calorieTarget=2000: protein=300kcal/75g, fat=500kcal/55.555...g, carb=1200kcal/300g", () => {
      const targets = calculatePfcTargets(2000, BASE_RATIO);

      expect(targets.proteinKcal).toBeCloseTo(300, 9);
      expect(targets.fatKcal).toBeCloseTo(500, 9);
      expect(targets.carbKcal).toBeCloseTo(1200, 9);
      expect(targets.proteinG).toBeCloseTo(75, 9);
      expect(targets.fatG).toBeCloseTo(500 / 9, 9);
      expect(targets.carbG).toBeCloseTo(300, 9);
    });

    it("low_carb/strict比率(0.30/0.50/0.20) × calorieTarget=1800", () => {
      const ratio: PfcRatio = { proteinPct: 0.3, fatPct: 0.5, carbPct: 0.2 };
      const targets = calculatePfcTargets(1800, ratio);

      // proteinKcal = 1800 × 0.30 = 540, proteinG = 540 / 4 = 135
      // fatKcal = 1800 × 0.50 = 900, fatG = 900 / 9 = 100
      // carbKcal = 1800 × 0.20 = 360, carbG = 360 / 4 = 90
      expect(targets.proteinKcal).toBeCloseTo(540, 9);
      expect(targets.proteinG).toBeCloseTo(135, 9);
      expect(targets.fatKcal).toBeCloseTo(900, 9);
      expect(targets.fatG).toBeCloseTo(100, 9);
      expect(targets.carbKcal).toBeCloseTo(360, 9);
      expect(targets.carbG).toBeCloseTo(90, 9);
    });

    it("high_protein/light比率(0.25/0.25/0.50) × calorieTarget=2500（ダイエットモード目標カロリー想定）", () => {
      const ratio: PfcRatio = { proteinPct: 0.25, fatPct: 0.25, carbPct: 0.5 };
      const targets = calculatePfcTargets(2500, ratio);

      // proteinKcal = 625, proteinG = 156.25
      // fatKcal = 625, fatG = 69.444...
      // carbKcal = 1250, carbG = 312.5
      expect(targets.proteinKcal).toBeCloseTo(625, 9);
      expect(targets.proteinG).toBeCloseTo(156.25, 9);
      expect(targets.fatKcal).toBeCloseTo(625, 9);
      expect(targets.fatG).toBeCloseTo(625 / 9, 9);
      expect(targets.carbKcal).toBeCloseTo(1250, 9);
      expect(targets.carbG).toBeCloseTo(312.5, 9);
    });

    it("low_fat/strict比率(0.20/0.10/0.70) × calorieTarget=1500（低カロリーのダイエットモード想定）", () => {
      const ratio: PfcRatio = { proteinPct: 0.2, fatPct: 0.1, carbPct: 0.7 };
      const targets = calculatePfcTargets(1500, ratio);

      // proteinKcal = 300, proteinG = 75
      // fatKcal = 150, fatG = 16.666...
      // carbKcal = 1050, carbG = 262.5
      expect(targets.proteinKcal).toBeCloseTo(300, 9);
      expect(targets.proteinG).toBeCloseTo(75, 9);
      expect(targets.fatKcal).toBeCloseTo(150, 9);
      expect(targets.fatG).toBeCloseTo(150 / 9, 9);
      expect(targets.carbKcal).toBeCloseTo(1050, 9);
      expect(targets.carbG).toBeCloseTo(262.5, 9);
    });
  });

  describe("換算後のPFC目標カロリー合計が目標カロリーと一致する（許容誤差±1kcal, Requirements 5.3, 7.5）", () => {
    it.each(ALL_ROWS)(
      "$restrictionType × $restrictionIntensity のテーブル比率で calorieTarget=2000 の場合、kcal合計との差が±1kcal以内",
      ({ expected }) => {
        const targets = calculatePfcTargets(2000, expected);
        const sumKcal = targets.proteinKcal + targets.fatKcal + targets.carbKcal;
        expect(Math.abs(sumKcal - 2000)).toBeLessThanOrEqual(1);
      },
    );

    it.each(ALL_ROWS)(
      "$restrictionType × $restrictionIntensity のテーブル比率で calorieTarget=1234.5（非整数カロリー）の場合、kcal合計との差が±1kcal以内",
      ({ expected }) => {
        const targets = calculatePfcTargets(1234.5, expected);
        const sumKcal = targets.proteinKcal + targets.fatKcal + targets.carbKcal;
        expect(Math.abs(sumKcal - 1234.5)).toBeLessThanOrEqual(1);
      },
    );

    it.each([500, 1200, 1500, 1800, 2000, 2500, 3200])(
      "様々なcalorieTarget=%i（全11行ループ）でkcal合計との差が±1kcal以内",
      (calorieTarget) => {
        for (const row of ALL_ROWS) {
          const targets = calculatePfcTargets(calorieTarget, row.expected);
          const sumKcal = targets.proteinKcal + targets.fatKcal + targets.carbKcal;
          expect(Math.abs(sumKcal - calorieTarget)).toBeLessThanOrEqual(1);
        }
      },
    );
  });
});
