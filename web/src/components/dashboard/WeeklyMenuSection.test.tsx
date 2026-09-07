import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DayMenu, MealSlot, MealType, VerifiedNutritionValues, WeekMenuPlan } from "@nutrition/shared";
import type { ApiError, Result } from "../../api/types.js";
import * as mealSlotClient from "../../api/mealSlotClient.js";
import { WeeklyMenuSection } from "./WeeklyMenuSection.js";

/**
 * `WeeklyMenuSection`がレンダリングする`RecipeDetailModal`（task 4.2）が直接呼び出す
 * `mealSlotClient.generateRecipeDetail`をモックする（ProfilePage.test.tsxと同じ
 * `vi.mock(...)` + `vi.mocked(...)`パターン）。モーダルを開くテストでの実際のネットワーク
 * 呼び出しを防ぐためであり、本ファイルの既存テスト（食事セルをクリックしないもの）には影響しない。
 */
vi.mock("../../api/mealSlotClient.js", () => ({ generateRecipeDetail: vi.fn() }));

const mockedGenerateRecipeDetail = vi.mocked(mealSlotClient.generateRecipeDetail);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（NutritionSummarySection.test.tsxと同じ方針）。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
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

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function buildMealSlot(dayIndex: number, mealType: MealType): MealSlot {
  return {
    mealType,
    dishName: `${dayIndex}日目-${mealType}-料理`,
    ingredients: [{ foodId: "11001", quantity: 100, unit: "g" }],
    nutrition: buildVerifiedNutritionValues(),
  };
}

function buildDayMenu(dayIndex: number): DayMenu {
  const plannedKcal = 1600 + dayIndex * 10;
  return {
    dayDate: `2026-09-0${dayIndex + 1}`,
    dayIndex,
    meals: MEAL_TYPES.map((mealType) => buildMealSlot(dayIndex, mealType)),
    dayNutrition: buildVerifiedNutritionValues(),
    plannedKcal,
    targetKcal: 2050,
    varianceKcal: plannedKcal - 2050,
  };
}

function buildWeekMenuPlan(): WeekMenuPlan {
  return {
    weekStartDate: "2026-09-01",
    generatedAt: "2026-09-01T00:00:00.000Z",
    days: Array.from({ length: 7 }, (_, dayIndex) => buildDayMenu(dayIndex)),
  };
}

const WEEK_PLAN = buildWeekMenuPlan();

const SOME_API_ERROR: ApiError = {
  type: "generation_failed",
  reason: "claude_request_failed",
  message: "boom",
};

