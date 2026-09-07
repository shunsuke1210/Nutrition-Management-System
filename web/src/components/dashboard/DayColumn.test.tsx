import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DayMenu, MealSlot, VerifiedNutritionValues } from "@nutrition/shared";
import { DayColumn } from "./DayColumn.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（PeriodToggle.test.tsxと同じ方針）。
afterEach(() => {
  cleanup();
});

function buildVerifiedNutritionValues(): VerifiedNutritionValues {
  return {
    energyKcal: 500,
    proteinG: 20,
    fatG: 15,
    carbG: 60,
    fiberG: 5,
    calciumMg: 200,
    ironMg: 3,
    vitaminAUg: 300,
    vitaminDUg: 2,
    vitaminB1Mg: 0.4,
    vitaminB2Mg: 0.4,
    vitaminCMg: 30,
    saltEquivalentG: 1.5,
  };
}

function buildMealSlot(overrides: Partial<MealSlot> = {}): MealSlot {
  return {
    mealType: "breakfast",
    dishName: "サンプル料理",
    ingredients: [{ foodId: "11001", quantity: 100, unit: "g" }],
    nutrition: buildVerifiedNutritionValues(),
    ...overrides,
  };
}

// 意図的に朝食/昼食/夕食/間食の順ではない並び（間食->夕食->朝食->昼食）にして、
// DayColumnがmealTypeで検索していること（配列インデックス順を信用していないこと）を証明する。
function buildShuffledMeals(): MealSlot[] {
  return [
    buildMealSlot({ mealType: "snack", dishName: "素焼きアーモンド" }),
    buildMealSlot({ mealType: "dinner", dishName: "白身魚と蒸し野菜" }),
    buildMealSlot({ mealType: "breakfast", dishName: "ギリシャヨーグルトと果物" }),
    buildMealSlot({ mealType: "lunch", dishName: "鶏むね肉と海藻サラダ" }),
  ];
}

function buildDayMenu(overrides: Partial<DayMenu> = {}): DayMenu {
  return {
    dayDate: "2026-09-01",
    dayIndex: 0,
    meals: buildShuffledMeals(),
    dayNutrition: buildVerifiedNutritionValues(),
    plannedKcal: 1640,
    targetKcal: 2050,
    varianceKcal: -410,
    ...overrides,
  };
}

