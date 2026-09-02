import { describe, expect, it, vi } from "vitest";
import type {
  CalculationUnavailableError,
  GuardrailResult,
  IsoDate,
  MicronutrientTargets,
  NutritionSummary,
  PfcTargets,
} from "@nutrition/shared";
import type { Result } from "../shared/result.js";
import type { NutritionService } from "../nutrition/nutrition.service.js";
import { createNutritionGateway } from "./nutrition.gateway.js";

/**
 * design.md #NutritionGateway (Requirements 1.5, 4.5, 12.2)
 *
 * `NutritionGateway` は `nutrition-engine` の `NutritionService.getSummary(date)` を
 * プロセス内で呼び出し、その結果を `NutritionTargetSnapshot` へ射影する薄いアダプタである。
 *
 * `NutritionService` 自体の正しさ（各計算モジュールのオーケストレーション）は
 * `nutrition-engine` spec の `nutrition.service.test.ts` で既に検証済みのため、本テストは
 * `NutritionGateway` 自身のロジック（mode選択・射影・エラー伝播）のみを、フェイクの
 * `NutritionService` を用いて検証する（`profile.gateway.test.ts` と同じ方針）。
 */

const TEST_DATE: IsoDate = "2026-01-08";

/** `NutritionGateway` の唯一の依存を差し替えるための、挙動を固定したフェイク。 */
function createFakeNutritionService(
  getSummaryResult: Result<NutritionSummary, CalculationUnavailableError>
): NutritionService {
  return {
    getSummary: () => getSummaryResult,
    getDietInsights: () => {
      throw new Error(
        "createFakeNutritionService: getDietInsights is not used by NutritionGateway tests"
      );
    },
  };
}

