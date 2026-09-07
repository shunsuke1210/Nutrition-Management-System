import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { MicronutrientTargets, VerifiedNutritionValues } from "@nutrition/shared";
import { NutrientSufficiencyList } from "./NutrientSufficiencyList.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
afterEach(() => {
  cleanup();
});

// mockup.html (行621-627) の「今日」パネルの充足率表示と一致する目標値・実績値の組み合わせ。
// ビタミンCのみ意図的に実績が目標を超える値（120%）にしてある (Requirement 1.4 の受け入れ条件)。
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
  vitaminCMg: 120, // 120/100 = 120% (over 100%)
  calciumMg: 591.5, // 591.5/650 = 91%
  ironMg: 7.77, // 7.77/10.5 = 74%
  fiberG: 14.28, // 14.28/21 = 68%
  saltEquivalentG: 6.8,
};

describe("NutrientSufficiencyList", () => {
  it("renders all 9 rows (8 normal + salt) with the correct Japanese labels (Requirement 1.3)", () => {
    const { container } = render(<NutrientSufficiencyList targets={TARGETS} actual={ACTUAL} />);

    const rows = container.querySelectorAll(".nutrient-row");
    expect(rows.length).toBe(9);

    for (const label of [
      "ビタミンA",
      "ビタミンD",
      "ビタミンB1",
      "ビタミンB2",
      "ビタミンC",
      "カルシウム",
      "鉄",
      "食物繊維",
      "食塩相当量",
    ]) {
      expect(container.textContent).toContain(label);
    }
  });

  it("shows a matching fill width and displayed percentage for a normal nutrient at or below 100% (vitaminA = 82%)", () => {
    const { container } = render(<NutrientSufficiencyList targets={TARGETS} actual={ACTUAL} />);

    const rows = Array.from(container.querySelectorAll(".nutrient-row"));
    const vitaminARow = rows.find((row) => row.textContent?.includes("ビタミンA"));
    expect(vitaminARow).toBeDefined();

    const fill = vitaminARow!.querySelector(".fill") as HTMLElement;
    const pct = vitaminARow!.querySelector(".pct") as HTMLElement;

    expect(pct.textContent).toBe("82%");
    expect(fill.style.width).toBe("82%");
  });

  it(
    "shows the real uncapped percentage in the number but caps the fill bar width at 100 when actual > target " +
      "(vitaminC = 120%, task's own explicit acceptance line / Requirement 1.4)",
    () => {
      const { container } = render(<NutrientSufficiencyList targets={TARGETS} actual={ACTUAL} />);

      const rows = Array.from(container.querySelectorAll(".nutrient-row"));
      const vitaminCRow = rows.find((row) => row.textContent?.includes("ビタミンC"));
      expect(vitaminCRow).toBeDefined();

      const fill = vitaminCRow!.querySelector(".fill") as HTMLElement;
      const pct = vitaminCRow!.querySelector(".pct") as HTMLElement;

      // 数値表示は実際の値（100%超）をそのまま示す。
      expect(pct.textContent).toBe("120%");
      // バーの塗りつぶし幅は track を超えないよう100に固定する。
      expect(fill.style.width).toBe("100%");
    },
  );

  it('shows the salt (ceiling) row as "{actual}/{limit}g" text, not a percentage, with a distinguishing class (Requirement 1.3)', () => {
    const { container } = render(<NutrientSufficiencyList targets={TARGETS} actual={ACTUAL} />);

    const saltRow = container.querySelector(".nutrient-row.ceiling");
    expect(saltRow).not.toBeNull();
    expect(saltRow!.textContent).toContain("食塩相当量");

    const pct = saltRow!.querySelector(".pct") as HTMLElement;
    expect(pct.textContent).toBe("6.8/7.5g");
    expect(pct.textContent).not.toContain("%");

    // 他の8行には ceiling クラスが付かないことを確認する。
    const normalRows = container.querySelectorAll(".nutrient-row:not(.ceiling)");
    expect(normalRows.length).toBe(8);
  });

  it(
    "performs a genuine actual/target division rather than expecting a pre-computed percentage prop " +
      "(actual=73, target=91 -> approx 80.2%, rounds to 80%)",
    () => {
      const oddTargets: MicronutrientTargets = { ...TARGETS, ironMg: 91 };
      const oddActual: VerifiedNutritionValues = { ...ACTUAL, ironMg: 73 };

      const { container } = render(<NutrientSufficiencyList targets={oddTargets} actual={oddActual} />);

      const rows = Array.from(container.querySelectorAll(".nutrient-row"));
      const ironRow = rows.find((row) => row.textContent?.includes("鉄"));
      expect(ironRow).toBeDefined();

      const pct = ironRow!.querySelector(".pct") as HTMLElement;
      expect(pct.textContent).toBe("80%");
    },
  );

  it(
    "formats the salt row's actual/limit text to a fixed 1-decimal precision even when the underlying " +
      "values carry long float noise (real server-computed saltEquivalentG is a sum of per100g x grams/100 " +
      "across ingredients with no rounding anywhere in that pipeline, so raw values like 6.823... are the " +
      "realistic case, not the clean 6.8 used by the other salt test)",
    () => {
      const unroundedActual: VerifiedNutritionValues = { ...ACTUAL, saltEquivalentG: 6.823476 };
      const unroundedTargets: MicronutrientTargets = { ...TARGETS, saltEquivalentUpperLimitG: 7.5 };

      const { container } = render(
        <NutrientSufficiencyList targets={unroundedTargets} actual={unroundedActual} />,
      );

      const saltRow = container.querySelector(".nutrient-row.ceiling");
      expect(saltRow).not.toBeNull();

      const pct = saltRow!.querySelector(".pct") as HTMLElement;
      expect(pct.textContent).toBe("6.8/7.5g");
    },
  );
});
