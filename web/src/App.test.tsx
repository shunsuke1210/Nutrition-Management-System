import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("renders ProfilePage as the root view", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "プロフィール" }).textContent).toBe("プロフィール");
  });
});
