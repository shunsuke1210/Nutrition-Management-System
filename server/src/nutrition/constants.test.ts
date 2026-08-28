import { describe, expect, it } from "vitest";
import {
  ACTIVITY_COEFFICIENT_BASE,
  ACTIVITY_COEFFICIENT_COMMUTE_ADJUSTMENT,
  ACTIVITY_COEFFICIENT_MAX,
  ACTIVITY_COEFFICIENT_MET,
  ACTIVITY_COEFFICIENT_MIN,
  ACTIVITY_COEFFICIENT_STEP_ADJUSTMENT_TIERS,
  ENERGY_DENSITY_KCAL_PER_KG,
  EXERCISE_SIMULATION_SCENARIO,
  HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG,
  MAX_WEEKLY_LOSS_PACE_RATIO,
  MIFFLIN_GENDER_OFFSET,
  MIN_CALORIE_FLOOR,
  PFC_BASE_RATIO,
  PFC_RATIO_ADJUSTMENT_TABLE,
  PLATEAU_PACE_RATIO_THRESHOLD,
  SMOKING_VITAMIN_C_ADDITION_MG,
  WEIGHT_PROJECTION_HORIZON_WEEKS,
  WEIGHT_TREND_LONG_WINDOW_DAYS,
  WEIGHT_TREND_MIN_DATA_POINTS,
  WEIGHT_TREND_MIN_SPAN_DAYS,
  WEIGHT_TREND_SHORT_WINDOW_DAYS,
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

// design.md (MicronutrientCalculator セクション, Requirements 6.3, 6.4): 喫煙・飲酒習慣による固定加算量
describe("SMOKING_VITAMIN_C_ADDITION_MG", () => {
  it("喫煙者向けビタミンC固定加算量が35mgである（出典: IOM/National Academies DRI）", () => {
    expect(SMOKING_VITAMIN_C_ADDITION_MG).toBe(35);
  });
});

describe("HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG", () => {
  it("多量飲酒者向けビタミンB1固定加算量が0.5mgである（一次資料に確立した固定値がないための暫定値、要専門家レビュー）", () => {
    expect(HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG).toBe(0.5);
  });
});

// design.md (DietInsightsCalculator セクション, Requirements 14.3-14.6, 15.1-15.4, 16.1-16.5, 17.1-17.5):
// 体重推移分析・停滞判定・運動併用シミュレーション関連の定数
describe("WEIGHT_TREND_LONG_WINDOW_DAYS", () => {
  it("傾向分析の長期ウィンドウが56日（8週間）である", () => {
    expect(WEIGHT_TREND_LONG_WINDOW_DAYS).toBe(56);
  });
});

describe("WEIGHT_TREND_SHORT_WINDOW_DAYS", () => {
  it("停滞判定の短期ウィンドウが14日（2週間）である", () => {
    expect(WEIGHT_TREND_SHORT_WINDOW_DAYS).toBe(14);
  });
});

describe("WEIGHT_TREND_MIN_DATA_POINTS", () => {
  it("傾向分析等に必要な最小体重記録点数が2件である", () => {
    expect(WEIGHT_TREND_MIN_DATA_POINTS).toBe(2);
  });
});

describe("WEIGHT_TREND_MIN_SPAN_DAYS", () => {
  it("傾向分析等に必要な最初と最後の記録日の最小間隔が14日である", () => {
    expect(WEIGHT_TREND_MIN_SPAN_DAYS).toBe(14);
  });
});

describe("WEIGHT_PROJECTION_HORIZON_WEEKS", () => {
  it("将来体重予測の外挿期間が4週間である", () => {
    expect(WEIGHT_PROJECTION_HORIZON_WEEKS).toBe(4);
  });
});

describe("PLATEAU_PACE_RATIO_THRESHOLD", () => {
  it("減量停滞判定の閾値が0.30（短期ペースが長期ペースの30%未満で停滞）である", () => {
    expect(PLATEAU_PACE_RATIO_THRESHOLD).toBe(0.3);
  });
});

describe("EXERCISE_SIMULATION_SCENARIO", () => {
  it("週3回・30分・中強度（moderate）の固定シナリオである", () => {
    expect(EXERCISE_SIMULATION_SCENARIO).toEqual({
      frequencyPerWeek: 3,
      durationMinutes: 30,
      intensity: "moderate",
    });
  });

  it("intensityがACTIVITY_COEFFICIENT_METの既存キーと一致し、MET値4.5を再定義せずそのまま参照できる", () => {
    expect(ACTIVITY_COEFFICIENT_MET[EXERCISE_SIMULATION_SCENARIO.intensity]).toBe(4.5);
  });
});

// design.md #DietInsightsCalculator 17.4: ENERGY_DENSITY_KCAL_PER_KGおよびMET値(moderate: 4.5)を
// 再定義せず、DietInsightsCalculator（task 6.3以降）からそのまま参照できることを確認する
describe("DietInsightsCalculatorが参照する既存定数（再定義しないことの確認）", () => {
  it("ENERGY_DENSITY_KCAL_PER_KGが7700kcal/kgのままである", () => {
    expect(ENERGY_DENSITY_KCAL_PER_KG).toBe(7700);
  });

  it("ACTIVITY_COEFFICIENT_MET.moderateが4.5のままである", () => {
    expect(ACTIVITY_COEFFICIENT_MET.moderate).toBe(4.5);
  });
});