interface ControlledPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createControlledPromise<T>(): ControlledPromise<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("WeeklyMenuSection", () => {
  describe("initial-load states (Requirement 4.5)", () => {
    it("renders only a loading indicator when data is null and isLoading is true (no day columns, no buttons)", () => {
      const { container } = render(
        <WeeklyMenuSection
          data={null}
          isLoading={true}
          error={null}
          onRegenerateWeek={vi.fn()}
          onRegenerateDay={vi.fn()}
        />,
      );

      expect(container.querySelectorAll(".day-col").length).toBe(0);
      expect(container.querySelectorAll("button").length).toBe(0);
      expect(container.textContent).toBeTruthy();
    });

    it("renders only a fetch-error indicator when data is null, isLoading is false, and error is non-null", () => {
      const { container } = render(
        <WeeklyMenuSection
          data={null}
          isLoading={false}
          error={new Error("network down")}
          onRegenerateWeek={vi.fn()}
          onRegenerateDay={vi.fn()}
        />,
      );

      expect(container.querySelectorAll(".day-col").length).toBe(0);
      expect(container.querySelectorAll("button").length).toBe(0);
      expect(container.textContent).toContain("失敗");
    });

    it(
      'shows a "not yet generated" message plus a generate button when data/isLoading/error are ' +
        "null/false/null; clicking it calls onRegenerateWeek exactly once (Requirement 4.5)",
      () => {
        const onRegenerateWeek = vi.fn().mockResolvedValue({ ok: true, value: WEEK_PLAN });
        const { container } = render(
          <WeeklyMenuSection
            data={null}
            isLoading={false}
            error={null}
            onRegenerateWeek={onRegenerateWeek}
            onRegenerateDay={vi.fn()}
          />,
        );

        expect(container.querySelectorAll(".day-col").length).toBe(0);
        expect(container.textContent).toMatch(/未生成|まだ生成/);

        const buttons = container.querySelectorAll("button");
        expect(buttons.length).toBe(1);

        fireEvent.click(buttons[0]!);

        expect(onRegenerateWeek).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe("generated state rendering (Requirement 4.3, 4.4, 5.1)", () => {
    it("renders 7 day columns in dayIndex 0-6 order with correct weekday labels, plus the week-regen button", () => {
      const { container } = render(
        <WeeklyMenuSection
          data={WEEK_PLAN}
          isLoading={false}
          error={null}
          onRegenerateWeek={vi.fn()}
          onRegenerateDay={vi.fn()}
        />,
      );

      const dayCols = container.querySelectorAll(".day-col");
      expect(dayCols.length).toBe(7);

      const labels = Array.from(dayCols).map((col) => col.querySelector(".name")?.textContent);
      expect(labels).toEqual(["月", "火", "水", "木", "金", "土", "日"]);

      const weekButton = container.querySelector(".week-regen");
      expect(weekButton).not.toBeNull();
      expect(weekButton?.textContent).toContain("週全体を差し替え");
    });
  });

  describe("week-level regenerate (Requirement 5.3, 5.5, 5.6)", () => {
    it(
      "calling the week regen shows pending state (processing + disabled) on the week button and disables " +
        "day buttons (global lock); a second click while pending does not call onRegenerateWeek again",
      () => {
        const { promise, resolve } = createControlledPromise<Result<WeekMenuPlan, ApiError>>();
        const onRegenerateWeek = vi.fn().mockReturnValue(promise);
        const { container } = render(
          <WeeklyMenuSection
            data={WEEK_PLAN}
            isLoading={false}
            error={null}
            onRegenerateWeek={onRegenerateWeek}
            onRegenerateDay={vi.fn()}
          />,
        );

        const weekButton = container.querySelector(".week-regen") as HTMLButtonElement;
        fireEvent.click(weekButton);

        expect(onRegenerateWeek).toHaveBeenCalledTimes(1);
        expect(weekButton.disabled).toBe(true);
        expect(weekButton.textContent).not.toContain("週全体を差し替え");

        const dayButtons = Array.from(container.querySelectorAll(".day-col .regen-btn")) as HTMLButtonElement[];
        expect(dayButtons.length).toBe(7);
        expect(dayButtons[0]!.disabled).toBe(true);
        expect(dayButtons[6]!.disabled).toBe(true);

        // 保留中の再クリックは受け付けない（Requirement 5.5）。
        fireEvent.click(weekButton);
        expect(onRegenerateWeek).toHaveBeenCalledTimes(1);

        resolve({ ok: true, value: WEEK_PLAN });
      },
    );

    it("clears the lock with no error message after the week-regen promise resolves successfully", async () => {
      const onRegenerateWeek = vi.fn().mockResolvedValue({ ok: true, value: WEEK_PLAN } as Result<
        WeekMenuPlan,
        ApiError
      >);
      const { container } = render(
        <WeeklyMenuSection
          data={WEEK_PLAN}
          isLoading={false}
          error={null}
          onRegenerateWeek={onRegenerateWeek}
          onRegenerateDay={vi.fn()}
        />,
      );

      const weekButton = container.querySelector(".week-regen") as HTMLButtonElement;
      fireEvent.click(weekButton);

      await waitFor(() => expect(weekButton.disabled).toBe(false));

      expect(weekButton.textContent).toContain("週全体を差し替え");
      expect(container.textContent).not.toContain("失敗");
      const dayButtons = Array.from(container.querySelectorAll(".day-col .regen-btn")) as HTMLButtonElement[];
      expect(dayButtons.every((button) => !button.disabled)).toBe(true);
    });

    it(
      "clears the lock and shows an inline failure message after the week-regen promise resolves as a " +
        "failure, while leaving the originally-passed data unchanged (Requirement 5.6)",
      async () => {
        const onRegenerateWeek = vi.fn().mockResolvedValue({ ok: false, error: SOME_API_ERROR } as Result<
          WeekMenuPlan,
          ApiError
        >);
        const { container } = render(
          <WeeklyMenuSection
            data={WEEK_PLAN}
            isLoading={false}
            error={null}
            onRegenerateWeek={onRegenerateWeek}
            onRegenerateDay={vi.fn()}
          />,
        );

        const weekButton = container.querySelector(".week-regen") as HTMLButtonElement;
        fireEvent.click(weekButton);

        await waitFor(() => expect(weekButton.disabled).toBe(false));

        expect(container.textContent).toContain("失敗");

        // 元のdataプロップの内容がそのまま表示され続けていること（本コンポーネントは自身の
        // 表示するdataを書き換えないため、そもそも「元に戻す」対象が存在しない）。
        const dayCols = container.querySelectorAll(".day-col");
        expect(dayCols.length).toBe(7);
        expect(dayCols[0]!.textContent).toContain("0日目-breakfast-料理");
        expect(dayCols[0]!.querySelector(".kcal")?.textContent).toBe("1,600kcal");
        expect(dayCols[6]!.textContent).toContain("6日目-snack-料理");
      },
    );
  });

  describe("day-level regenerate (Requirement 5.4, 5.5, 5.6)", () => {
    it(
      "clicking a specific day's regen button calls onRegenerateDay with the correct dayIndex, shows " +
        "pending state on that day, and disables the week button + other days (global lock)",
      () => {
        const { promise, resolve } = createControlledPromise<Result<DayMenu, ApiError>>();
        const onRegenerateDay = vi.fn().mockReturnValue(promise);
        const { container } = render(
          <WeeklyMenuSection
            data={WEEK_PLAN}
            isLoading={false}
            error={null}
            onRegenerateWeek={vi.fn()}
            onRegenerateDay={onRegenerateDay}
          />,
        );

        const dayCols = container.querySelectorAll(".day-col");
        const targetButton = dayCols[2]!.querySelector(".regen-btn") as HTMLButtonElement;
        fireEvent.click(targetButton);

        expect(onRegenerateDay).toHaveBeenCalledTimes(1);
        expect(onRegenerateDay).toHaveBeenCalledWith(2);

        expect(targetButton.disabled).toBe(true);
        expect(targetButton.textContent).not.toBe("差し替え");

        const weekButton = container.querySelector(".week-regen") as HTMLButtonElement;
        expect(weekButton.disabled).toBe(true);

        const otherButton = dayCols[0]!.querySelector(".regen-btn") as HTMLButtonElement;
        expect(otherButton.disabled).toBe(true);
        expect(otherButton.textContent).toBe("差し替え"); // 処理中表示ではなく単に禁止されているだけ

        // 保留中の再クリックは受け付けない。
        fireEvent.click(targetButton);
        expect(onRegenerateDay).toHaveBeenCalledTimes(1);

        resolve({ ok: true, value: WEEK_PLAN.days[2]! });
      },
    );

    it("clears the lock with no error after a day regenerate succeeds", async () => {
      const onRegenerateDay = vi.fn().mockResolvedValue({ ok: true, value: WEEK_PLAN.days[3] } as Result<
        DayMenu,
        ApiError
      >);
      const { container } = render(
        <WeeklyMenuSection
          data={WEEK_PLAN}
          isLoading={false}
          error={null}
          onRegenerateWeek={vi.fn()}
          onRegenerateDay={onRegenerateDay}
        />,
      );

      const dayCols = container.querySelectorAll(".day-col");
      const targetButton = dayCols[3]!.querySelector(".regen-btn") as HTMLButtonElement;
      fireEvent.click(targetButton);

      await waitFor(() => expect(targetButton.disabled).toBe(false));

      expect(container.textContent).not.toContain("失敗");
      const weekButton = container.querySelector(".week-regen") as HTMLButtonElement;
      expect(weekButton.disabled).toBe(false);
    });

    it(
      "clears the lock and attributes the failure message to that specific day's card only after a day " +
        "regenerate fails, leaving all days' original content displayed unchanged (Requirement 5.6)",
      async () => {
        const onRegenerateDay = vi.fn().mockResolvedValue({ ok: false, error: SOME_API_ERROR } as Result<
          DayMenu,
          ApiError
        >);
        const { container } = render(
          <WeeklyMenuSection
            data={WEEK_PLAN}
            isLoading={false}
            error={null}
            onRegenerateWeek={vi.fn()}
            onRegenerateDay={onRegenerateDay}
          />,
        );

        const dayCols = container.querySelectorAll(".day-col");
        const targetButton = dayCols[4]!.querySelector(".regen-btn") as HTMLButtonElement;
        fireEvent.click(targetButton);

        await waitFor(() => expect(targetButton.disabled).toBe(false));

        // 失敗メッセージは対象の曜日カード(4)にのみ表示され、他のカード(0)には表示されない。
        expect(dayCols[4]!.textContent).toContain("失敗");
        expect(dayCols[0]!.textContent).not.toContain("失敗");
        // 週全体のバナー領域にはこのメッセージが出ない（曜日カードへの帰属を確認）。
        const weekActions = container.querySelector(".week-scroll-actions");
        expect(weekActions?.textContent).not.toContain("失敗");

        expect(dayCols[4]!.textContent).toContain("4日目-lunch-料理");
        expect(dayCols[0]!.textContent).toContain("0日目-breakfast-料理");
      },
    );
  });

  describe("double-click guard (Requirement 5.5)", () => {
    it("rapidly clicking the week-regen button twice before the promise resolves calls onRegenerateWeek only once", () => {
      const { promise } = createControlledPromise<Result<WeekMenuPlan, ApiError>>();
      const onRegenerateWeek = vi.fn().mockReturnValue(promise);
      const { container } = render(
        <WeeklyMenuSection
          data={WEEK_PLAN}
          isLoading={false}
          error={null}
          onRegenerateWeek={onRegenerateWeek}
          onRegenerateDay={vi.fn()}
        />,
      );

      const weekButton = container.querySelector(".week-regen") as HTMLButtonElement;
      fireEvent.click(weekButton);
      fireEvent.click(weekButton);

      expect(onRegenerateWeek).toHaveBeenCalledTimes(1);
    });

    it("rapidly clicking a day regen button twice before the promise resolves calls onRegenerateDay only once", () => {
      const { promise } = createControlledPromise<Result<DayMenu, ApiError>>();
      const onRegenerateDay = vi.fn().mockReturnValue(promise);
      const { container } = render(
        <WeeklyMenuSection
          data={WEEK_PLAN}
          isLoading={false}
          error={null}
          onRegenerateWeek={vi.fn()}
          onRegenerateDay={onRegenerateDay}
        />,
      );

      const targetButton = container.querySelectorAll(".day-col")[5]!.querySelector(
        ".regen-btn",
      ) as HTMLButtonElement;
      fireEvent.click(targetButton);
      fireEvent.click(targetButton);

      expect(onRegenerateDay).toHaveBeenCalledTimes(1);
    });
  });

  describe("recipe detail modal (Requirement 6.1, 6.4)", () => {
    it(
      "clicking a meal cell within a specific day column opens the RecipeDetailModal with the correct " +
        "eyebrow and dish name, and calls generateRecipeDetail with that meal's arguments",
      () => {
        mockedGenerateRecipeDetail.mockReturnValue(new Promise(() => {})); // 解決を待たず表示のみ検証する

        const { container } = render(
          <WeeklyMenuSection
            data={WEEK_PLAN}
            isLoading={false}
            error={null}
            onRegenerateWeek={vi.fn()}
            onRegenerateDay={vi.fn()}
          />,
        );

        expect(screen.queryByRole("dialog")).toBeNull();

        const targetDayCol = container.querySelectorAll(".day-col")[2]!; // dayIndex 2 -> 水曜
        const dinnerRow = Array.from(targetDayCol.querySelectorAll(".meal-row")).find(
          (row) => row.querySelector(".meal-type")?.textContent === "夕食",
        )!;
        fireEvent.click(dinnerRow.querySelector(".dish") as HTMLButtonElement);

        const dialog = screen.getByRole("dialog", { name: "レシピ詳細" });
        expect(within(dialog).getByText("水曜・夕食")).toBeDefined();
        expect(within(dialog).getByText("2日目-dinner-料理")).toBeDefined();

        expect(mockedGenerateRecipeDetail).toHaveBeenCalledWith("2026-09-01", 2, "dinner");
      },
    );

    it(
      "clicking the modal's close button removes it from the DOM and leaves the underlying week view " +
        "visible/interactable (Requirement 6.4)",
      () => {
        mockedGenerateRecipeDetail.mockReturnValue(new Promise(() => {}));

        const { container } = render(
          <WeeklyMenuSection
            data={WEEK_PLAN}
            isLoading={false}
            error={null}
            onRegenerateWeek={vi.fn()}
            onRegenerateDay={vi.fn()}
          />,
        );

        const firstDishButton = container.querySelector(".day-col .dish") as HTMLButtonElement;
        fireEvent.click(firstDishButton);
        expect(screen.getByRole("dialog", { name: "レシピ詳細" })).toBeDefined();

        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

        expect(screen.queryByRole("dialog")).toBeNull();
        // 元の1週間のおすすめ献立表示に戻り、引き続き操作可能であること。
        expect(container.querySelectorAll(".day-col").length).toBe(7);
        const weekButton = container.querySelector(".week-regen") as HTMLButtonElement;
        expect(weekButton.disabled).toBe(false);
      },
    );

    it("clicking the modal's backdrop also closes it (Requirement 6.4)", () => {
      mockedGenerateRecipeDetail.mockReturnValue(new Promise(() => {}));

      const { container } = render(
        <WeeklyMenuSection
          data={WEEK_PLAN}
          isLoading={false}
          error={null}
          onRegenerateWeek={vi.fn()}
          onRegenerateDay={vi.fn()}
        />,
      );

      fireEvent.click(container.querySelector(".day-col .dish") as HTMLButtonElement);
      expect(screen.getByRole("dialog", { name: "レシピ詳細" })).toBeDefined();

      fireEvent.click(container.querySelector(".modal-backdrop") as HTMLButtonElement);

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
