import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  DietRestrictionSection,
  validateDietRestriction,
  type DietRestrictionSectionValue,
} from "./DietRestrictionSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const UNSELECTED_VALUE: DietRestrictionSectionValue = {
  restrictionType: null,
  restrictionIntensity: null,
  restrictionNotes: null,
};

const NONE_VALUE: DietRestrictionSectionValue = {
  restrictionType: "none",
  restrictionIntensity: null,
  restrictionNotes: null,
};

const CARB_RESTRICTED_VALUE: DietRestrictionSectionValue = {
  restrictionType: "low_carb",
  restrictionIntensity: "standard",
  restrictionNotes: "揚げ物はできるだけ控えたい",
};

describe("DietRestrictionSection", () => {
  it("renders the restriction type, intensity, and free-text notes fields", () => {
    render(<DietRestrictionSection value={UNSELECTED_VALUE} onChange={vi.fn()} />);

    expect(screen.getByRole("radiogroup", { name: "制限のタイプ" })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "制限の強度" })).toBeDefined();
    expect(screen.getByLabelText("その他の食事制限・献立への要望（自由記述）")).toBeDefined();
  });

  it("exposes exactly the five restriction type options required by 5.1", () => {
    render(<DietRestrictionSection value={UNSELECTED_VALUE} onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "制限のタイプ" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(within(group).getByRole("radio", { name: "制限なし" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "糖質制限" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "脂質制限" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "高たんぱく" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "カロリー制限のみ" })).toBeDefined();
  });

  it("exposes exactly the three restriction intensity options required by 5.2", () => {
    render(<DietRestrictionSection value={UNSELECTED_VALUE} onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "制限の強度" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "ゆるやか" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "標準" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "しっかり" })).toBeDefined();
  });

  it("calls onChange with the selected restriction type", () => {
    const onChange = vi.fn();
    render(<DietRestrictionSection value={UNSELECTED_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "糖質制限" }));

    expect(onChange).toHaveBeenCalledWith("restrictionType", "low_carb");
  });

  it("calls onChange with the selected restriction intensity", () => {
    const onChange = vi.fn();
    render(<DietRestrictionSection value={CARB_RESTRICTED_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "しっかり" }));

    expect(onChange).toHaveBeenCalledWith("restrictionIntensity", "strict");
  });

  it("calls onChange with the free-text notes value", () => {
    const onChange = vi.fn();
    render(<DietRestrictionSection value={NONE_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("その他の食事制限・献立への要望（自由記述）"), {
      target: { value: "16時以降の糖質を控えたい" },
    });

    expect(onChange).toHaveBeenCalledWith("restrictionNotes", "16時以降の糖質を控えたい");
  });

  it("visually marks restriction intensity as required when the type is not '制限なし' (Requirement 5.3)", () => {
    render(<DietRestrictionSection value={CARB_RESTRICTED_VALUE} onChange={vi.fn()} />);

    expect(screen.getByText("必須")).toBeDefined();
  });

  it("does not mark restriction intensity as required when the type is '制限なし' (Requirement 5.4)", () => {
    render(<DietRestrictionSection value={NONE_VALUE} onChange={vi.fn()} />);

    expect(screen.queryByText("必須")).toBeNull();
  });

  it("does not mark restriction intensity as required when the type is unselected", () => {
    render(<DietRestrictionSection value={UNSELECTED_VALUE} onChange={vi.fn()} />);

    expect(screen.queryByText("必須")).toBeNull();
  });
});

describe("validateDietRestriction", () => {
  it("requires restrictionIntensity when restrictionType is not 'none' (Requirement 5.3)", () => {
    const errors = validateDietRestriction({
      restrictionType: "low_carb",
      restrictionIntensity: null,
      restrictionNotes: null,
    });

    expect(errors.restrictionIntensity).toBeDefined();
  });

  it("allows a missing restrictionIntensity when restrictionType is 'none' (Requirement 5.4)", () => {
    expect(validateDietRestriction(NONE_VALUE)).toEqual({});
  });

  it("returns no errors for a fully valid restricted value", () => {
    expect(validateDietRestriction(CARB_RESTRICTED_VALUE)).toEqual({});
  });

  it("returns an error for an unselected restriction type", () => {
    const errors = validateDietRestriction(UNSELECTED_VALUE);
    expect(errors.restrictionType).toBeDefined();
  });
});
