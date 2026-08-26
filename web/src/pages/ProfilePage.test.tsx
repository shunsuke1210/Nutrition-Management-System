import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProfilePage } from "./ProfilePage.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

describe("ProfilePage", () => {
  it("renders the profile page heading", () => {
    render(<ProfilePage />);

    expect(screen.getByRole("heading", { name: "プロフィール" }).textContent).toBe("プロフィール");
  });

  it("renders placeholder content indicating the form is not yet available", () => {
    render(<ProfilePage />);

    expect(screen.getByText(/準備中/)).toBeDefined();
  });
});