describe("DayColumn", () => {
  it('renders the "月" weekday label for dayIndex 0 (Requirement 4.3)', () => {
    const { container } = render(
      <DayColumn
        day={buildDayMenu({ dayIndex: 0 })}
        isRegenerating={false}
        disabled={false}
        errorMessage={null}
        onRegenerate={vi.fn()}
        onMealClick={vi.fn()}
      />,
    );

    expect(container.querySelector(".name")?.textContent).toBe("月");
  });

  it('renders the "日" weekday label for dayIndex 6, proving a real lookup (not a hardcoded string)', () => {
    const { container } = render(
      <DayColumn
        day={buildDayMenu({ dayIndex: 6 })}
        isRegenerating={false}
        disabled={false}
        errorMessage={null}
        onRegenerate={vi.fn()}
        onMealClick={vi.fn()}
      />,
    );

    expect(container.querySelector(".name")?.textContent).toBe("日");
  });

  it("renders the 4 meal rows with correct Japanese mealType labels and dish names, looked up by mealType " +
    "from a deliberately shuffled meals array (Requirement 4.3)", () => {
    const { container } = render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={false}
        disabled={false}
        errorMessage={null}
        onRegenerate={vi.fn()}
        onMealClick={vi.fn()}
      />,
    );

    const rows = Array.from(container.querySelectorAll(".meal-row"));
    expect(rows.length).toBe(4);

    const labels = rows.map((row) => row.querySelector(".meal-type")?.textContent);
    expect(labels).toEqual(["朝食", "昼食", "夕食", "間食"]);

    const findDish = (label: string) =>
      rows.find((row) => row.querySelector(".meal-type")?.textContent === label)?.querySelector(".dish")
        ?.textContent;
    expect(findDish("朝食")).toBe("ギリシャヨーグルトと果物");
    expect(findDish("昼食")).toBe("鶏むね肉と海藻サラダ");
    expect(findDish("夕食")).toBe("白身魚と蒸し野菜");
    expect(findDish("間食")).toBe("素焼きアーモンド");
  });

  it('renders formatted plannedKcal as "1,640kcal" (toLocaleString("en-US") convention)', () => {
    const { container } = render(
      <DayColumn
        day={buildDayMenu({ plannedKcal: 1640 })}
        isRegenerating={false}
        disabled={false}
        errorMessage={null}
        onRegenerate={vi.fn()}
        onMealClick={vi.fn()}
      />,
    );

    expect(container.querySelector(".kcal")?.textContent).toBe("1,640kcal");
  });

  it("shows a processing indicator and disables the button when isRegenerating is true (Requirement 5.5)", () => {
    const { container } = render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={true}
        disabled={false}
        errorMessage={null}
        onRegenerate={vi.fn()}
        onMealClick={vi.fn()}
      />,
    );

    // 食事セルもボタンになったため（Requirement 6.1）、`.regen-btn`クラスで差し替えボタンを
    // 一意に特定する（`screen.getByRole("button")`は複数ヒットするため使えない）。
    const button = container.querySelector(".regen-btn") as HTMLButtonElement;
    expect(button.textContent).not.toBe("差し替え");
    expect(button.disabled).toBe(true);
  });

  it("disables the button when disabled is true even while isRegenerating is false (a different day/the " +
    "week is regenerating, Requirement 5.5)", () => {
    const { container } = render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={false}
        disabled={true}
        errorMessage={null}
        onRegenerate={vi.fn()}
        onMealClick={vi.fn()}
      />,
    );

    const button = container.querySelector(".regen-btn") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("差し替え");
  });

  it("renders the errorMessage text somewhere in the card when present (Requirement 5.6)", () => {
    render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={false}
        disabled={false}
        errorMessage="この曜日の差し替えに失敗しました。"
        onRegenerate={vi.fn()}
        onMealClick={vi.fn()}
      />,
    );

    expect(screen.getByText("この曜日の差し替えに失敗しました。")).toBeDefined();
  });

  it("does not render an error message when errorMessage is null", () => {
    const { container } = render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={false}
        disabled={false}
        errorMessage={null}
        onRegenerate={vi.fn()}
        onMealClick={vi.fn()}
      />,
    );

    expect(container.querySelector(".day-regen-error")).toBeNull();
  });

  it("calls onRegenerate exactly once when the regen button is clicked while neither isRegenerating nor " +
    "disabled (Requirement 5.2)", () => {
    const onRegenerate = vi.fn();
    const { container } = render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={false}
        disabled={false}
        errorMessage={null}
        onRegenerate={onRegenerate}
        onMealClick={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelector(".regen-btn") as HTMLButtonElement);

    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("does not call onRegenerate when clicking while isRegenerating is true", () => {
    const onRegenerate = vi.fn();
    const { container } = render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={true}
        disabled={false}
        errorMessage={null}
        onRegenerate={onRegenerate}
        onMealClick={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelector(".regen-btn") as HTMLButtonElement);

    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it("does not call onRegenerate when clicking while disabled is true", () => {
    const onRegenerate = vi.fn();
    const { container } = render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={false}
        disabled={true}
        errorMessage={null}
        onRegenerate={onRegenerate}
        onMealClick={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelector(".regen-btn") as HTMLButtonElement);

    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it("calls onMealClick with the correct mealType when a dish name is clicked (Requirement 6.1)", () => {
    const onMealClick = vi.fn();
    const { container } = render(
      <DayColumn
        day={buildDayMenu()}
        isRegenerating={false}
        disabled={false}
        errorMessage={null}
        onRegenerate={vi.fn()}
        onMealClick={onMealClick}
      />,
    );

    const rows = Array.from(container.querySelectorAll(".meal-row"));
    const lunchDish = rows
      .find((row) => row.querySelector(".meal-type")?.textContent === "昼食")
      ?.querySelector(".dish") as HTMLButtonElement;
    fireEvent.click(lunchDish);

    expect(onMealClick).toHaveBeenCalledTimes(1);
    expect(onMealClick).toHaveBeenCalledWith("lunch");

    const dinnerDish = rows
      .find((row) => row.querySelector(".meal-type")?.textContent === "夕食")
      ?.querySelector(".dish") as HTMLButtonElement;
    fireEvent.click(dinnerDish);

    expect(onMealClick).toHaveBeenCalledTimes(2);
    expect(onMealClick).toHaveBeenNthCalledWith(2, "dinner");
  });
});
