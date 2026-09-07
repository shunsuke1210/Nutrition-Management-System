import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ApiError, Result } from "../../api/types.js";
import type { RecipeDetail } from "@nutrition/shared";
import * as mealSlotClient from "../../api/mealSlotClient.js";
import { RecipeDetailModal } from "./RecipeDetailModal.js";

/**
 * `mealSlotClient`（本コンポーネントが直接呼び出す唯一のクライアント。design.md
 * Traceability table参照）をモックする。ProfilePage.test.tsxの
 * `vi.mock("../api/profileClient.js", ...)` + `vi.mocked(...)` と同じパターン。
 */
vi.mock("../../api/mealSlotClient.js", () => ({ generateRecipeDetail: vi.fn() }));

const mockedGenerateRecipeDetail = vi.mocked(mealSlotClient.generateRecipeDetail);

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットし、モックの呼び出し履歴・実装も破棄する
// （ProfilePage.test.tsxと同じ方針）。
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** 制御可能なPromiseを作る（useAsyncData.test.tsxのcreateDeferredと同じパターン）。 */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildRecipeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    mealSlotId: 42,
    servings: 1,
    cookingTimeMinutes: 10,
    steps: [
      "鶏むね肉は茹でて冷まし、手でさく。",
      "海藻ミックスは水で戻し、水気をよく切る。",
      "すべてを合わせ、ポン酢とごま油で和える。",
    ],
    ingredients: [
      { foodId: "11001", quantity: 100, unit: "g", name: "鶏むね肉" },
      { foodId: "11002", quantity: 3, unit: "個", name: "ミニトマト" },
      { foodId: "11003", quantity: 1, unit: "大さじ", name: "ポン酢" },
      { foodId: "11004", quantity: 0.5, unit: "小さじ", name: "ごま油" },
    ],
    nutrition: { energyKcal: 310, proteinG: 35, fatG: 8, carbG: 12 },
    supplementarySuggestions: [
      {
        dishName: "もずく酢",
        ingredients: [{ foodId: "09000", quantity: 40, unit: "g", name: "もずく" }],
        nutritionDelta: { energyKcal: 15, proteinG: 0.8, fatG: 0.2, carbG: 1.5 },
      },
      {
        dishName: "レタスサラダ（ノンオイル）",
        ingredients: [{ foodId: "06001", quantity: 30, unit: "g", name: "レタス" }],
        nutritionDelta: { energyKcal: 20, proteinG: 1.0, fatG: -0.5, carbG: 3.0 },
      },
    ],
    ...overrides,
  };
}

const SOME_API_ERROR: ApiError = {
  type: "generation_failed",
  reason: "claude_request_failed",
  message: "boom",
};

