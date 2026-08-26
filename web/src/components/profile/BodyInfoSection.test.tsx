import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BodyInfoSection, validateBodyInfo, type BodyInfoSectionValue } from "./BodyInfoSection.js";

// `globals: false` のため @testing-library/react の自動クリーンアップ検出が働かない。
// 各テスト後に明示的に unmount してDOMをリセットする。
afterEach(() => {
  cleanup();
});

const EMPTY_VALUE: BodyInfoSectionValue = {
  bodyFatPct: null,
  pregnancyStatus: "none",
  medicalNotes: null,
};

describe("BodyInfoSection", () => {
  it("renders the body fat percentage, pregnancy status, and medical notes fields", () => {
    render(<BodyInfoSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    expect(screen.getByLabelText("体脂肪率")).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "妊娠・授乳の状況" })).toBeDefined();
    expect(screen.getByLabelText("既往症・アレルギー・服薬情報")).toBeDefined();
  });

  it("exposes exactly the three pregnancy status options required by 2.5", () => {
    render(<BodyInfoSection value={EMPTY_VALUE} onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "妊娠・授乳の状況" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "該当なし" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "妊娠中" })).toBeDefined();
    expect(within(group).getByRole("radio", { name: "授乳中" })).toBeDefined();
  });

  it("calls onChange with the parsed number when body fat percentage changes", () => {
    const onChange = vi.fn();
    render(<BodyInfoSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("体脂肪率"), { target: { value: "27.5" } });

    expect(onChange).toHaveBeenCalledWith("bodyFatPct", 27.5);
  });

  it("calls onChange with the selected pregnancy status", () => {
    const onChange = vi.fn();
    render(<BodyInfoSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "妊娠中" }));

    expect(onChange).toHaveBeenCalledWith("pregnancyStatus", "pregnant");
  });

  it("calls onChange with free text when medical notes changes", () => {
    const onChange = vi.fn();
    render(<BodyInfoSection value={EMPTY_VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("既往症・アレルギー・服薬情報"), {
      target: { value: "小麦アレルギー" },
    });

    expect(onChange).toHaveBeenCalledWith("medicalNotes", "小麦アレルギー");
  });

  it("displays a field-level error message next to the body fat field when an errors prop is provided", () => {
    render(
      <BodyInfoSection
        value={EMPTY_VALUE}
        onChange={vi.fn()}
        errors={{ bodyFatPct: ["体脂肪率は0〜100の範囲で入力してください。"] }}
      />,
    );

    const input = screen.getByLabelText("体脂肪率");
    const errorParagraph = screen.getByText("体脂肪率は0〜100の範囲で入力してください。");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(errorParagraph.id);
  });
});

describe("validateBodyInfo", () => {
  it("allows all extended fields to be left empty (Requirements 2.1, 2.2)", () => {
    expect(validateBodyInfo(EMPTY_VALUE)).toEqual({});
  });

  it("rejects a body fat percentage outside 0-100 (Requirement 2.3)", () => {
    expect(validateBodyInfo({ ...EMPTY_VALUE, bodyFatPct: -1 }).bodyFatPct).toBeDefined();
    expect(validateBodyInfo({ ...EMPTY_VALUE, bodyFatPct: 101 }).bodyFatPct).toBeDefined();
  });

  it("accepts a body fat percentage within 0-100", () => {
    expect(validateBodyInfo({ ...EMPTY_VALUE, bodyFatPct: 27.5 })).toEqual({});
  });
});
