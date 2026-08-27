import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// `IngredientChipList` が本当にimport・再利用されていること（コピペによる別実装ではないこと）を
// 証明するため、実体は保ったまま呼び出しを記録するモックに差し替える（vi.fn(actual) パターン）。
vi.mock("./IngredientChipList.js", async () => {
  const actual = await vi.importActual<typeof import("./IngredientChipList.js")>("./IngredientChipList.js");
  return {
    ...actual,
    IngredientChipList: vi.fn(actual.IngredientChipList),
  };
});

import { IngredientChipList } from "./IngredientChipList.js";
import { FoodPreferenceSection, type FoodPreferenceSectionValue } from "./FoodPreferenceSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const VALUE: FoodPreferenceSectionValue = {
  ngIngredients: ["しいたけ", "パクチー"],
  preferredIngredients: ["鮭"],
};

describe("FoodPreferenceSection", () => {
  it("renders separate NG-ingredient and preferred-ingredient chip groups (Requirements 3.1, 3.2)", () => {
    render(<FoodPreferenceSection value={VALUE} onChange={vi.fn()} />);

    const ngGroup = screen.getByRole("group", { name: "NG食材・苦手な食材" });
    const preferredGroup = screen.getByRole("group", { name: "好きな食材・よく使ってほしい食材" });
    expect(within(ngGroup).getByText("しいたけ")).toBeDefined();
    expect(within(ngGroup).getByText("パクチー")).toBeDefined();
    expect(within(preferredGroup).getByText("鮭")).toBeDefined();
  });

  it("reuses IngredientChipList by rendering it for both lists with distinct props, not a copy-pasted implementation", () => {
    render(<FoodPreferenceSection value={VALUE} onChange={vi.fn()} />);

    const mockedComponent = IngredientChipList as unknown as Mock;
    expect(mockedComponent.mock.calls.length).toBeGreaterThanOrEqual(2);

    const ngCall = mockedComponent.mock.calls.find(([props]) => props.label === "NG食材・苦手な食材");
    const preferredCall = mockedComponent.mock.calls.find(
      ([props]) => props.label === "好きな食材・よく使ってほしい食材",
    );
    expect(ngCall).toBeDefined();
    expect(preferredCall).toBeDefined();
    expect(ngCall?.[0].value).toEqual(["しいたけ", "パクチー"]);
    expect(preferredCall?.[0].value).toEqual(["鮭"]);
  });

  it("calls onChange with field 'ngIngredients' when the NG chip list changes (Requirement 3.4)", () => {
    const onChange = vi.fn();
    render(<FoodPreferenceSection value={VALUE} onChange={onChange} />);

    const ngGroup = screen.getByRole("group", { name: "NG食材・苦手な食材" });
    fireEvent.click(within(ngGroup).getByRole("button", { name: "しいたけを削除" }));

    expect(onChange).toHaveBeenCalledWith("ngIngredients", ["パクチー"]);
  });

  it("calls onChange with field 'preferredIngredients' when the preferred chip list changes (Requirement 3.3)", () => {
    const onChange = vi.fn();
    render(<FoodPreferenceSection value={VALUE} onChange={onChange} />);

    const preferredGroup = screen.getByRole("group", { name: "好きな食材・よく使ってほしい食材" });
    fireEvent.change(screen.getByLabelText("好きな食材・よく使ってほしい食材に追加する食材名"), {
      target: { value: "鶏むね肉" },
    });
    fireEvent.click(within(preferredGroup).getByRole("button", { name: "＋ 追加" }));

    expect(onChange).toHaveBeenCalledWith("preferredIngredients", ["鮭", "鶏むね肉"]);
  });

  it("allows both lists to be empty (Requirement 3.5)", () => {
    render(<FoodPreferenceSection value={{ ngIngredients: [], preferredIngredients: [] }} onChange={vi.fn()} />);

    const ngGroup = screen.getByRole("group", { name: "NG食材・苦手な食材" });
    const preferredGroup = screen.getByRole("group", { name: "好きな食材・よく使ってほしい食材" });
    expect(within(ngGroup).queryAllByRole("button", { name: /を削除$/ })).toHaveLength(0);
    expect(within(preferredGroup).queryAllByRole("button", { name: /を削除$/ })).toHaveLength(0);
  });
});
