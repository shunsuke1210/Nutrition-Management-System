import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RestrictionChip } from "./RestrictionChip.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（ProfileStrip.test.tsx と同じ方針）。
afterEach(() => {
  cleanup();
});

describe("RestrictionChip", () => {
  it("renders the combined type・intensity label for restrictionType=low_carb / restrictionIntensity=standard (Requirement 3.1)", () => {
    const { container } = render(
      <RestrictionChip restrictionType="low_carb" restrictionIntensity="standard" restrictionNotes={null} />,
    );

    expect(container.textContent).toContain("現在の食事制限設定");
    expect(screen.getByText("糖質制限・標準")).toBeDefined();
  });

  it("renders the combined type・intensity label for a different combination (restrictionType=high_protein / restrictionIntensity=strict), proving the mapping is prop-driven (Requirement 3.1)", () => {
    render(
      <RestrictionChip restrictionType="high_protein" restrictionIntensity="strict" restrictionNotes={null} />,
    );

    expect(screen.getByText("高たんぱく・しっかり")).toBeDefined();
  });

  it("shows the note line with the restrictionNotes content when restrictionNotes is a non-empty string (Requirement 3.2)", () => {
    const { container } = render(
      <RestrictionChip
        restrictionType="low_carb"
        restrictionIntensity="standard"
        restrictionNotes="揚げ物はできるだけ控えたい"
      />,
    );

    const note = container.querySelector(".note");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("揚げ物はできるだけ控えたい");
  });

  it("does not show the note line when restrictionNotes is null (Requirement 3.2)", () => {
    const { container } = render(
      <RestrictionChip restrictionType="low_carb" restrictionIntensity="standard" restrictionNotes={null} />,
    );

    expect(container.querySelector(".note")).toBeNull();
  });

  it("clearly indicates that no restriction is set when restrictionType is 'none', without a broken/null-ish intensity fragment (Requirement 3.3)", () => {
    const { container } = render(
      <RestrictionChip restrictionType="none" restrictionIntensity={null} restrictionNotes={null} />,
    );

    expect(container.textContent).toContain("制限なし");
    expect(container.textContent).not.toContain("null");

    const summary = container.querySelector(".restriction-chip b");
    expect(summary).not.toBeNull();
    // 「制限なし・」のような、強度側が空のまま「・」だけがぶら下がる表示になっていないこと。
    expect(summary?.textContent).toBe("制限なし");
  });

  it("shows both the 'no restriction' indication and the note line when restrictionType is 'none' but restrictionNotes is still present (Requirement 3.2, 3.3)", () => {
    const { container } = render(
      <RestrictionChip
        restrictionType="none"
        restrictionIntensity={null}
        restrictionNotes="魚料理を多めにしてほしい"
      />,
    );

    const summary = container.querySelector(".restriction-chip b");
    expect(summary?.textContent).toBe("制限なし");

    const note = container.querySelector(".note");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("魚料理を多めにしてほしい");
  });
});
