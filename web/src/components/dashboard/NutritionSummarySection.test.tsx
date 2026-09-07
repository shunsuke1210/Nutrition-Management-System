import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type {
  DayMenu,
  MealSlot,
  NutritionSummary,
  VerifiedNutritionValues,
  WeekMenuPlan,
} from "@nutrition/shared";
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

// --- 「今週の計画平均」（Requirement 18.2, 18.3）検証用のWeekMenuPlanフィクスチャ ---
// menu.schema.test.ts の validDayMenu/validWeekMenuPlan の precedent に倣う。

function buildVerifiedNutritionValues(
  overrides: Partial<VerifiedNutritionValues> = {},
): VerifiedNutritionValues {
  return {
    energyKcal: 2000,
    proteinG: 90,
    fatG: 60,
    carbG: 250,
    vitaminAUg: 697,
    vitaminDUg: 4.675,
    vitaminB1Mg: 1.064,
    vitaminB2Mg: 1.28,
    vitaminCMg: 120,
    calciumMg: 591.5,
    ironMg: 7.77,
    fiberG: 14.28,
    saltEquivalentG: 6.8,
    ...overrides,
  };
}

function buildMealSlot(overrides: Partial<MealSlot> = {}): MealSlot {
  return {
    mealType: "breakfast",
    dishName: "サンプル料理",
    ingredients: [{ foodId: "11001", quantity: 100, unit: "g" }],
    nutrition: buildVerifiedNutritionValues(),
    ...overrides,
  };
}

function buildDayMenu(dayIndex: number, dayNutrition: VerifiedNutritionValues): DayMenu {
  return {
    dayDate: `2026-09-0${dayIndex + 1}`,
    dayIndex,
    meals: [
      buildMealSlot({ mealType: "breakfast" }),
      buildMealSlot({ mealType: "lunch" }),
      buildMealSlot({ mealType: "dinner" }),
      buildMealSlot({ mealType: "snack" }),
    ],
    dayNutrition,
    plannedKcal: dayNutrition.energyKcal,
    targetKcal: 2050,
    varianceKcal: dayNutrition.energyKcal - 2050,
  };
}

// 意図的に切りの悪い7日分のenergyKcal/vitaminDUgの値を使い、事前計算済みの平均値ではなく
// 実際に「7件の単純平均」が算出されていることを証明する（Requirement 18.3）。
// energyKcal合計=14090 -> 平均2012.857... -> 四捨五入で2,013kcal。
// vitaminDUg合計=51.5 -> 平均7.357142... -> 目標8.5に対する充足率=86.55...% -> 四捨五入で87%。
const WEEK_DAY_OVERRIDES: Partial<VerifiedNutritionValues>[] = [
  { energyKcal: 1980, vitaminDUg: 4.2 },
  { energyKcal: 2015, vitaminDUg: 5.1 },
  { energyKcal: 2030, vitaminDUg: 6.3 },
  { energyKcal: 1995, vitaminDUg: 7.4 },
  { energyKcal: 2040, vitaminDUg: 8.6 },
  { energyKcal: 2005, vitaminDUg: 9.2 },
  { energyKcal: 2025, vitaminDUg: 10.7 },
];

function buildWeekMenuPlan(): WeekMenuPlan {
  const days: DayMenu[] = WEEK_DAY_OVERRIDES.map((overrides, index) =>
    buildDayMenu(index, buildVerifiedNutritionValues(overrides)),
  );
  return {
    weekStartDate: "2026-09-01",
    generatedAt: "2026-09-01T00:00:00.000Z",
    days,
  };
}

const WEEK_PLAN = buildWeekMenuPlan();

