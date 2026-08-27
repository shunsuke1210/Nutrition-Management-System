import { describe, expect, it } from "vitest";
import {
  calculateActivityCoefficient,
  type ActivityCoefficientInput,
} from "./activity-coefficient.calculator.js";

/**
 * design.md #ActivityCoefficientCalculator (Requirements 1.1, 1.2, 1.4, 1.5)
 *
 * 期待値は design.md の計算式ブロックから手計算で導出する:
 *   BaseCoefficient(jobActivityLevel) = mostly_sedentary: 1.20 | mixed: 1.375 | mostly_active: 1.55
 *   CommuteAdjustment(commuteMethod) = walk_or_bike: +0.05 | transit: +0.025 | car: +0.00
 *   StepAdjustment(averageDailySteps) =
 *     null または <5,000: +0.000 | 5,000-7,499: +0.025 | 7,500-9,999: +0.050 |
 *     10,000-12,499: +0.075 | >=12,500: +0.100
 *   MET(intensity) = light: 3.0 | moderate: 4.5 | vigorous: 7.0
 *   weeklyExerciseKcal = Σ [ MET(intensity) × 3.5 × weightKg / 200 × durationMinutes × frequencyPerWeek ]
 *   ExerciseAdjustment = (weeklyExerciseKcal / 7) / bmr
 *   ActivityCoefficient = clamp(Base + Commute + Step + Exercise, 1.20, 1.90)
 *
 * Requirement 1.3（jobActivityLevel/commuteMethod欠落時の算出不可判定）は
 * design.mdの`ActivityCoefficientCalculator` Responsibilities & Constraints、および
 * `BmrCalculator`（task 2.1）で確立された同様のパターンにより、本コンポーネントではなく
 * `NutritionService`の責務であるため、本テストの対象外とする（型システムの非nullフィールドが
 * 型レベルでの防御を担う）。
 */

// 3コンポーネント共通の「他の補正をゼロに保つ」ための中立入力
const NEUTRAL: Pick<
  ActivityCoefficientInput,
  "commuteMethod" | "averageDailySteps" | "exerciseRoutine" | "weightKg" | "bmr"
> = {
  commuteMethod: "car",
  averageDailySteps: null,
  exerciseRoutine: [],
  weightKg: 65,
  bmr: 1500,
};

