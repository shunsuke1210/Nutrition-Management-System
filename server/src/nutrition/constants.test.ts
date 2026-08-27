import { describe, expect, it } from "vitest";
import {
  ACTIVITY_COEFFICIENT_BASE,
  ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT,
  ACTIVITY_COEFFICIENT_MAX,
  ACTIVITY_COEFFICIENT_MET,
  ACTIVITY_COEFFICIENT_MIN,
  ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS,
  ENERGY_DENSITY_KCAL_PER_KG,
  MAX_WEEKLY_LOSS_PACE_RATIO,
  MIFFLIN_GENDER_OFFSET,
  MIN_CALORIE_FLOOR,
  PFC_BASE_RATIO,
  PFC_RATIO_ADJUSTMENT_TABLE,
} from "./constants.js";

// design.md (BmrCalculator セクション): Mifflin-St Jeor式の性別オフセット
describe("MIFFLIN_GENDER_OFFSET", () => {
  it("男性のオフセットが5である", () => {
    expect(MIFFLIN_GENDER_OFFSET.male).toBe(5);
  });

  it("女性のオフセットが-161である", () => {
    expect(MIFFLIN_GENDER_OFFSET.female).toBe(-161);
  });

  it("回答しないのオフセットが男女平均の-78である", () => {
    expect(MIFFLIN_GENDER_OFFSET.undisclosed).toBe(-78);
  });
});

// design.md (ActivityCoefficientCalculator セクション): 計算式ブロック
describe("ACTIVITY_COEFFICIENT_BASE", () => {
  it("mostly_sedentaryのベース係数が1.20である", () => {
    expect(ACTIVITY_COEFFICIENT_BASE.mostly_sedentary).toBe(1.2);
  });

  it("mixedのベース係数が1.375である", () => {
    expect(ACTIVITY_COEFFICIENT_BASE.mixed).toBe(1.375);
  });

  it("mostly_activeのベース係数が1.55である", () => {
    expect(ACTIVITY_COEFFICIENT_BASE.mostly_active).toBe(1.55);
  });
});

describe("ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT", () => {
  it("walk_or_bikeの補正が+0.05である", () => {
    expect(ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT.walk_or_bike).toBe(0.05);
  });

  it("transitの補正が+0.025である", () => {
    expect(ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT.transit).toBe(0.025);
  });

  it("carの補正が+0.00である", () => {
    expect(ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT.car).toBe(0.0);
  });
});

describe("ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS", () => {
  it("5段階の歩数補正テーブルを持つ", () => {
    expect(ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS).toHaveLength(5);
  });

  it("5,000未満の階層が+0.000である", () => {
    expect(ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS[0]).toEqual({
      minSteps: 0,
      maxSteps: 5000,
      adjustment: 0.0,
    });
  });

  it("5,000-7,499の階層が+0.025である", () => {
    expect(ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS[1]).toEqual({
      minSteps: 5000,
      maxSteps: 7500,
      adjustment: 0.025,
    });
  });

  it("7,500-9,999の階層が+0.050である", () => {
    expect(ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS[2]).toEqual({
      minSteps: 7500,
      maxSteps: 10000,
      adjustment: 0.05,
    });
  });

  it("10,000-12,499の階層が+0.075である", () => {
    expect(ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS[3]).toEqual({
      minSteps: 10000,
      maxSteps: 12500,
      adjustment: 0.075,
    });
  });

  it("12,500以上の階層が+0.100である", () => {
    expect(ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS[4]).toEqual({
      minSteps: 12500,
      maxSteps: null,
      adjustment: 0.1,
    });
  });
});

describe("ACTIVITY_COEFFICIENT_MET", () => {
  it("lightのMET値が3.0である", () => {
    expect(ACTIVITY_COEFFICIENT_MET.light).toBe(3.0);
  });

  it("moderateのMET値が4.5である", () => {
    expect(ACTIVITY_COEFFICIENT_MET.moderate).toBe(4.5);
  });

  it("vigorousのMET値が7.0である", () => {
    expect(ACTIVITY_COEFFICIENT_MET.vigorous).toBe(7.0);
  });
});

describe("活動係数のクランプ範囲", () => {
  it("下限が1.20である", () => {
    expect(ACTIVITY_COEFFICIENT_MIN).toBe(1.2);
  });

  it("上限が1.90である", () => {
    expect(ACTIVITY_COEFFICIENT_MAX).toBe(1.9);
  });
});

