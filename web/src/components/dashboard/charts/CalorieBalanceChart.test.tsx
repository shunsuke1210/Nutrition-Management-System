import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CalorieBalanceChart, type CalorieBalanceDatum } from "./CalorieBalanceChart.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（PfcBarChart.test.tsx等と同じ方針）。
afterEach(() => {
  cleanup();
});

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

/** 7要素固定の`data`を、指定したインデックスのみ値を入れて他はnullで組み立てる。 */
function buildData(overrides: Partial<Record<number, number | null>> = {}): CalorieBalanceDatum[] {
  return WEEKDAY_LABELS.map((label, index) => ({
    weekdayLabel: label,
    varianceKcal: index in overrides ? overrides[index]! : null,
  }));
}

describe("CalorieBalanceChart", () => {
  it("renders all 7 weekday labels regardless of which days have data (Requirement 12.1)", () => {
    const { container } = render(<CalorieBalanceChart data={buildData({ 0: -180, 2: 120 })} />);

    for (const label of WEEKDAY_LABELS) {
      expect(container.textContent).toContain(label);
    }
  });

  it("renders bars only for days with non-null varianceKcal, skipping null days entirely (no fabricated 0)", () => {
    const data = buildData({ 0: -180, 2: 120, 5: 310 });
    const { container } = render(<CalorieBalanceChart data={data} />);

    expect(container.querySelectorAll("rect.bar-mark").length).toBe(3);
  });

  it("renders no bars at all when all 7 days are null", () => {
    const { container } = render(<CalorieBalanceChart data={buildData()} />);

    expect(container.querySelectorAll("rect.bar-mark").length).toBe(0);
  });

  it("scales bar height proportionally to magnitude: a -300kcal day renders an exactly 3x taller bar than a -100kcal day", () => {
    const data = buildData({ 0: -100, 3: -300 });
    const { container } = render(<CalorieBalanceChart data={data} />);

    const rects = container.querySelectorAll("rect.bar-mark");
    expect(rects.length).toBe(2);
    const heightSmall = parseFloat(rects[0]!.getAttribute("height")!);
    const heightLarge = parseFloat(rects[1]!.getAttribute("height")!);
    expect(heightLarge).toBeGreaterThan(heightSmall);
    expect(heightLarge / heightSmall).toBeCloseTo(3, 5);
  });

  it("uses the positive fill color for a positive variance and the negative fill color for a negative variance", () => {
    const data = buildData({ 1: 150, 4: -75 });
    const { container } = render(<CalorieBalanceChart data={data} />);

    const rects = Array.from(container.querySelectorAll("rect.bar-mark"));
    const positiveRect = rects.find((rect) => rect.getAttribute("data-tip")?.includes("+150"));
    const negativeRect = rects.find((rect) => rect.getAttribute("data-tip")?.includes("-75"));
    expect(positiveRect?.getAttribute("fill")).toBe("var(--diverge-pos)");
    expect(negativeRect?.getAttribute("fill")).toBe("var(--diverge-neg)");
  });

  it("renders the legend row (both labels) and the chart-sub caption text (mockup.html行880,913-916)", () => {
    const { container } = render(<CalorieBalanceChart data={buildData({ 0: -10 })} />);

    const legend = container.querySelector(".legend-row");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toContain("目標より少ない");
    expect(legend!.textContent).toContain("目標より多い");
    expect(container.querySelector(".chart-sub")?.textContent).toBe(
      "0より下＝目標より少なく抑えられた日／0より上＝目標を超過した日",
    );
  });
});
