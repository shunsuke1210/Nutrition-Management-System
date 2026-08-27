import { describe, expect, it } from "vitest";
import type { MicronutrientTargets } from "@nutrition/shared";
import {
  HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG,
  SMOKING_VITAMIN_C_ADDITION_MG,
} from "./constants.js";
import { calculateMicronutrientTargets, maxMicronutrientTargets } from "./micronutrient.calculator.js";

/**
 * design.md #MicronutrientCalculator (Requirements 6.1, 6.2, 6.3, 6.4, 6.5)
 *
 * 期待値は「日本人の食事摂取基準（2020年版）」の実データ（本タスクの実装時に、厚生労働省が
 * 公表した早見表を一次資料として確認のうえ転記したもの。詳細な出典は
 * `micronutrient-reference.data.ts` 冒頭のコメントを参照）を、`pfc.calculator.test.ts` と
 * 同様の方針により `micronutrient-reference.data.ts` を読み込んで比較する形にはせず、
 * このテストファイル内で独立に転記する（テーブル自体の転記ミスがテストをすり抜ける
 * 「同語反復」を避けるため）。
 */

const MALE_18_29: MicronutrientTargets = {
  vitaminAUg: 850,
  vitaminDUg: 8.5,
  vitaminB1Mg: 1.4,
  vitaminB2Mg: 1.6,
  vitaminCMg: 100,
  calciumMg: 800,
  ironMg: 7.5,
  fiberG: 21,
  saltEquivalentUpperLimitG: 7.5,
};
const MALE_30_49: MicronutrientTargets = {
  vitaminAUg: 900,
  vitaminDUg: 8.5,
  vitaminB1Mg: 1.4,
  vitaminB2Mg: 1.6,
  vitaminCMg: 100,
  calciumMg: 750,
  ironMg: 7.5,
  fiberG: 21,
  saltEquivalentUpperLimitG: 7.5,
};
const MALE_50_64: MicronutrientTargets = {
  vitaminAUg: 900,
  vitaminDUg: 8.5,
  vitaminB1Mg: 1.3,
  vitaminB2Mg: 1.5,
  vitaminCMg: 100,
  calciumMg: 750,
  ironMg: 7.5,
  fiberG: 21,
  saltEquivalentUpperLimitG: 7.5,
};
const MALE_65_74: MicronutrientTargets = {
  vitaminAUg: 850,
  vitaminDUg: 8.5,
  vitaminB1Mg: 1.3,
  vitaminB2Mg: 1.5,
  vitaminCMg: 100,
  calciumMg: 750,
  ironMg: 7.5,
  fiberG: 20,
  saltEquivalentUpperLimitG: 7.5,
};
const MALE_75_PLUS: MicronutrientTargets = {
  vitaminAUg: 800,
  vitaminDUg: 8.5,
  vitaminB1Mg: 1.2,
  vitaminB2Mg: 1.3,
  vitaminCMg: 100,
  calciumMg: 700,
  ironMg: 7.0,
  fiberG: 20,
  saltEquivalentUpperLimitG: 7.5,
};

const FEMALE_18_29: MicronutrientTargets = {
  vitaminAUg: 650,
  vitaminDUg: 8.5,
  vitaminB1Mg: 1.1,
  vitaminB2Mg: 1.2,
  vitaminCMg: 100,
  calciumMg: 650,
  ironMg: 6.5,
  fiberG: 18,
  saltEquivalentUpperLimitG: 6.5,
};
const FEMALE_65_74: MicronutrientTargets = {
  vitaminAUg: 700,
  vitaminDUg: 8.5,
  vitaminB1Mg: 1.1,
  vitaminB2Mg: 1.2,
  vitaminCMg: 100,
  calciumMg: 650,
  ironMg: 6.0,
  fiberG: 17,
  saltEquivalentUpperLimitG: 6.5,
};
const FEMALE_75_PLUS: MicronutrientTargets = {
  vitaminAUg: 650,
  vitaminDUg: 8.5,
  vitaminB1Mg: 0.9,
  vitaminB2Mg: 1.0,
  vitaminCMg: 100,
  calciumMg: 600,
  ironMg: 6.0,
  fiberG: 17,
  saltEquivalentUpperLimitG: 6.5,
};

