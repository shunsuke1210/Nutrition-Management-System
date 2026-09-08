import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { WeightProjectionPoint, WeightTrendPoint } from "@nutrition/shared";
import { WeightTrendChart } from "./WeightTrendChart.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（PfcBarChart.test.tsx等と同じ方針）。
afterEach(() => {
  cleanup();
});

const HISTORY: WeightTrendPoint[] = [
  { date: "2026-07-01", weightKg: 73.4 },
  { date: "2026-08-01", weightKg: 70.0 },
  { date: "2026-09-01", weightKg: 68.6 },
];

const PROJECTION: WeightProjectionPoint[] = [
  { date: "2026-09-08", projectedWeightKg: 68.0 },
  { date: "2026-09-15", projectedWeightKg: 67.3 },
];

/** SVGの`points`属性文字列（"x1,y1 x2,y2 ..."）を数値ペアの配列へ変換するテスト用ヘルパー。 */
function parsePointsAttr(pointsAttr: string): [number, number][] {
  return pointsAttr
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return [x ?? NaN, y ?? NaN] as [number, number];
    });
}

describe("WeightTrendChart", () => {
  it("renders exactly 2 polylines (solid actual + dashed projection) when both are populated, with only the projection one carrying stroke-dasharray (Requirement 13.1, 13.3)", () => {
    const { container } = render(
      <WeightTrendChart weightHistory={HISTORY} weightProjection={PROJECTION} goalWeightKg={63.0} />,
    );

    const polylines = container.querySelectorAll("polyline");
    expect(polylines.length).toBe(2);

    const dashed = Array.from(polylines).filter((p) => p.hasAttribute("stroke-dasharray"));
    const solid = Array.from(polylines).filter((p) => !p.hasAttribute("stroke-dasharray"));
    expect(dashed.length).toBe(1);
    expect(solid.length).toBe(1);
  });

  it("connects the dashed projection polyline seamlessly to the end of the solid actual polyline (same coordinate, not merely '2 polylines exist')", () => {
    const { container } = render(
      <WeightTrendChart weightHistory={HISTORY} weightProjection={PROJECTION} goalWeightKg={63.0} />,
    );

    const polylines = container.querySelectorAll("polyline");
    const solid = Array.from(polylines).find((p) => !p.hasAttribute("stroke-dasharray"))!;
    const dashed = Array.from(polylines).find((p) => p.hasAttribute("stroke-dasharray"))!;

    const solidPoints = parsePointsAttr(solid.getAttribute("points")!);
    const dashedPoints = parsePointsAttr(dashed.getAttribute("points")!);

    const solidLast = solidPoints[solidPoints.length - 1]!;
    const dashedFirst = dashedPoints[0]!;
    expect(dashedFirst[0]).toBeCloseTo(solidLast[0], 5);
    expect(dashedFirst[1]).toBeCloseTo(solidLast[1], 5);
  });

  it("renders the goal-weight reference line and its label containing the exact goalWeightKg value (Requirement 13.2)", () => {
    const { container } = render(
      <WeightTrendChart weightHistory={HISTORY} weightProjection={PROJECTION} goalWeightKg={63.5} />,
    );

    expect(container.querySelector(".goal-line")).not.toBeNull();
    expect(container.textContent).toContain("目標 63.5kg");
  });

  it("renders both the 現在 marker (last actual weight, reused verbatim) and the 想定 marker (last projected weight) with correct values", () => {
    const { container } = render(
      <WeightTrendChart weightHistory={HISTORY} weightProjection={PROJECTION} goalWeightKg={63.0} />,
    );

    expect(container.textContent).toContain("68.6kg（現在）");
    expect(container.textContent).toContain("67.3kg想定");
    expect(container.querySelector(".marker-current")).not.toBeNull();
    expect(container.querySelector(".marker-projected")).not.toBeNull();
  });

  it("renders exactly 1 polyline (solid only, no stroke-dasharray) and no 想定 marker/label anywhere when weightProjection is empty (Requirement 13.4)", () => {
    const { container } = render(
      <WeightTrendChart weightHistory={HISTORY} weightProjection={[]} goalWeightKg={63.0} />,
    );

    const polylines = container.querySelectorAll("polyline");
    expect(polylines.length).toBe(1);
    expect(polylines[0]!.hasAttribute("stroke-dasharray")).toBe(false);
    expect(container.querySelector(".marker-projected")).toBeNull();
    expect(container.textContent).not.toContain("想定");
    // 実測の「現在」マーカー自体は引き続き表示される。
    expect(container.textContent).toContain("68.6kg（現在）");
  });

  it("does not crash and keeps the goal line at a finite y-coordinate when weightHistory sits entirely below goalWeightKg (goal outside the data's own min/max range, would break a naive min/max)", () => {
    const belowGoalHistory: WeightTrendPoint[] = [
      { date: "2026-07-01", weightKg: 58 },
      { date: "2026-08-01", weightKg: 57 },
      { date: "2026-09-01", weightKg: 56 },
    ];

    const { container } = render(
      <WeightTrendChart weightHistory={belowGoalHistory} weightProjection={[]} goalWeightKg={70} />,
    );

    const goalLine = container.querySelector(".goal-line");
    expect(goalLine).not.toBeNull();
    const y1 = parseFloat(goalLine!.getAttribute("y1")!);
    expect(Number.isFinite(y1)).toBe(true);
    // ファイル内のviewBox高さ(210)の範囲内に収まっていること（NaN/Infinityではないことの具体化）。
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeLessThanOrEqual(210);
  });
});
