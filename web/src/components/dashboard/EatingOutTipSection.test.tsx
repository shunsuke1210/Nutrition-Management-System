import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EatingOutSuggestion, EatingOutSuggestionResult } from "@nutrition/shared";
import { EatingOutTipSection } from "./EatingOutTipSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする（ShoppingListSection.test.tsxと同じ方針）。
afterEach(() => {
  cleanup();
});

function buildSuggestion(overrides: Partial<EatingOutSuggestion> = {}): EatingOutSuggestion {
  return {
    typicalMenuName: "牛丼並盛",
    typicalMenuKcal: 780,
    alternativeMenuName: "焼き魚定食",
    alternativeMenuKcal: 620,
    proteinDeltaG: 8,
    ...overrides,
  };
}

describe("EatingOutTipSection", () => {
  it("renders nothing when data is null (covers both the loading state and the 404-not-found error state)", () => {
    const { container } = render(<EatingOutTipSection data={null} isLoading={false} error={null} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when data.suggestion is null (200-success but no viable alternative found, Requirement 9.4)", () => {
    const data: EatingOutSuggestionResult = { suggestion: null };
    const { container } = render(<EatingOutTipSection data={data} isLoading={false} error={null} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders the tip card with both menu names, rounded kcal values, and a POSITIVE signed protein delta (Requirement 9.1-9.3)", () => {
    const data: EatingOutSuggestionResult = {
      suggestion: buildSuggestion({
        typicalMenuName: "牛丼並盛",
        typicalMenuKcal: 780,
        alternativeMenuName: "焼き魚定食",
        alternativeMenuKcal: 620,
        proteinDeltaG: 8,
      }),
    };

    const { container } = render(<EatingOutTipSection data={data} isLoading={false} error={null} />);

    expect(container.querySelector(".tip-card")).not.toBeNull();
    expect(container.querySelector(".tip-icon")?.textContent).toBe("💡");
    expect(screen.getByText("牛丼並盛", { exact: false })).toBeTruthy();
    expect(container.textContent).toContain("牛丼並盛（約780kcal）の代わりに、「焼き魚定食」（約620kcal・たんぱく質+8.0g）を選ぶと、本日の目標にかなり近づきます。");
  });

  it("renders a NEGATIVE proteinDeltaG with an explicit minus sign and 1 decimal place (schema's own documented real-world case)", () => {
    const data: EatingOutSuggestionResult = {
      suggestion: buildSuggestion({
        typicalMenuName: "親子丼",
        typicalMenuKcal: 710,
        alternativeMenuName: "かけうどん",
        alternativeMenuKcal: 430,
        proteinDeltaG: -18.5,
      }),
    };

    const { container } = render(<EatingOutTipSection data={data} isLoading={false} error={null} />);

    expect(container.textContent).toContain("親子丼（約710kcal）の代わりに、「かけうどん」（約430kcal・たんぱく質-18.5g）を選ぶと、本日の目標にかなり近づきます。");
  });

  it("rounds non-integer kcal values using the established Math.round + toLocaleString convention", () => {
    const data: EatingOutSuggestionResult = {
      suggestion: buildSuggestion({
        typicalMenuKcal: 779.6,
        alternativeMenuKcal: 619.4,
      }),
    };

    const { container } = render(<EatingOutTipSection data={data} isLoading={false} error={null} />);

    expect(container.textContent).toContain("約780kcal");
    expect(container.textContent).toContain("約619kcal");
  });

  it("still renders when isLoading is true and error is non-null, as long as data is a valid non-null success value (render decision depends only on data)", () => {
    const data: EatingOutSuggestionResult = { suggestion: buildSuggestion() };

    const { container } = render(
      <EatingOutTipSection data={data} isLoading={true} error={new Error("stale background refetch failure")} />,
    );

    expect(container.querySelector(".tip-card")).not.toBeNull();
    expect(container.textContent).toContain("牛丼並盛");
  });
});
