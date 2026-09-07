import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PfcRatio, PfcTargets } from "@nutrition/shared";
import { PfcBarChart } from "./PfcBarChart.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（ProfileStrip.test.tsx等と同じ方針）。
afterEach(() => {
  cleanup();
});

// mockup.html (行586-627) の「今日」パネルにあるPFC構成比の数値例をそのまま流用する。
const PFC_RATIO: PfcRatio = { carbPct: 0.56, proteinPct: 0.19, fatPct: 0.25 };
const PFC_TARGETS: PfcTargets = {
  carbG: 269,
  proteinG: 98,
  fatG: 57,
  carbKcal: 1076,
  proteinKcal: 392,
  fatKcal: 513,
};

describe("PfcBarChart", () => {
  it("renders all 3 legend rows with correct grams and percentage (ratio x 100) (Requirement 1.2)", () => {
    const { container } = render(<PfcBarChart pfcRatio={PFC_RATIO} pfc={PFC_TARGETS} />);

    const rows = container.querySelectorAll(".pfc-legend .row");
    expect(rows.length).toBe(3);

    expect(container.textContent).toContain("炭水化物");
    expect(container.textContent).toContain("269g");
    expect(container.textContent).toContain("56%");

    expect(container.textContent).toContain("たんぱく質");
    expect(container.textContent).toContain("98g");
    expect(container.textContent).toContain("19%");

    expect(container.textContent).toContain("脂質");
    expect(container.textContent).toContain("57g");
    expect(container.textContent).toContain("25%");
  });

  it("renders bar segment widths reflecting the 3 ratios, in carb->protein->fat order (Requirement 1.2)", () => {
    const { container } = render(<PfcBarChart pfcRatio={PFC_RATIO} pfc={PFC_TARGETS} />);

    const segments = container.querySelectorAll(".stack-bar > span");
    expect(segments.length).toBe(3);
    expect((segments[0] as HTMLElement).style.width).toBe("56%");
    expect((segments[1] as HTMLElement).style.width).toBe("19%");
    expect((segments[2] as HTMLElement).style.width).toBe("25%");
  });

  it("computes the percentage as ratio x 100 rather than expecting a pre-computed value (non-round ratio)", () => {
    // 0.563 -> 56.3 -> 四捨五入で56。事前計算済みのpropではなく、実際にratio*100の計算が
    // 行われていることを証明する（きりの良い数値だけでは実装のズルを検出できないため）。
    const oddRatio: PfcRatio = { carbPct: 0.563, proteinPct: 0.187, fatPct: 0.25 };

    const { container } = render(<PfcBarChart pfcRatio={oddRatio} pfc={PFC_TARGETS} />);

    expect(container.textContent).toContain("56%");
    expect(container.textContent).toContain("19%");
  });
});
