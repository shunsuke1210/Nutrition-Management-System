import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { MicronutrientTargets, VerifiedNutritionValues } from "@nutrition/shared";
import { AdviceCallout, type DailyCalorieVariance } from "./AdviceCallout.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
afterEach(() => {
  cleanup();
});

// NutrientSufficiencyList.test.tsx と同じ目標値・実績値の組み合わせ。
// 8項目中「ビタミンD」が最も充足率が低い(55%)。
const TARGETS: MicronutrientTargets = {
  vitaminAUg: 850,
  vitaminDUg: 8.5,
  vitaminB1Mg: 1.4,
  vitaminB2Mg: 1.6,
  vitaminCMg: 100,
  calciumMg: 650,
  ironMg: 10.5,
  fiberG: 21,
  saltEquivalentUpperLimitG: 7.5,
};

const ACTUAL: VerifiedNutritionValues = {
  energyKcal: 2000,
  proteinG: 90,
  fatG: 60,
  carbG: 250,
  vitaminAUg: 697, // 697/850 = 82%
  vitaminDUg: 4.675, // 4.675/8.5 = 55%
  vitaminB1Mg: 1.064, // 1.064/1.4 = 76%
  vitaminB2Mg: 1.28, // 1.28/1.6 = 80%
  vitaminCMg: 120, // 120/100 = 120%
  calciumMg: 591.5, // 591.5/650 = 91%
  ironMg: 7.77, // 7.77/10.5 = 74%
  fiberG: 14.28, // 14.28/21 = 68%
  saltEquivalentG: 6.8,
};

describe("AdviceCallout", () => {
  describe('variant="nutrition"', () => {
    it(
      "renders the single lowest-sufficiency non-salt micronutrient's label and rounded percent " +
        "(Requirement 19.1, 19.3: vitaminDUg = 55% is the minimum among the 8 fields)",
      () => {
        const { container } = render(<AdviceCallout variant="nutrition" targets={TARGETS} actual={ACTUAL} />);

        const callout = container.querySelector(".advice-callout");
        expect(callout).not.toBeNull();
        expect(container.querySelector(".a-icon")?.textContent).toBe("💡");

        const body = container.querySelector(".a-body");
        expect(body).not.toBeNull();
        expect(body!.querySelector("b")?.textContent).toBe("ビタミンD");
        expect(body!.textContent).toContain("55%");

        // 他の栄養素名は選ばれていないことを確認する。
        expect(body!.textContent).not.toContain("ビタミンA");
        expect(body!.textContent).not.toContain("カルシウム");
      },
    );

    it(
      "excludes salt (saltEquivalentG / saltEquivalentUpperLimitG) from the min-selection even when its " +
        "raw ratio would be lower than every other field if it were (incorrectly) included",
      () => {
        // 食塩相当量の「実績/上限」比を意図的に極端に低くする(1/100 = 1%)。
        // 塩は上限指標（低いほど良い）なので、他の8項目の最小値選定に混ざってはならない。
        const targetsWithLowSaltRatio: MicronutrientTargets = {
          ...TARGETS,
          saltEquivalentUpperLimitG: 100,
        };
        const actualWithLowSaltRatio: VerifiedNutritionValues = {
          ...ACTUAL,
          saltEquivalentG: 1, // 1/100 = 1% -- would be the "lowest" if wrongly included
        };

        const { container } = render(
          <AdviceCallout variant="nutrition" targets={targetsWithLowSaltRatio} actual={actualWithLowSaltRatio} />,
        );

        const body = container.querySelector(".a-body");
        expect(body).not.toBeNull();
        // 塩ではなく、真に最小のビタミンD(55%)が選ばれる。
        expect(body!.querySelector("b")?.textContent).toBe("ビタミンD");
        expect(body!.textContent).not.toContain("食塩");
      },
    );

    it("renders nothing when targets is null (Requirement 19.4)", () => {
      const { container } = render(<AdviceCallout variant="nutrition" targets={null} actual={ACTUAL} />);
      expect(container.querySelector(".advice-callout")).toBeNull();
      expect(container.innerHTML).toBe("");
    });

    it("renders nothing when actual is null (Requirement 19.4)", () => {
      const { container } = render(<AdviceCallout variant="nutrition" targets={TARGETS} actual={null} />);
      expect(container.querySelector(".advice-callout")).toBeNull();
      expect(container.innerHTML).toBe("");
    });

    it("does not crash and renders 0% when the winning field's target value is 0 (zero-division guard)", () => {
      // fiberGの目標を0にすると 0/0 は通常NaNになりうるが、ゼロ除算ガードにより0%として扱われ、
      // かつ他のどの項目よりも小さい値として選ばれる。
      const zeroTargets: MicronutrientTargets = { ...TARGETS, fiberG: 0 };

      const { container } = render(<AdviceCallout variant="nutrition" targets={zeroTargets} actual={ACTUAL} />);

      const body = container.querySelector(".a-body");
      expect(body).not.toBeNull();
      expect(body!.querySelector("b")?.textContent).toBe("食物繊維");
      expect(body!.textContent).toContain("0%");
    });
  });

  describe('variant="calorieBalance"', () => {
    it("renders the day with the maximum (positive) varianceKcal, signed and rounded (Requirement 19.2, 19.3)", () => {
      const dailyVariances: DailyCalorieVariance[] = [
        { dayLabel: "月曜日", varianceKcal: 50 },
        { dayLabel: "火曜日", varianceKcal: -120 },
        { dayLabel: "木曜日", varianceKcal: -220 },
        { dayLabel: "金曜日", varianceKcal: -40 },
        { dayLabel: "土曜日", varianceKcal: 310.4 },
        { dayLabel: "日曜日", varianceKcal: -90 },
      ];

      const { container } = render(<AdviceCallout variant="calorieBalance" dailyVariances={dailyVariances} />);

      const callout = container.querySelector(".advice-callout");
      expect(callout).not.toBeNull();
      expect(container.querySelector(".a-icon")?.textContent).toBe("💡");

      const body = container.querySelector(".a-body");
      expect(body).not.toBeNull();
      expect(body!.querySelector("b")?.textContent).toBe("土曜日");
      expect(body!.textContent).toContain("+310kcal");
    });

    it(
      "still renders the max entry (with no extra suppression) even when every variance is negative, " +
        "using an explicit negative sign (Requirement 19.3: no additional 'is this worth mentioning' judgment)",
      () => {
        const dailyVariances: DailyCalorieVariance[] = [
          { dayLabel: "月曜日", varianceKcal: -300 },
          { dayLabel: "火曜日", varianceKcal: -120 },
          { dayLabel: "水曜日", varianceKcal: -90 },
        ];

        const { container } = render(<AdviceCallout variant="calorieBalance" dailyVariances={dailyVariances} />);

        const body = container.querySelector(".a-body");
        expect(body).not.toBeNull();
        expect(body!.querySelector("b")?.textContent).toBe("水曜日");
        expect(body!.textContent).toContain("-90kcal");
      },
    );

    it("renders nothing when dailyVariances is null (Requirement 19.4)", () => {
      const { container } = render(<AdviceCallout variant="calorieBalance" dailyVariances={null} />);
      expect(container.querySelector(".advice-callout")).toBeNull();
      expect(container.innerHTML).toBe("");
    });

    it("renders nothing when dailyVariances is an empty array (Requirement 19.4)", () => {
      const { container } = render(<AdviceCallout variant="calorieBalance" dailyVariances={[]} />);
      expect(container.querySelector(".advice-callout")).toBeNull();
      expect(container.innerHTML).toBe("");
    });
  });
});
