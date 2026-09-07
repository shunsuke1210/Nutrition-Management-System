import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { PeriodToggle } from "./PeriodToggle.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（ModeToggle.test.tsxと同じ方針）。
afterEach(() => {
  cleanup();
});

describe("PeriodToggle", () => {
  it("renders both period options with the initially-passed period reflected as active (Requirement 18.1)", () => {
    render(<PeriodToggle period="today" onPeriodChange={vi.fn()} weekAvailable />);

    const todayTab = screen.getByRole("tab", { name: "今日" });
    const weekTab = screen.getByRole("tab", { name: "今週の計画平均" });
    expect(todayTab.getAttribute("aria-selected")).toBe("true");
    expect(weekTab.getAttribute("aria-selected")).toBe("false");
  });

  it("reflects period=\"week\" as the active option when weekAvailable (Requirement 18.1)", () => {
    render(<PeriodToggle period="week" onPeriodChange={vi.fn()} weekAvailable />);

    expect(screen.getByRole("tab", { name: "今日" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "今週の計画平均" }).getAttribute("aria-selected")).toBe("true");
  });

  it("calls onPeriodChange with \"week\" when clicking the inactive week option while weekAvailable (Requirement 18.1)", () => {
    const onPeriodChange = vi.fn();
    render(<PeriodToggle period="today" onPeriodChange={onPeriodChange} weekAvailable />);

    fireEvent.click(screen.getByRole("tab", { name: "今週の計画平均" }));

    expect(onPeriodChange).toHaveBeenCalledWith("week");
  });

  it("calls onPeriodChange with \"today\" when clicking the inactive today option from week", () => {
    const onPeriodChange = vi.fn();
    render(<PeriodToggle period="week" onPeriodChange={onPeriodChange} weekAvailable />);

    fireEvent.click(screen.getByRole("tab", { name: "今日" }));

    expect(onPeriodChange).toHaveBeenCalledWith("today");
  });

  it("does not call onPeriodChange when attempting to activate week while weekAvailable is false (Requirement 18.4)", () => {
    const onPeriodChange = vi.fn();
    render(<PeriodToggle period="today" onPeriodChange={onPeriodChange} weekAvailable={false} />);

    fireEvent.click(screen.getByRole("tab", { name: "今週の計画平均" }));

    expect(onPeriodChange).not.toHaveBeenCalled();
  });

  it("shows a distinguishable guidance/disabled affordance when weekAvailable is false (Requirement 18.4)", () => {
    render(<PeriodToggle period="today" onPeriodChange={vi.fn()} weekAvailable={false} />);

    const weekTab = screen.getByRole("tab", { name: "今週の計画平均" });
    expect(weekTab.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("今週の献立プランが未生成のため利用できません")).toBeDefined();
  });

  it("still reflects today as active and clickable when weekAvailable is false", () => {
    const onPeriodChange = vi.fn();
    render(<PeriodToggle period="today" onPeriodChange={onPeriodChange} weekAvailable={false} />);

    const todayTab = screen.getByRole("tab", { name: "今日" });
    expect(todayTab.getAttribute("aria-selected")).toBe("true");
    expect(todayTab.hasAttribute("disabled")).toBe(false);

    fireEvent.click(todayTab);
    expect(onPeriodChange).toHaveBeenCalledWith("today");
  });
});
