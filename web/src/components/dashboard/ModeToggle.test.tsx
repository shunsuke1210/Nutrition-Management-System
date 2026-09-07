import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModeToggle, type DashboardMode } from "./ModeToggle.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

describe("ModeToggle", () => {
  it("renders both mode options with the initially-passed mode reflected as active (Requirement 2.1)", () => {
    render(<ModeToggle mode="normal" onModeChange={vi.fn()} dietModeEnabled />);

    const normalTab = screen.getByRole("tab", { name: "栄養評価" });
    const dietTab = screen.getByRole("tab", { name: "ダイエット状況" });
    expect(normalTab.getAttribute("aria-selected")).toBe("true");
    expect(dietTab.getAttribute("aria-selected")).toBe("false");
  });

  it("reflects mode=\"diet\" as the active option when dietModeEnabled (Requirement 2.1)", () => {
    render(<ModeToggle mode="diet" onModeChange={vi.fn()} dietModeEnabled />);

    expect(screen.getByRole("tab", { name: "栄養評価" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "ダイエット状況" }).getAttribute("aria-selected")).toBe("true");
  });

  it(
    "calls onModeChange with the new mode when clicking the inactive option while diet mode is enabled " +
      "(Requirement 2.1)",
    () => {
      const onModeChange = vi.fn();
      render(<ModeToggle mode="normal" onModeChange={onModeChange} dietModeEnabled />);

      fireEvent.click(screen.getByRole("tab", { name: "ダイエット状況" }));

      expect(onModeChange).toHaveBeenCalledWith("diet");
    },
  );

  it("calls onModeChange with \"normal\" when clicking the inactive normal option from diet mode", () => {
    const onModeChange = vi.fn();
    render(<ModeToggle mode="diet" onModeChange={onModeChange} dietModeEnabled />);

    fireEvent.click(screen.getByRole("tab", { name: "栄養評価" }));

    expect(onModeChange).toHaveBeenCalledWith("normal");
  });

  it("does not call onModeChange when attempting to activate diet mode while dietModeEnabled is false (Requirement 2.6)", () => {
    const onModeChange = vi.fn();
    render(<ModeToggle mode="normal" onModeChange={onModeChange} dietModeEnabled={false} />);

    fireEvent.click(screen.getByRole("tab", { name: "ダイエット状況" }));

    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("shows a distinguishable guidance/disabled affordance when dietModeEnabled is false (Requirement 2.6)", () => {
    render(<ModeToggle mode="normal" onModeChange={vi.fn()} dietModeEnabled={false} />);

    const dietTab = screen.getByRole("tab", { name: "ダイエット状況" });
    expect(dietTab.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("ダイエットモードを有効にすると利用できます")).toBeDefined();
  });

  it("still reflects normal as active and clickable when dietModeEnabled is false", () => {
    const onModeChange = vi.fn();
    render(<ModeToggle mode="normal" onModeChange={onModeChange} dietModeEnabled={false} />);

    const normalTab = screen.getByRole("tab", { name: "栄養評価" });
    expect(normalTab.getAttribute("aria-selected")).toBe("true");
    expect(normalTab.hasAttribute("disabled")).toBe(false);

    fireEvent.click(normalTab);
    expect(onModeChange).toHaveBeenCalledWith("normal");
  });

  // 本タスクの受け入れ条件そのもの: 「モードを切り替えると対応するセクション群のみが
  // 表示されることを確認する」。ModeToggle自体は栄養評価/ダイエット状況の実際のセクション
  // 群を知らない（design.mdの責務分担: 表示モード状態の管理とセクション切替はDashboardPage
  // （task 7.1）が担い、ModeToggleは純粋な切替コントロールのみ）ため、ここではまだ存在しない
  // 本物のセクションコンポーネントの代わりに、テストローカルの最小限のスタブ要素と
  // useState を持つラッパーで、コールバックの配線がDOM上の表示切替を実際に駆動することを
  // 証明する。
  function ModeToggleHarness() {
    const [mode, setMode] = useState<DashboardMode>("normal");
    return (
      <div>
        <ModeToggle mode={mode} onModeChange={setMode} dietModeEnabled />
        {mode === "normal" && <div>Normal-only content</div>}
        {mode === "diet" && <div>Diet-only content</div>}
      </div>
    );
  }

  it("shows only the section group matching the active mode when the toggle changes mode (task acceptance line)", () => {
    render(<ModeToggleHarness />);

    expect(screen.getByText("Normal-only content")).toBeDefined();
    expect(screen.queryByText("Diet-only content")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "ダイエット状況" }));

    expect(screen.queryByText("Normal-only content")).toBeNull();
    expect(screen.getByText("Diet-only content")).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: "栄養評価" }));

    expect(screen.getByText("Normal-only content")).toBeDefined();
    expect(screen.queryByText("Diet-only content")).toBeNull();
  });
});