describe("calculateActivityCoefficient", () => {
  describe("jobActivityLevel のベース係数（Requirement 1.1）", () => {
    it("mostly_sedentary: ベース1.20（他の補正すべてゼロ、クランプ下限と偶然一致するがクランプ由来ではない）", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mostly_sedentary",
        ...NEUTRAL,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(1.2, 9);
    });

    it("mixed: ベース1.375", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(1.375, 9);
    });

    it("mostly_active: ベース1.55", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mostly_active",
        ...NEUTRAL,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(1.55, 9);
    });
  });

  describe("commuteMethod の加算補正（Requirement 1.1）", () => {
    // jobActivityLevel=mixed（1.375、範囲の中間）で分離する
    it("walk_or_bike: 1.375 + 0.05 = 1.425", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        commuteMethod: "walk_or_bike",
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(1.425, 9);
    });

    it("transit: 1.375 + 0.025 = 1.400", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        commuteMethod: "transit",
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(1.4, 9);
    });

    it("car: 1.375 + 0.00 = 1.375", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        commuteMethod: "car",
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(1.375, 9);
    });
  });

  describe("averageDailySteps の階層境界値（Requirement 1.4, 1.5 半開区間 [min, max) の判定）", () => {
    // jobActivityLevel=mixed（1.375）+ commute=car（+0）で歩数補正のみを分離する
    const base = 1.375;

    it("averageDailySteps=null: 補正+0.000（未登録はゼロ扱い, Requirement 1.4）", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: null,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.0, 9);
    });

    it("4999歩（5,000未満）: 補正+0.000", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: 4999,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.0, 9);
    });

    it("5000歩（境界: 5,000以上）: 補正+0.025", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: 5000,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.025, 9);
    });

    it("7499歩（7,500未満）: 補正+0.025", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: 7499,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.025, 9);
    });

    it("7500歩（境界: 7,500以上）: 補正+0.050", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: 7500,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.05, 9);
    });

    it("9999歩（10,000未満）: 補正+0.050", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: 9999,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.05, 9);
    });

    it("10000歩（境界: 10,000以上）: 補正+0.075", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: 10000,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.075, 9);
    });

    it("12499歩（12,500未満）: 補正+0.075", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: 12499,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.075, 9);
    });

    it("12500歩（境界: 12,500以上）: 補正+0.100", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        averageDailySteps: 12500,
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(base + 0.1, 9);
    });
  });

  describe("exerciseRoutine（週間運動量）の消費カロリー加算（Requirement 1.1, 1.4）", () => {
    it("空配列: 補正ゼロ（週間運動量が0件の場合はゼロ扱い, Requirement 1.4）", () => {
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mixed",
        ...NEUTRAL,
        exerciseRoutine: [],
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(1.375, 9);
    });

    it("2行の運動量: weeklyExerciseKcal / ExerciseAdjustment を手計算した値と一致する", () => {
      // row1: MET(moderate)=4.5, weightKg=70, durationMinutes=30, frequencyPerWeek=3
      //   4.5 × 3.5 × 70 / 200 × 30 × 3 = 496.125
      // row2: MET(vigorous)=7.0, weightKg=70, durationMinutes=60, frequencyPerWeek=1
      //   7.0 × 3.5 × 70 / 200 × 60 × 1 = 514.5
      // weeklyExerciseKcal = 496.125 + 514.5 = 1010.625
      // ExerciseAdjustment = (1010.625 / 7) / 1600 = 144.375 / 1600 = 0.090234375
      // total = BaseCoefficient(mostly_sedentary)=1.20 + Commute(car)=0 + Step(null)=0 + 0.090234375
      //       = 1.290234375
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mostly_sedentary",
        commuteMethod: "car",
        averageDailySteps: null,
        weightKg: 70,
        bmr: 1600,
        exerciseRoutine: [
          {
            scene: "after_work",
            content: "ジョギング",
            frequencyPerWeek: 3,
            durationMinutes: 30,
            intensity: "moderate",
          },
          {
            scene: "holiday",
            content: "サイクリング",
            frequencyPerWeek: 1,
            durationMinutes: 60,
            intensity: "vigorous",
          },
        ],
      };
      expect(calculateActivityCoefficient(input)).toBeCloseTo(1.290234375, 9);
    });
  });

  describe("クランプ [1.20, 1.90]（Requirement 1.5）", () => {
    it("極端に高い入力（クランプ無しなら1.90を明確に超過する）: 結果はちょうど1.90にクランプされる", () => {
      // Base(mostly_active)=1.55 + Commute(walk_or_bike)=0.05 + Step(>=12500)=0.10 = 1.70
      // exercise: MET(vigorous)=7.0, weightKg=100, durationMinutes=120, frequencyPerWeek=7
      //   7.0 × 3.5 × 100 / 200 × 120 × 7 = 10290
      // ExerciseAdjustment = (10290 / 7) / 1000 = 1470 / 1000 = 1.47
      // クランプ前の合計 = 1.70 + 1.47 = 3.17 (> 1.90 を明確に超過)
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mostly_active",
        commuteMethod: "walk_or_bike",
        averageDailySteps: 15000,
        weightKg: 100,
        bmr: 1000,
        exerciseRoutine: [
          {
            scene: "holiday",
            content: "高強度トレーニング",
            frequencyPerWeek: 7,
            durationMinutes: 120,
            intensity: "vigorous",
          },
        ],
      };
      expect(calculateActivityCoefficient(input)).toBe(1.9);
    });

    it("最小構成の入力（ベース最小 + 補正すべてゼロ）はクランプ下限1.20と一致する", () => {
      // BaseCoefficient(mostly_sedentary)=1.20 が最小値であり、CommuteAdjustment・
      // StepAdjustment・ExerciseAdjustmentはいずれも負値を取り得ない（design.mdの式は
      // 加算のみで構成され、MET・weightKg・durationMinutes・frequencyPerWeekはいずれも
      // 正の値のみを取るため weeklyExerciseKcal は常に0以上）。したがって1.20を下回る
      // 入力は設計上構成不可能であり、この最小構成ケースがクランプ下限との一致を確認する
      // 唯一の到達可能なケースである。
      const input: ActivityCoefficientInput = {
        jobActivityLevel: "mostly_sedentary",
        ...NEUTRAL,
      };
      expect(calculateActivityCoefficient(input)).toBe(1.2);
    });
  });
});
