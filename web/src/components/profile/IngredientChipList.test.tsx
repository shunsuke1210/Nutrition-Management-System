import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IngredientChipList } from "./IngredientChipList.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

describe("IngredientChipList", () => {
  it("renders one removable chip per item in the list", () => {
    render(<IngredientChipList label="NG食材・苦手な食材" value={["しいたけ", "パクチー"]} onChange={vi.fn()} />);

    const group = screen.getByRole("group", { name: "NG食材・苦手な食材" });
    expect(within(group).getByText("しいたけ")).toBeDefined();
    expect(within(group).getByText("パクチー")).toBeDefined();
    expect(within(group).getAllByRole("button", { name: /を削除$/ })).toHaveLength(2);
  });

  it("renders no chips when the list is empty (Requirement 3.5)", () => {
    render(<IngredientChipList label="NG食材・苦手な食材" value={[]} onChange={vi.fn()} />);

    const group = screen.getByRole("group", { name: "NG食材・苦手な食材" });
    expect(within(group).queryAllByRole("button", { name: /を削除$/ })).toHaveLength(0);
  });

  it("calls onChange with the new ingredient appended when the add button is clicked (Requirement 3.3)", () => {
    const onChange = vi.fn();
    render(<IngredientChipList label="好きな食材・よく使ってほしい食材" value={["鮭"]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("好きな食材・よく使ってほしい食材に追加する食材名"), {
      target: { value: "鶏むね肉" },
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ 追加" }));

    expect(onChange).toHaveBeenCalledWith(["鮭", "鶏むね肉"]);
  });

  it("trims surrounding whitespace before adding an ingredient", () => {
    const onChange = vi.fn();
    render(<IngredientChipList label="NG食材・苦手な食材" value={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("NG食材・苦手な食材に追加する食材名"), {
      target: { value: "  レバー  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ 追加" }));

    expect(onChange).toHaveBeenCalledWith(["レバー"]);
  });

  it("clears the input after adding an ingredient", () => {
    render(<IngredientChipList label="NG食材・苦手な食材" value={[]} onChange={vi.fn()} />);
    const input = screen.getByLabelText("NG食材・苦手な食材に追加する食材名") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "レバー" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ 追加" }));

    expect(input.value).toBe("");
  });

  it("adds the ingredient when Enter is pressed in the input", () => {
    const onChange = vi.fn();
    render(<IngredientChipList label="NG食材・苦手な食材" value={[]} onChange={onChange} />);
    const input = screen.getByLabelText("NG食材・苦手な食材に追加する食材名");

    fireEvent.change(input, { target: { value: "レバー" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["レバー"]);
  });

  it("does not call onChange when adding a blank ingredient (UI guard, not a business rule)", () => {
    const onChange = vi.fn();
    render(<IngredientChipList label="NG食材・苦手な食材" value={["しいたけ"]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("NG食材・苦手な食材に追加する食材名"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "＋ 追加" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with the remaining ingredients when a chip's remove button is clicked (Requirement 3.4)", () => {
    const onChange = vi.fn();
    render(
      <IngredientChipList label="NG食材・苦手な食材" value={["しいたけ", "パクチー", "レバー"]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "パクチーを削除" }));

    expect(onChange).toHaveBeenCalledWith(["しいたけ", "レバー"]);
  });
});
