import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ShoppingList, ShoppingListItem } from "@nutrition/shared";
import { ShoppingListSection } from "./ShoppingListSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（WeeklyMenuSection.test.tsxと同じ方針）。
afterEach(() => {
  cleanup();
});

function buildItem(overrides: Partial<ShoppingListItem>): ShoppingListItem {
  return {
    foodId: "food-1",
    name: "白菜",
    category: "野菜・きのこ",
    quantityGrams: 500,
    displayQuantity: 0.5,
    displayUnit: "玉",
    ...overrides,
  };
}

/** 4カテゴリすべてに品目が存在し、うち1カテゴリは2件以上を含むフィクスチャ。 */
function buildFullShoppingList(): ShoppingList {
  return {
    weekStartDate: "2026-09-01",
    // 意図的にCATEGORY_ORDER（野菜・きのこ→肉・魚→乳製品・卵・豆→調味料・その他）とは異なる
    // 出現順（調味料・その他→乳製品・卵・豆→肉・魚→野菜・きのこ、ほぼ逆順）で並べる。これにより
    // 「Mapの挿入順（＝items内の初出順）をそのまま描画する」実装と「固定のCATEGORY_ORDERで
    // 描画する」実装とで結果が一致しなくなり、下記のDOM順アサーションが後者のみを正しく検証する
    // （レビュー指摘: 全カテゴリの品目がCATEGORY_ORDER順に並んだフィクスチャだけでは両実装を
    // 区別できないため）。
    items: [
      buildItem({ foodId: "5", name: "味噌", category: "調味料・その他", displayQuantity: 1, displayUnit: "個" }),
      buildItem({ foodId: "4", name: "卵", category: "乳製品・卵・豆", displayQuantity: 1, displayUnit: "パック" }),
      buildItem({ foodId: "3", name: "鶏むね肉", category: "肉・魚", displayQuantity: 400, displayUnit: "g" }),
      buildItem({ foodId: "1", name: "白菜", category: "野菜・きのこ", displayQuantity: 0.5, displayUnit: "玉" }),
      buildItem({ foodId: "2", name: "にんじん", category: "野菜・きのこ", displayQuantity: 3, displayUnit: "本" }),
    ],
  };
}

describe("ShoppingListSection", () => {
  it("renders only a loading indicator when data is null and isLoading is true (no .shop-cat)", () => {
    const { container } = render(<ShoppingListSection data={null} isLoading={true} error={null} />);

    expect(container.querySelectorAll(".shop-cat").length).toBe(0);
    expect(container.textContent).toBeTruthy();
  });

  it("renders only a fetch-error indicator when data is null, isLoading is false, and error is non-null", () => {
    const { container } = render(
      <ShoppingListSection data={null} isLoading={false} error={new Error("network down")} />,
    );

    expect(container.querySelectorAll(".shop-cat").length).toBe(0);
    expect(container.textContent).toContain("失敗");
  });

  it(
    'shows a "not yet generated" message when data/isLoading/error are null/false/null, with no ' +
      "generate button (Requirement 8.5; distinguishes this from WeeklyMenuSection's empty state)",
    () => {
      const { container } = render(<ShoppingListSection data={null} isLoading={false} error={null} />);

      expect(container.querySelectorAll(".shop-cat").length).toBe(0);
      expect(container.textContent).toMatch(/未生成|まだ生成/);
      expect(container.querySelectorAll("button").length).toBe(0);
    },
  );

  it(
    "renders exactly 4 .shop-cat blocks in the fixed category order, each item's name and " +
      "displayQuantity+displayUnit concatenated with no space (Requirement 8.1-8.4)",
    () => {
      const { container } = render(
        <ShoppingListSection data={buildFullShoppingList()} isLoading={false} error={null} />,
      );

      const shopCats = container.querySelectorAll(".shop-cat");
      expect(shopCats.length).toBe(4);

      const headings = Array.from(container.querySelectorAll(".shop-cat h4")).map((h) => h.textContent);
      expect(headings).toEqual(["野菜・きのこ", "肉・魚", "乳製品・卵・豆", "調味料・その他"]);

      // 野菜・きのこ（2件）
      const vegCat = shopCats[0]!;
      const vegItems = Array.from(vegCat.querySelectorAll("li"));
      expect(vegItems.length).toBe(2);
      expect(vegItems[0]!.textContent).toContain("白菜");
      expect(vegItems[0]!.querySelector(".qty")?.textContent).toBe("0.5玉");
      expect(vegItems[1]!.textContent).toContain("にんじん");
      expect(vegItems[1]!.querySelector(".qty")?.textContent).toBe("3本");

      // 肉・魚（1件）
      const meatCat = shopCats[1]!;
      expect(meatCat.querySelector("li")?.textContent).toContain("鶏むね肉");
      expect(meatCat.querySelector(".qty")?.textContent).toBe("400g");

      // 装飾用の空span.boxが各liの先頭に存在すること（マークアップ一致確認）
      expect(vegCat.querySelector("li .box")).not.toBeNull();
    },
  );

  it("skips rendering a .shop-cat block for a category with zero items (only 3 blocks render)", () => {
    const data: ShoppingList = {
      weekStartDate: "2026-09-01",
      items: [
        buildItem({ foodId: "1", name: "白菜", category: "野菜・きのこ" }),
        buildItem({ foodId: "2", name: "鶏むね肉", category: "肉・魚" }),
        buildItem({ foodId: "3", name: "味噌", category: "調味料・その他" }),
        // 乳製品・卵・豆は0件
      ],
    };

    const { container } = render(<ShoppingListSection data={data} isLoading={false} error={null} />);

    const shopCats = container.querySelectorAll(".shop-cat");
    expect(shopCats.length).toBe(3);

    const headings = Array.from(container.querySelectorAll(".shop-cat h4")).map((h) => h.textContent);
    expect(headings).toEqual(["野菜・きのこ", "肉・魚", "調味料・その他"]);
  });

  it("renders a non-round decimal displayQuantity as a plain number, not converted to a fraction", () => {
    const data: ShoppingList = {
      weekStartDate: "2026-09-01",
      items: [buildItem({ foodId: "1", name: "白菜", category: "野菜・きのこ", displayQuantity: 0.5, displayUnit: "玉" })],
    };

    const { container } = render(<ShoppingListSection data={data} isLoading={false} error={null} />);

    const qty = container.querySelector(".shop-cat .qty");
    expect(qty?.textContent).toBe("0.5玉");
    expect(qty?.textContent).not.toContain("1/2");
  });
});