// design.md (PfcCalculator セクション): ベース比率と11行の調整テーブル
describe("PFC_BASE_RATIO", () => {
  it("protein: 0.15, fat: 0.25, carb: 0.60 である", () => {
    expect(PFC_BASE_RATIO).toEqual({ protein: 0.15, fat: 0.25, carb: 0.6 });
  });
});

describe("PFC_RATIO_ADJUSTMENT_TABLE", () => {
  it("design.mdの表と同じ11行を持つ", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE).toHaveLength(11);
  });

  it("none: intensity無しでベース比率を維持する", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[0]).toEqual({
      restrictionType: "none",
      restrictionIntensity: null,
      protein: 0.15,
      fat: 0.25,
      carb: 0.6,
    });
  });

  it("calorie_only: intensity無しでベース比率を維持する", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[1]).toEqual({
      restrictionType: "calorie_only",
      restrictionIntensity: null,
      protein: 0.15,
      fat: 0.25,
      carb: 0.6,
    });
  });

  it("low_carb / light", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[2]).toEqual({
      restrictionType: "low_carb",
      restrictionIntensity: "light",
      protein: 0.2,
      fat: 0.35,
      carb: 0.45,
    });
  });

  it("low_carb / standard", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[3]).toEqual({
      restrictionType: "low_carb",
      restrictionIntensity: "standard",
      protein: 0.25,
      fat: 0.4,
      carb: 0.35,
    });
  });

  it("low_carb / strict", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[4]).toEqual({
      restrictionType: "low_carb",
      restrictionIntensity: "strict",
      protein: 0.3,
      fat: 0.5,
      carb: 0.2,
    });
  });

  it("low_fat / light", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[5]).toEqual({
      restrictionType: "low_fat",
      restrictionIntensity: "light",
      protein: 0.18,
      fat: 0.2,
      carb: 0.62,
    });
  });

  it("low_fat / standard", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[6]).toEqual({
      restrictionType: "low_fat",
      restrictionIntensity: "standard",
      protein: 0.2,
      fat: 0.15,
      carb: 0.65,
    });
  });

  it("low_fat / strict", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[7]).toEqual({
      restrictionType: "low_fat",
      restrictionIntensity: "strict",
      protein: 0.2,
      fat: 0.1,
      carb: 0.7,
    });
  });

  it("high_protein / light", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[8]).toEqual({
      restrictionType: "high_protein",
      restrictionIntensity: "light",
      protein: 0.25,
      fat: 0.25,
      carb: 0.5,
    });
  });

  it("high_protein / standard", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[9]).toEqual({
      restrictionType: "high_protein",
      restrictionIntensity: "standard",
      protein: 0.3,
      fat: 0.25,
      carb: 0.45,
    });
  });

  it("high_protein / strict", () => {
    expect(PFC_RATIO_ADJUSTMENT_TABLE[10]).toEqual({
      restrictionType: "high_protein",
      restrictionIntensity: "strict",
      protein: 0.35,
      fat: 0.25,
      carb: 0.4,
    });
  });

  it("各行のprotein+fat+carbの合計が1に等しい（丸め誤差1e-9まで許容）", () => {
    for (const row of PFC_RATIO_ADJUSTMENT_TABLE) {
      expect(row.protein + row.fat + row.carb).toBeCloseTo(1, 9);
    }
  });
});

// design.md (DietModeCalculator セクション): エネルギー収支換算定数
describe("ENERGY_DENSITY_KCAL_PER_KG", () => {
  it("体重1kgあたり7700kcalである", () => {
    expect(ENERGY_DENSITY_KCAL_PER_KG).toBe(7700);
  });
});

// design.md (GuardrailEvaluator セクション): 安全ガードレール閾値
describe("MIN_CALORIE_FLOOR", () => {
  it("男性の最低摂取カロリー基準が1500kcalである", () => {
    expect(MIN_CALORIE_FLOOR.male).toBe(1500);
  });

  it("女性の最低摂取カロリー基準が1200kcalである", () => {
    expect(MIN_CALORIE_FLOOR.female).toBe(1200);
  });

  it("回答しないの最低摂取カロリー基準が1500kcalである", () => {
    expect(MIN_CALORIE_FLOOR.undisclosed).toBe(1500);
  });
});

describe("MAX_WEEKLY_LOSS_PACE_RATIO", () => {
  it("現在の体重の1%/週である", () => {
    expect(MAX_WEEKLY_LOSS_PACE_RATIO).toBe(0.01);
  });
});