describe("NutritionSummarySection", () => {
  describe("period=\"today\" (regression check, task 3.4 behavior unchanged)", () => {
    it("renders the energy card with tdee, bmr, and the computed tdee-bmr activity addon (Requirement 1.1)", () => {
      const { container } = render(
        <NutritionSummarySection
          nutritionSummary={NUTRITION_SUMMARY}
          dayNutrition={DAY_NUTRITION}
          weekPlan={WEEK_PLAN}
          period="today"
          onPeriodChange={vi.fn()}
        />,
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
        <NutritionSummarySection
          nutritionSummary={NUTRITION_SUMMARY}
          dayNutrition={DAY_NUTRITION}
          weekPlan={WEEK_PLAN}
          period="today"
          onPeriodChange={vi.fn()}
        />,
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
          <NutritionSummarySection
            nutritionSummary={NUTRITION_SUMMARY}
            dayNutrition={DAY_NUTRITION}
            weekPlan={WEEK_PLAN}
            period="today"
            onPeriodChange={vi.fn()}
          />,
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

    it("renders the PeriodToggle with today active and week available when weekPlan is provided (Requirement 18.1)", () => {
      const { container } = render(
        <NutritionSummarySection
          nutritionSummary={NUTRITION_SUMMARY}
          dayNutrition={DAY_NUTRITION}
          weekPlan={WEEK_PLAN}
          period="today"
          onPeriodChange={vi.fn()}
        />,
      );

      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(2);
      const todayTab = Array.from(tabs).find((tab) => tab.textContent === "今日");
      const weekTab = Array.from(tabs).find((tab) => tab.textContent === "今週の計画平均");
      expect(todayTab?.getAttribute("aria-selected")).toBe("true");
      expect(weekTab?.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("period=\"week\" (Requirement 18.2, 18.3)", () => {
    it(
      "shows the energy card as the genuine average of the 7 dayNutrition.energyKcal values, not a " +
        "pre-computed/hardcoded number (Requirement 18.2, 18.3)",
      () => {
        const { container } = render(
          <NutritionSummarySection
            nutritionSummary={NUTRITION_SUMMARY}
            dayNutrition={DAY_NUTRITION}
            weekPlan={WEEK_PLAN}
            period="week"
            onPeriodChange={vi.fn()}
          />,
        );

        expect(container.textContent).toContain("推奨エネルギー量");
        expect(container.textContent).toContain("2,013");
        expect(container.textContent).toContain("kcal/日");
        // 「今日」モード固有の基礎代謝・活動量による加算の文言は表示しない。
        expect(container.textContent).not.toContain("基礎代謝");
        expect(container.textContent).toContain("今週7日間の計画献立の平均値");
      },
    );

    it(
      "passes no grams to PfcBarChart in week mode; the legend shows the unchanged pfcRatio-derived " +
        "percentages as \"平均{pct}%\" (Requirement 18.2, 18.3)",
      () => {
        const { container } = render(
          <NutritionSummarySection
            nutritionSummary={NUTRITION_SUMMARY}
            dayNutrition={DAY_NUTRITION}
            weekPlan={WEEK_PLAN}
            period="week"
            onPeriodChange={vi.fn()}
          />,
        );

        expect(container.textContent).toContain("平均56%");
        expect(container.textContent).toContain("平均19%");
        expect(container.textContent).toContain("平均25%");
        expect(container.textContent).not.toContain("269g");
        expect(container.textContent).not.toContain("g・");
      },
    );

    it(
      "passes the correctly-averaged 13-field actual object to NutrientSufficiencyList, proving genuine " +
        "per-field averaging (not today's single-day value reused) (Requirement 18.2, 18.3)",
      () => {
        const { container } = render(
          <NutritionSummarySection
            nutritionSummary={NUTRITION_SUMMARY}
            dayNutrition={DAY_NUTRITION}
            weekPlan={WEEK_PLAN}
            period="week"
            onPeriodChange={vi.fn()}
          />,
        );

        const rows = container.querySelectorAll(".nutrient-row");
        const rowArray = Array.from(rows);
        const vitaminDRow = rowArray.find((row) => row.textContent?.includes("ビタミンD"));
        // 平均7.357142... / 目標8.5 * 100 = 86.55...% -> 四捨五入で87%。
        // (今日のdayNutrition.vitaminDUgをそのまま使った場合は55%になるため、値が異なることで
        // 実際に週平均が計算されていることを証明する。)
        expect(vitaminDRow?.querySelector(".pct")?.textContent).toBe("87%");
      },
    );

    it("shows the week-mode caption and not the today-mode caption on the micronutrient card (Requirement 18)", () => {
      const { container } = render(
        <NutritionSummarySection
          nutritionSummary={NUTRITION_SUMMARY}
          dayNutrition={DAY_NUTRITION}
          weekPlan={WEEK_PLAN}
          period="week"
          onPeriodChange={vi.fn()}
        />,
      );

      expect(container.textContent).toContain(
        "今週7日間の計画献立を平均した値です。単日の偏りをならした傾向を確認できます。",
      );
      expect(container.textContent).not.toContain(
        "食塩相当量のみ上限目安（1日7.5g未満）に対する割合を示しています。",
      );
    });

    it("shows the today-mode caption (not the week-mode caption) when period=\"today\"", () => {
      const { container } = render(
        <NutritionSummarySection
          nutritionSummary={NUTRITION_SUMMARY}
          dayNutrition={DAY_NUTRITION}
          weekPlan={WEEK_PLAN}
          period="today"
          onPeriodChange={vi.fn()}
        />,
      );

      expect(container.textContent).toContain(
        "食塩相当量のみ上限目安（1日7.5g未満）に対する割合を示しています。",
      );
      expect(container.textContent).not.toContain(
        "今週7日間の計画献立を平均した値です。",
      );
    });
  });

  describe("weekPlan is null (週間献立プラン未生成、Requirement 18.4)", () => {
    it("disables the week option in PeriodToggle when weekPlan is null", () => {
      const { container } = render(
        <NutritionSummarySection
          nutritionSummary={NUTRITION_SUMMARY}
          dayNutrition={DAY_NUTRITION}
          weekPlan={null}
          period="today"
          onPeriodChange={vi.fn()}
        />,
      );

      const tabs = container.querySelectorAll('[role="tab"]');
      const weekTab = Array.from(tabs).find((tab) => tab.textContent === "今週の計画平均");
      expect(weekTab?.hasAttribute("disabled")).toBe(true);
    });

    it(
      "shows a clear \"not generated\" message instead of crashing/NaN when period=\"week\" is somehow " +
        "still active with a null weekPlan (Requirement 18.4)",
      () => {
        const { container } = render(
          <NutritionSummarySection
            nutritionSummary={NUTRITION_SUMMARY}
            dayNutrition={DAY_NUTRITION}
            weekPlan={null}
            period="week"
            onPeriodChange={vi.fn()}
          />,
        );

        expect(container.textContent).not.toContain("NaN");
        expect(container.textContent).toMatch(/未生成/);
      },
    );
  });
});