/** 全9項目を独立して持つ、有効な `MicronutrientTargets`。 */
function buildMicronutrients(): MicronutrientTargets {
  return {
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
}

/** `normalMode.pfc` 用の、`dietMode.pfc` と値がすべて異なる `PfcTargets`。 */
function buildNormalModePfc(): PfcTargets {
  return {
    proteinG: 150,
    fatG: 70,
    carbG: 220,
    proteinKcal: 600,
    fatKcal: 630,
    carbKcal: 880,
  };
}

/** `dietMode.pfc` 用の、`normalMode.pfc` と値がすべて異なる `PfcTargets`。 */
function buildDietModePfc(): PfcTargets {
  return {
    proteinG: 170,
    fatG: 50,
    carbG: 150,
    proteinKcal: 680,
    fatKcal: 450,
    carbKcal: 600,
  };
}

/** 2件の異なる `type` を持つ警告を含む `GuardrailResult`。 */
function buildGuardrails(): GuardrailResult {
  return {
    warnings: [
      {
        type: "min_calorie_floor",
        message: "目標カロリーが下限を下回っています。",
        suggestions: [{ kind: "extend_period", suggestedGoalPeriodWeeks: 16 }],
      },
      {
        type: "max_weekly_loss_pace",
        message: "週あたりの減量ペースが上限を超えています。",
        suggestions: [{ kind: "ease_goal_weight", suggestedGoalWeightKg: 62 }],
      },
    ],
  };
}

/**
 * `normalMode` と `dietMode` の値が（`calorieTarget`/`pfc`/`guardrails`のいずれについても）
 * 互いに区別できるよう構築した、完全な `NutritionSummary`。
 */
function buildSummary(overrides: Partial<NutritionSummary> = {}): NutritionSummary {
  return {
    computedAt: "2026-01-08T00:00:00.000Z",
    bmr: 1500,
    activityCoefficient: 1.55,
    activityLevelLabel: "ふつう",
    tdee: 2325,
    dailyExpenditure: { date: TEST_DATE, value: 2325 },
    normalMode: {
      calorieTarget: 2200,
      pfcRatio: { proteinPct: 0.3, fatPct: 0.3, carbPct: 0.4 },
      pfc: buildNormalModePfc(),
      micronutrients: buildMicronutrients(),
    },
    dietMode: {
      calorieTarget: 1800,
      pfcRatio: { proteinPct: 0.35, fatPct: 0.25, carbPct: 0.4 },
      pfc: buildDietModePfc(),
      guardrails: buildGuardrails(),
    },
    ...overrides,
  };
}

describe("createNutritionGateway", () => {
  describe("nutrition-engineがCalculationUnavailableErrorを返す場合（Requirement 12.2）", () => {
    it.each<CalculationUnavailableError["reason"]>(["profile_missing", "diet_mode_disabled"])(
      "reason=%s のエラーを変換・再ラップせずそのまま伝播する",
      (reason) => {
        const error: CalculationUnavailableError = {
          type: "calculation_unavailable",
          reason,
          message: `テスト用エラー（${reason}）`,
        };
        const nutritionService = createFakeNutritionService({ ok: false, error });
        const gateway = createNutritionGateway(nutritionService);

        const result = gateway.getTargetsForDate(TEST_DATE);

        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected ok:false");
        }
        // 変換・再ラップされていないことを、参照の同一性で確認する。
        expect(result.error).toBe(error);
        expect(result.error).toEqual(error);
      }
    );
  });

  describe("dietModeが非nullの場合（Requirements 1.5, 4.5）", () => {
    it("calorieTarget/pfc/guardrailWarningTypesはdietModeの値から導出され、normalModeの値は使用しない", () => {
      const summary = buildSummary();
      const nutritionService = createFakeNutritionService({ ok: true, value: summary });
      const gateway = createNutritionGateway(nutritionService);

      const result = gateway.getTargetsForDate(TEST_DATE);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected ok:true");
      }
      expect(result.value.calorieTarget).toBe(summary.dietMode?.calorieTarget);
      expect(result.value.calorieTarget).not.toBe(summary.normalMode.calorieTarget);
      expect(result.value.pfc).toEqual({
        proteinG: summary.dietMode?.pfc.proteinG,
        fatG: summary.dietMode?.pfc.fatG,
        carbG: summary.dietMode?.pfc.carbG,
      });
      expect(result.value.guardrailWarningTypes).toEqual(["min_calorie_floor", "max_weekly_loss_pace"]);
    });

    it("activityLevelLabelはトップレベルのNutritionSummary.activityLevelLabelから取得する", () => {
      const summary = buildSummary({ activityLevelLabel: "健康的" });
      const nutritionService = createFakeNutritionService({ ok: true, value: summary });
      const gateway = createNutritionGateway(nutritionService);

      const result = gateway.getTargetsForDate(TEST_DATE);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected ok:true");
      }
      expect(result.value.activityLevelLabel).toBe("健康的");
    });
  });

  describe("dietModeがnullの場合", () => {
    it("calorieTarget/pfcはnormalModeの値から導出され、guardrailWarningTypesは空配列になる", () => {
      const summary = buildSummary({ dietMode: null });
      const nutritionService = createFakeNutritionService({ ok: true, value: summary });
      const gateway = createNutritionGateway(nutritionService);

      const result = gateway.getTargetsForDate(TEST_DATE);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected ok:true");
      }
      expect(result.value.calorieTarget).toBe(summary.normalMode.calorieTarget);
      expect(result.value.pfc).toEqual({
        proteinG: summary.normalMode.pfc.proteinG,
        fatG: summary.normalMode.pfc.fatG,
        carbG: summary.normalMode.pfc.carbG,
      });
      expect(result.value.guardrailWarningTypes).toEqual([]);
    });

    it("activityLevelLabelはdietModeが存在しなくてもトップレベルの値から取得する", () => {
      const summary = buildSummary({ dietMode: null, activityLevelLabel: "運動不足" });
      const nutritionService = createFakeNutritionService({ ok: true, value: summary });
      const gateway = createNutritionGateway(nutritionService);

      const result = gateway.getTargetsForDate(TEST_DATE);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected ok:true");
      }
      expect(result.value.activityLevelLabel).toBe("運動不足");
    });
  });

  describe("pfcの射影完全性", () => {
    it("pfcはproteinG/fatG/carbGの3フィールドのみを含み、nutrition-engineの6フィールド形状を漏らさない", () => {
      const summary = buildSummary();
      const nutritionService = createFakeNutritionService({ ok: true, value: summary });
      const gateway = createNutritionGateway(nutritionService);

      const result = gateway.getTargetsForDate(TEST_DATE);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected ok:true");
      }
      expect(Object.keys(result.value.pfc).sort()).toEqual(["carbG", "fatG", "proteinG"]);
      expect(result.value.pfc).not.toHaveProperty("proteinKcal");
      expect(result.value.pfc).not.toHaveProperty("fatKcal");
      expect(result.value.pfc).not.toHaveProperty("carbKcal");
    });
  });

  describe("guardrailWarningTypesの抽出", () => {
    it("dietMode.guardrails.warningsが2件以上ある場合、それぞれのtypeを順序通り抽出する", () => {
      const summary = buildSummary();
      const nutritionService = createFakeNutritionService({ ok: true, value: summary });
      const gateway = createNutritionGateway(nutritionService);

      const result = gateway.getTargetsForDate(TEST_DATE);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected ok:true");
      }
      expect(result.value.guardrailWarningTypes).toEqual(
        summary.dietMode?.guardrails.warnings.map((w) => w.type)
      );
      expect(result.value.guardrailWarningTypes).toHaveLength(2);
    });
  });

  describe("呼び出しの委譲", () => {
    it("getSummaryへ渡すdateをそのまま透過する", () => {
      const summary = buildSummary();
      const getSummary = vi.fn().mockReturnValue({ ok: true, value: summary });
      const nutritionService: NutritionService = {
        getSummary,
        getDietInsights: () => {
          throw new Error("not used");
        },
      };
      const gateway = createNutritionGateway(nutritionService);

      gateway.getTargetsForDate(TEST_DATE);

      expect(getSummary).toHaveBeenCalledWith(TEST_DATE);
      expect(getSummary).toHaveBeenCalledTimes(1);
    });
  });

  describe("決定性", () => {
    it("同一の日付・同一のフェイク設定で2回呼び出すと、同一の結果を返す", () => {
      const summary = buildSummary();
      const nutritionService = createFakeNutritionService({ ok: true, value: summary });
      const gateway = createNutritionGateway(nutritionService);

      const first = gateway.getTargetsForDate(TEST_DATE);
      const second = gateway.getTargetsForDate(TEST_DATE);

      expect(first).toEqual(second);
    });
  });
});