describe("RecipeDetailModal", () => {
  it("calls generateRecipeDetail with the exact weekStartDate/dayIndex/mealType props on mount", () => {
    mockedGenerateRecipeDetail.mockReturnValue(new Promise(() => {}));

    render(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={2}
        mealType="lunch"
        dishName="鶏むね肉と海藻サラダ"
        onClose={vi.fn()}
      />,
    );

    expect(mockedGenerateRecipeDetail).toHaveBeenCalledTimes(1);
    expect(mockedGenerateRecipeDetail).toHaveBeenCalledWith("2026-09-01", 2, "lunch");
  });

  it("shows a loading indicator and no recipe content while the fetch is pending (Requirement 6.5)", () => {
    const deferred = createDeferred<Result<RecipeDetail, ApiError>>();
    mockedGenerateRecipeDetail.mockReturnValue(deferred.promise);

    const { container } = render(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={0}
        mealType="lunch"
        dishName="鶏むね肉と海藻サラダ"
        onClose={vi.fn()}
      />,
    );

    expect(container.textContent).toMatch(/生成中/);
    expect(container.querySelector(".ingredient-list")).toBeNull();
    expect(container.querySelector(".step-list")).toBeNull();
    expect(container.querySelector(".recipe-meta")).toBeNull();
  });

  it("renders the header (dishName + eyebrow) for dayIndex 0 (月曜)", async () => {
    mockedGenerateRecipeDetail.mockResolvedValue({ ok: true, value: buildRecipeDetail() });

    render(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={0}
        mealType="lunch"
        dishName="鶏むね肉と海藻サラダ"
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "レシピ詳細" });
    expect(within(dialog).getByText("鶏むね肉と海藻サラダ")).toBeDefined();
    expect(within(dialog).getByText("月曜・昼食")).toBeDefined();
  });

  it("renders the correct eyebrow for a different dayIndex (3 -> 木曜), proving a real weekday lookup", async () => {
    mockedGenerateRecipeDetail.mockResolvedValue({ ok: true, value: buildRecipeDetail() });

    render(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={3}
        mealType="dinner"
        dishName="鶏団子と野菜の鍋"
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "レシピ詳細" });
    expect(within(dialog).getByText("木曜・夕食")).toBeDefined();
  });

  it(
    "on success, renders cookingTimeMinutes/servings/kcal, every ingredient's name+formatted quantity " +
      "(including 大さじ/小さじ unit-prefix exception and normal suffix units), every step in order, and " +
      "both supplementary suggestions' dish names + correctly signed/formatted 4-field delta text " +
      "(Requirement 6.2, 6.3)",
    async () => {
      mockedGenerateRecipeDetail.mockResolvedValue({ ok: true, value: buildRecipeDetail() });

      render(
        <RecipeDetailModal
          weekStartDate="2026-09-01"
          dayIndex={0}
          mealType="lunch"
          dishName="鶏むね肉と海藻サラダ"
          onClose={vi.fn()}
        />,
      );

      const dialog = await screen.findByRole("dialog", { name: "レシピ詳細" });

      const meta = dialog.querySelector(".recipe-meta");
      expect(meta?.textContent).toContain("調理時間 10分");
      expect(meta?.textContent).toContain("1人前");
      expect(meta?.textContent).toContain("310kcal");

      const ingredientRows = Array.from(dialog.querySelectorAll(".ingredient-list li"));
      expect(ingredientRows.length).toBe(4);
      const ingredientTexts = ingredientRows.map((row) => row.textContent);
      expect(ingredientTexts).toContain("鶏むね肉100g");
      expect(ingredientTexts).toContain("ミニトマト3個");
      expect(ingredientTexts).toContain("ポン酢大さじ1");
      expect(ingredientTexts).toContain("ごま油小さじ0.5");

      const stepRows = Array.from(dialog.querySelectorAll(".step-list li")).map((row) => row.textContent);
      expect(stepRows).toEqual([
        "鶏むね肉は茹でて冷まし、手でさく。",
        "海藻ミックスは水で戻し、水気をよく切る。",
        "すべてを合わせ、ポン酢とごま油で和える。",
      ]);

      const extraItems = Array.from(dialog.querySelectorAll(".extra-item"));
      expect(extraItems.length).toBe(2);

      const mozukuItem = extraItems.find((item) => item.querySelector(".name")?.textContent === "もずく酢");
      expect(mozukuItem?.querySelector(".meta")?.textContent).toBe(
        "+15kcal・たんぱく質+0.8g・脂質+0.2g・炭水化物+1.5g",
      );

      // 負のデルタ値（脂質-0.5g）を含む2件目の副菜提案で符号処理の両方向を検証する。
      const lettuceItem = extraItems.find(
        (item) => item.querySelector(".name")?.textContent === "レタスサラダ（ノンオイル）",
      );
      expect(lettuceItem?.querySelector(".meta")?.textContent).toBe(
        "+20kcal・たんぱく質+1.0g・脂質-0.5g・炭水化物+3.0g",
      );

      // supplementarySuggestion自体の材料一覧は表示しない（Requirement 6.3/9.3のスコープ外）。
      expect(within(dialog).queryByText("もずく")).toBeNull();
    },
  );

  it("on failure, renders a failure indicator and no recipe content, no ingredient/step data (Requirement 6.6)", async () => {
    mockedGenerateRecipeDetail.mockResolvedValue({ ok: false, error: SOME_API_ERROR });

    const { container } = render(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={0}
        mealType="lunch"
        dishName="鶏むね肉と海藻サラダ"
        onClose={vi.fn()}
      />,
    );

    await screen.findByRole("dialog", { name: "レシピ詳細" });

    expect(container.textContent).toMatch(/失敗/);
    expect(container.querySelector(".ingredient-list")).toBeNull();
    expect(container.querySelector(".step-list")).toBeNull();
    expect(container.querySelector(".recipe-meta")).toBeNull();
    expect(container.querySelector(".extra-suggest")).toBeNull();
  });

  it("calls onClose exactly once when the close button is clicked", async () => {
    mockedGenerateRecipeDetail.mockResolvedValue({ ok: true, value: buildRecipeDetail() });
    const onClose = vi.fn();

    render(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={0}
        mealType="lunch"
        dishName="鶏むね肉と海藻サラダ"
        onClose={onClose}
      />,
    );

    await screen.findByRole("dialog", { name: "レシピ詳細" });

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose exactly once when the backdrop is clicked (Requirement 6.4)", async () => {
    mockedGenerateRecipeDetail.mockResolvedValue({ ok: true, value: buildRecipeDetail() });
    const onClose = vi.fn();

    const { container } = render(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={0}
        mealType="lunch"
        dishName="鶏むね肉と海藻サラダ"
        onClose={onClose}
      />,
    );

    await screen.findByRole("dialog", { name: "レシピ詳細" });

    const backdrop = container.querySelector(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-fetches with new arguments when dayIndex/mealType props change while mounted", async () => {
    mockedGenerateRecipeDetail.mockResolvedValue({ ok: true, value: buildRecipeDetail() });

    const { rerender } = render(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={0}
        mealType="lunch"
        dishName="鶏むね肉と海藻サラダ"
        onClose={vi.fn()}
      />,
    );

    await screen.findByRole("dialog", { name: "レシピ詳細" });
    expect(mockedGenerateRecipeDetail).toHaveBeenCalledTimes(1);
    expect(mockedGenerateRecipeDetail).toHaveBeenNthCalledWith(1, "2026-09-01", 0, "lunch");

    rerender(
      <RecipeDetailModal
        weekStartDate="2026-09-01"
        dayIndex={3}
        mealType="dinner"
        dishName="鶏団子と野菜の鍋"
        onClose={vi.fn()}
      />,
    );

    await vi.waitFor(() => expect(mockedGenerateRecipeDetail).toHaveBeenCalledTimes(2));
    expect(mockedGenerateRecipeDetail).toHaveBeenNthCalledWith(2, "2026-09-01", 3, "dinner");
  });
});
