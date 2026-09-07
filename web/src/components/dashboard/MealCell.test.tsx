import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MealCell } from "./MealCell.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（DayColumn.test.tsxと同じ方針）。
afterEach(() => {
  cleanup();
});

describe("MealCell", () => {
  it('renders the "朝食" Japanese label and the given dishName for mealType "breakfast"', () => {
    const { container } = render(
      <MealCell mealType="breakfast" dishName="ギリシャヨーグルトと果物" onClick={vi.fn()} />,
    );

    expect(container.querySelector(".meal-type")?.textContent).toBe("朝食");
    expect(container.querySelector(".dish")?.textContent).toBe("ギリシャヨーグルトと果物");
  });

  it('renders the "夕食" Japanese label for mealType "dinner", proving a real lookup (not hardcoded)', () => {
    const { container } = render(
      <MealCell mealType="dinner" dishName="白身魚と蒸し野菜" onClick={vi.fn()} />,
    );

    expect(container.querySelector(".meal-type")?.textContent).toBe("夕食");
    expect(container.querySelector(".dish")?.textContent).toBe("白身魚と蒸し野菜");
  });

  it("calls onClick exactly once when the dish button is clicked", () => {
    const onClick = vi.fn();
    render(<MealCell mealType="lunch" dishName="鶏むね肉と海藻サラダ" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