describe("calculateMicronutrientTargets - 年齢区分の境界値（Requirement 6.2）", () => {
  it("18歳・男性: 18-29区分（下限）", () => {
    expect(calculateMicronutrientTargets("male", 18, null, null)).toEqual(MALE_18_29);
  });

  it("29歳・男性: 18-29区分", () => {
    expect(calculateMicronutrientTargets("male", 29, null, null)).toEqual(MALE_18_29);
  });

  it("30歳・男性: 30-49区分（境界）", () => {
    expect(calculateMicronutrientTargets("male", 30, null, null)).toEqual(MALE_30_49);
  });

  it("49歳・男性: 30-49区分", () => {
    expect(calculateMicronutrientTargets("male", 49, null, null)).toEqual(MALE_30_49);
  });

  it("50歳・男性: 50-64区分（境界）", () => {
    expect(calculateMicronutrientTargets("male", 50, null, null)).toEqual(MALE_50_64);
  });

  it("64歳・男性: 50-64区分", () => {
    expect(calculateMicronutrientTargets("male", 64, null, null)).toEqual(MALE_50_64);
  });

  it("65歳・男性: 65-74区分（境界）", () => {
    expect(calculateMicronutrientTargets("male", 65, null, null)).toEqual(MALE_65_74);
  });

  it("74歳・男性: 65-74区分", () => {
    expect(calculateMicronutrientTargets("male", 74, null, null)).toEqual(MALE_65_74);
  });

  it("75歳・男性: 75以上区分（境界）", () => {
    expect(calculateMicronutrientTargets("male", 75, null, null)).toEqual(MALE_75_PLUS);
  });

  it("90歳・男性: 75以上区分", () => {
    expect(calculateMicronutrientTargets("male", 90, null, null)).toEqual(MALE_75_PLUS);
  });

  it("10歳（成人未満）・男性: 参照テーブルの最小区分である18-29に分類する（本spec対象外の年齢に対する安全側の既定動作）", () => {
    expect(calculateMicronutrientTargets("male", 10, null, null)).toEqual(MALE_18_29);
  });
});

describe("calculateMicronutrientTargets - 性別ごとの基準値ルックアップ（Requirement 6.1, 6.2）", () => {
  it("女性・18-29区分", () => {
    expect(calculateMicronutrientTargets("female", 25, null, null)).toEqual(FEMALE_18_29);
  });

  it("女性・65-74区分", () => {
    expect(calculateMicronutrientTargets("female", 70, null, null)).toEqual(FEMALE_65_74);
  });

  it("女性・75以上区分", () => {
    expect(calculateMicronutrientTargets("female", 80, null, null)).toEqual(FEMALE_75_PLUS);
  });
});

describe('calculateMicronutrientTargets - 性別「回答しない」（design.md: 「該当年齢区分の男女基準値のうち大きい方を採用する」＋食塩相当量の例外）', () => {
  it("saltEquivalentUpperLimitG以外の8項目は、実データでは男性の基準値が女性以上のため男性の値と一致する（18-29, 65-74, 75以上の3区分で確認）", () => {
    expect(calculateMicronutrientTargets("undisclosed", 25, null, null)).toEqual({
      ...MALE_18_29,
      saltEquivalentUpperLimitG: FEMALE_18_29.saltEquivalentUpperLimitG,
    });
    expect(calculateMicronutrientTargets("undisclosed", 70, null, null)).toEqual({
      ...MALE_65_74,
      saltEquivalentUpperLimitG: FEMALE_65_74.saltEquivalentUpperLimitG,
    });
    expect(calculateMicronutrientTargets("undisclosed", 80, null, null)).toEqual({
      ...MALE_75_PLUS,
      saltEquivalentUpperLimitG: FEMALE_75_PLUS.saltEquivalentUpperLimitG,
    });
  });

  it("saltEquivalentUpperLimitG（食塩相当量の上限）は、実データでは女性の基準値が男性以下（より厳しい）ため、女性の値と一致する（他8項目とは逆に、大きい方ではなく小さい方＝より保護的な上限を採用する例外）", () => {
    const undisclosed18_29 = calculateMicronutrientTargets("undisclosed", 25, null, null);
    const undisclosed65_74 = calculateMicronutrientTargets("undisclosed", 70, null, null);
    const undisclosed75Plus = calculateMicronutrientTargets("undisclosed", 80, null, null);

    expect(undisclosed18_29.saltEquivalentUpperLimitG).toBe(FEMALE_18_29.saltEquivalentUpperLimitG);
    expect(undisclosed18_29.saltEquivalentUpperLimitG).toBeLessThan(MALE_18_29.saltEquivalentUpperLimitG);

    expect(undisclosed65_74.saltEquivalentUpperLimitG).toBe(FEMALE_65_74.saltEquivalentUpperLimitG);
    expect(undisclosed65_74.saltEquivalentUpperLimitG).toBeLessThan(MALE_65_74.saltEquivalentUpperLimitG);

    expect(undisclosed75Plus.saltEquivalentUpperLimitG).toBe(FEMALE_75_PLUS.saltEquivalentUpperLimitG);
    expect(undisclosed75Plus.saltEquivalentUpperLimitG).toBeLessThan(MALE_75_PLUS.saltEquivalentUpperLimitG);
  });
});

