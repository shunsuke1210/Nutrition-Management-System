import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CompareBars } from "./CompareBars.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（GoalProgressBar.test.tsx等と同じ方針）。
afterEach(() => {
  cleanup();
});

describe("CompareBars", () => {
  it(
    "both weeks values non-null (mockup.htmlの実例: 14週/10週) renders both rows' labels+weeks text " +
      "correctly, row1's bar at 100%, and row2's bar computed as a genuine ratio (10/14≈71.4%, not the " +
      "mockup's hardcoded 71%)",
    () => {
      const { container } = render(
        <CompareBars
          dietOnlyWeeksToGoal={14}
          dietPlusExerciseWeeksToGoal={10}
          scenarioLabel="週3回・30分の運動を追加"
        />,
      );

      const rows = container.querySelectorAll(".compare-row");
      expect(rows.length).toBe(2);

      const row1Labels = rows[0]!.querySelectorAll(".label-row span");
      expect(row1Labels[0]!.textContent).toBe("運動なし（食事管理のみ）");
      expect(row1Labels[1]!.textContent).toBe("目標まで 約14週");
      const row1Fill = rows[0]!.querySelector(".compare-fill") as HTMLElement;
      expect(row1Fill.style.width).toBe("100%");

      const row2Labels = rows[1]!.querySelectorAll(".label-row span");
      expect(row2Labels[0]!.textContent).toBe("週3回・30分の運動を追加");
      expect(row2Labels[1]!.textContent).toBe("目標まで 約10週");
      const row2Fill = rows[1]!.querySelector(".compare-fill") as HTMLElement;
      // 10/14*100 = 71.42857142857143 -> 小数第1位に丸め("71.4%")。
      expect(row2Fill.style.width).toBe("71.4%");
    },
  );

  it(
    "a DIFFERENT scenarioLabel is displayed as row2's label exactly as given (proves scenarioLabel is not " +
      "hardcoded — different values/ratio than the previous test)",
    () => {
      const { container } = render(
        <CompareBars
          dietOnlyWeeksToGoal={8}
          dietPlusExerciseWeeksToGoal={6}
          scenarioLabel="週5回・20分のウォーキングを追加"
        />,
      );

      const rows = container.querySelectorAll(".compare-row");
      const row2Labels = rows[1]!.querySelectorAll(".label-row span");
      expect(row2Labels[0]!.textContent).toBe("週5回・20分のウォーキングを追加");
      expect(row2Labels[1]!.textContent).toBe("目標まで 約6週");
      // 6/8*100 = 75% (jsdomのCSSOMは"75.0%"を"75%"に正規化して読み戻す)
      const row2Fill = rows[1]!.querySelector(".compare-fill") as HTMLElement;
      expect(row2Fill.style.width).toBe("75%");
    },
  );

  it(
    "dietOnlyWeeksToGoal===null renders a distinct fallback for row1 (not \"約null週\", no crash) and a " +
      "sane (non-NaN) 0% bar for both rows since there is no baseline to compare against",
    () => {
      const { container } = render(
        <CompareBars
          dietOnlyWeeksToGoal={null}
          dietPlusExerciseWeeksToGoal={10}
          scenarioLabel="週3回・30分の運動を追加"
        />,
      );

      const rows = container.querySelectorAll(".compare-row");
      const row1Labels = rows[0]!.querySelectorAll(".label-row span");
      expect(row1Labels[1]!.textContent).toBe("見込みを算出できません。");
      const row1Fill = rows[0]!.querySelector(".compare-fill") as HTMLElement;
      expect(row1Fill.style.width).toBe("0%");

      // row2自体のweeksテキストはdietPlusExerciseWeeksToGoal(10)が非nullなので通常通り表示される。
      const row2Labels = rows[1]!.querySelectorAll(".label-row span");
      expect(row2Labels[1]!.textContent).toBe("目標まで 約10週");
      const row2Fill = rows[1]!.querySelector(".compare-fill") as HTMLElement;
      expect(row2Fill.style.width).toBe("0%");
      expect(container.textContent).not.toContain("NaN");
      expect(container.textContent).not.toContain("Infinity");
    },
  );

  it(
    "dietPlusExerciseWeeksToGoal===null (dietOnlyWeeksToGoal non-null) renders the distinct fallback for " +
      "row2 and a sane (non-NaN) bar value, while row1 is unaffected (still 100%)",
    () => {
      const { container } = render(
        <CompareBars
          dietOnlyWeeksToGoal={14}
          dietPlusExerciseWeeksToGoal={null}
          scenarioLabel="週3回・30分の運動を追加"
        />,
      );

      const rows = container.querySelectorAll(".compare-row");
      const row1Fill = rows[0]!.querySelector(".compare-fill") as HTMLElement;
      expect(row1Fill.style.width).toBe("100%");

      const row2Labels = rows[1]!.querySelectorAll(".label-row span");
      expect(row2Labels[1]!.textContent).toBe("見込みを算出できません。");
      const row2Fill = rows[1]!.querySelector(".compare-fill") as HTMLElement;
      expect(row2Fill.style.width).toBe("0%");
      expect(container.textContent).not.toContain("NaN");
      expect(container.textContent).not.toContain("Infinity");
    },
  );
});
