import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { NutritionSummary, VerifiedNutritionValues } from "@nutrition/shared";
import { NutritionSummarySection } from "./NutritionSummarySection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
afterEach(() => {
  cleanup();
});

// mockup.html (行586-627) の「今日」パネルの数値例と一致させたサンプルデータ。
const NUTRITION_SUMMARY: NutritionSummary = {
  computedAt: "2026-09-01T00:00:00.000Z",
  bmr: 1380,
  activityCoefficient: 1.485,
  activityLevelLabel: "ふつう",
  tdee: 2050,
  dailyExpenditure: { date: "2026-09-01", value: 2050 },
  normalMode: {
    calorieTarget: 2050,
    pfcRatio: { carbPct: 0.56, proteinPct: 0.19, fatPct: 0.25 },
    pfc: {
      carbG: 269,
      proteinG: 98,
      fatG: 57,
      carbKcal: 1076,
      proteinKcal: 392,
      fatKcal: 513,
    },
    micronutrients: {
      vitaminAUg: 850,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.4,
      vitaminB2Mg: 1.6,
      vitaminCMg: 100,
      calciumMg: 650,
      ironMg: 10.5,
      fiberG: 21,
      saltEquivalentUpperLimitG: 7.5,
    },
  },
  dietMode: null,
};

const DAY_NUTRITION: VerifiedNutritionValues = {
  energyKcal: 2000,
  proteinG: 90,
  fatG: 60,
  carbG: 250,
  vitaminAUg: 697, // 82%
  vitaminDUg: 4.675, // 55%
  vitaminB1Mg: 1.064, // 76%
  vitaminB2Mg: 1.28, // 80%
  vitaminCMg: 120, // 120% (over 100%)
  calciumMg: 591.5, // 91%
  ironMg: 7.77, // 74%
  fiberG: 14.28, // 68%
  saltEquivalentG: 6.8,
};

describe("NutritionSummarySection", () => {
  it("renders the energy card with tdee, bmr, and the computed tdee-bmr activity addon (Requirement 1.1)", () => {
    const { container } = render(
      <NutritionSummarySection nutritionSummary={NUTRITION_SUMMARY} dayNutrition={DAY_NUTRITION} />,
    );

    expect(container.textContent).toContain("推奨エネルギー量");
    expect(container.textContent).toContain("2,050");
    expect(container.textContent).toContain("kcal/日");
    expect(container.textContent).toContain("基礎代謝");
    expect(container.textContent).toContain("1,380");
    expect(container.textContent).toContain("活動量による加算");
    expect(container.textContent).toContain("+670");
  });

  it("composes PfcBarChart with normalMode.pfcRatio/pfc sliced from nutritionSummary (Requirement 1.2)", () => {
    const { container } = render(
      <NutritionSummarySection nutritionSummary={NUTRITION_SUMMARY} dayNutrition={DAY_NUTRITION} />,
    );

    // PfcBarChart自身がレンダリングする要素・数値が存在することを確認する
    // （PfcBarChart単体テストと同じ数値でこのコンポーネント自体の配線を証明する）。
    const legendRows = container.querySelectorAll(".pfc-legend .row");
    expect(legendRows.length).toBe(3);
    expect(container.textContent).toContain("炭水化物");
    expect(container.textContent).toContain("269g");
    expect(container.textContent).toContain("56%");

    const segments = container.querySelectorAll(".stack-bar > span");
    expect(segments.length).toBe(3);
  });

  it(
    "composes NutrientSufficiencyList with normalMode.micronutrients (targets) and dayNutrition (actual) " +
      "sliced from props (Requirement 1.3, 1.4)",
    () => {
      const { container } = render(
        <NutritionSummarySection nutritionSummary={NUTRITION_SUMMARY} dayNutrition={DAY_NUTRITION} />,
      );

      const rows = container.querySelectorAll(".nutrient-row");
      expect(rows.length).toBe(9);

      const rowArray = Array.from(rows);
      const vitaminARow = rowArray.find((row) => row.textContent?.includes("ビタミンA"));
      expect(vitaminARow?.querySelector(".pct")?.textContent).toBe("82%");

      // 充足率100%超のビタミンCで実際の値がそのまま表示されること (Requirement 1.4)。
      const vitaminCRow = rowArray.find((row) => row.textContent?.includes("ビタミンC"));
      expect(vitaminCRow?.querySelector(".pct")?.textContent).toBe("120%");
      expect((vitaminCRow?.querySelector(".fill") as HTMLElement).style.width).toBe("100%");

      const saltRow = container.querySelector(".nutrient-row.ceiling");
      expect(saltRow?.textContent).toContain("食塩相当量");
      expect(saltRow?.querySelector(".pct")?.textContent).toBe("6.8/7.5g");
    },
  );
});