describe("maxMicronutrientTargets - 項目ごとに大小が男女で入れ替わるケース（8項目はper-nutrient max・食塩相当量のみper-nutrient min, ロジック検証専用の合成データ）", () => {
  it("実データでは男性が全項目で女性以上になるため区別できない「行単位で大きい方/小さい方を選ぶ」実装との違いを、項目ごとに大小が逆転する合成データで検証する", () => {
    // 以下は実際の栄養基準値ではない、ロジック検証専用の合成データ。
    // male は iron/fiber 以外の項目で female を上回るが、iron/fiber は female の方が大きい。
    // saltEquivalentUpperLimitG は male の方が大きい（＝より緩い上限）。
    const male: MicronutrientTargets = {
      vitaminAUg: 900,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.4,
      vitaminB2Mg: 1.6,
      vitaminCMg: 100,
      calciumMg: 800,
      ironMg: 5.0, // female の方が大きい
      fiberG: 15, // female の方が大きい
      saltEquivalentUpperLimitG: 7.5, // female より大きい（＝より緩い上限）
    };
    const female: MicronutrientTargets = {
      vitaminAUg: 650,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.1,
      vitaminB2Mg: 1.2,
      vitaminCMg: 100,
      calciumMg: 650,
      ironMg: 9.0, // male より大きい
      fiberG: 20, // male より大きい
      saltEquivalentUpperLimitG: 6.5, // male より小さい（＝より厳しい上限）
    };

    // 「行単位でどちらかの性別を選ぶ」実装であれば male 行 または female 行のいずれかが
    // まるごと返るはずだが、期待値はどちらの行とも一致しない（項目ごとの混合値）。
    // saltEquivalentUpperLimitG は他8項目と逆方向（Math.min）であることも同時に検証する:
    // もし誤って Math.max を適用していれば 7.5 になってしまうところ、正しい実装は
    // より厳しい 6.5（female）を返すはずである。
    expect(maxMicronutrientTargets(male, female)).toEqual({
      vitaminAUg: 900, // male (max)
      vitaminDUg: 8.5, // 同値
      vitaminB1Mg: 1.4, // male (max)
      vitaminB2Mg: 1.6, // male (max)
      vitaminCMg: 100, // 同値
      calciumMg: 800, // male (max)
      ironMg: 9.0, // female (max)
      fiberG: 20, // female (max)
      saltEquivalentUpperLimitG: 6.5, // female (min) ← 他8項目とは逆に小さい方
    });
  });
});

describe("calculateMicronutrientTargets - 喫煙習慣によるビタミンC加算（Requirement 6.3）", () => {
  it("smokingHabit='smoker': ビタミンC目標が SMOKING_VITAMIN_C_ADDITION_MG 分だけ増加し、他の項目は変化しない", () => {
    const base = calculateMicronutrientTargets("male", 35, null, null);
    const withSmoking = calculateMicronutrientTargets("male", 35, "smoker", null);

    expect(withSmoking.vitaminCMg).toBeCloseTo(base.vitaminCMg + SMOKING_VITAMIN_C_ADDITION_MG, 9);
    expect({ ...withSmoking, vitaminCMg: base.vitaminCMg }).toEqual(base);
  });
});

describe("calculateMicronutrientTargets - 飲酒習慣によるビタミンB1加算（Requirement 6.4）", () => {
  it("alcoholHabit='frequent': ビタミンB1目標が HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG 分だけ増加し、他の項目は変化しない", () => {
    const base = calculateMicronutrientTargets("female", 40, null, null);
    const withDrinking = calculateMicronutrientTargets("female", 40, null, "frequent");

    expect(withDrinking.vitaminB1Mg).toBeCloseTo(
      base.vitaminB1Mg + HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG,
      9,
    );
    expect({ ...withDrinking, vitaminB1Mg: base.vitaminB1Mg }).toEqual(base);
  });
});

describe("calculateMicronutrientTargets - 加算されないケース（Requirement 6.5、および喫煙側の対称ケース）", () => {
  it("smoking: non_smoker/null, alcohol: occasional/none/null のいずれの組み合わせでも基準値のまま変化しない", () => {
    const base = calculateMicronutrientTargets("male", 35, null, null);

    expect(calculateMicronutrientTargets("male", 35, "non_smoker", null)).toEqual(base);
    expect(calculateMicronutrientTargets("male", 35, null, "occasional")).toEqual(base);
    expect(calculateMicronutrientTargets("male", 35, null, "none")).toEqual(base);
    expect(calculateMicronutrientTargets("male", 35, "non_smoker", "occasional")).toEqual(base);
    expect(calculateMicronutrientTargets("male", 35, "non_smoker", "none")).toEqual(base);
  });
});

describe("calculateMicronutrientTargets - 喫煙・飲酒の両方が該当する場合", () => {
  it("ビタミンCとビタミンB1の両方がそれぞれの固定量だけ加算される", () => {
    const base = calculateMicronutrientTargets("male", 35, null, null);
    const both = calculateMicronutrientTargets("male", 35, "smoker", "frequent");

    expect(both.vitaminCMg).toBeCloseTo(base.vitaminCMg + SMOKING_VITAMIN_C_ADDITION_MG, 9);
    expect(both.vitaminB1Mg).toBeCloseTo(base.vitaminB1Mg + HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG, 9);
    expect({ ...both, vitaminCMg: base.vitaminCMg, vitaminB1Mg: base.vitaminB1Mg }).toEqual(base);
  });
});
