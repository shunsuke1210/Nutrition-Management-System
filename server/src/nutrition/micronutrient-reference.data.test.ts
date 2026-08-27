import { describe, expect, it } from "vitest";
import {
  MICRONUTRIENT_AGE_BANDS,
  MICRONUTRIENT_REFERENCE_TABLE,
  type MicronutrientAgeBand,
} from "./micronutrient-reference.data.js";

/**
 * `micronutrient-reference.data.ts` の構造的な健全性を検証する。
 *
 * `micronutrient.calculator.test.ts` は個々の数値をこのファイルとは独立に転記して
 * 突き合わせるため（同語反復を避けるため）、ここでは数値そのものの再検証ではなく、
 * 「日本人の食事摂取基準（2020年版）」の実データが持つ既知の不変条件（性別・年齢区分の
 * 網羅性、全項目が非負であること、ビタミンC/ビタミンDが成人全体で一律であること、
 * 食塩相当量の上限が女性側で男性以下であること等）を検証することで、転記時の
 * 構造的な誤り（区分の欠落・符号の誤り・列の取り違え等）を検出する。
 */

const NUTRIENT_FIELDS = [
  "vitaminAUg",
  "vitaminDUg",
  "vitaminB1Mg",
  "vitaminB2Mg",
  "vitaminCMg",
  "calciumMg",
  "ironMg",
  "fiberG",
  "saltEquivalentUpperLimitG",
] as const;

describe("MICRONUTRIENT_AGE_BANDS", () => {
  it("18-29, 30-49, 50-64, 65-74, 75+ の5区分を若い順に持つ", () => {
    expect(MICRONUTRIENT_AGE_BANDS).toEqual(["18-29", "30-49", "50-64", "65-74", "75+"]);
  });
});

describe("MICRONUTRIENT_REFERENCE_TABLE - 網羅性", () => {
  it("male/female の両方のキーを持つ", () => {
    expect(Object.keys(MICRONUTRIENT_REFERENCE_TABLE).sort()).toEqual(["female", "male"]);
  });

  it.each(["male", "female"] as const)("%s は5つの年齢区分すべてのエントリを持つ", (sex) => {
    for (const band of MICRONUTRIENT_AGE_BANDS) {
      expect(MICRONUTRIENT_REFERENCE_TABLE[sex][band]).toBeDefined();
    }
  });

  it.each(["male", "female"] as const)("%s の各年齢区分は9項目すべてを持ち、いずれも有限な非負の数値である", (sex) => {
    for (const band of MICRONUTRIENT_AGE_BANDS) {
      const row = MICRONUTRIENT_REFERENCE_TABLE[sex][band];
      for (const field of NUTRIENT_FIELDS) {
        const value = row[field];
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });
});

describe("MICRONUTRIENT_REFERENCE_TABLE - 既知の不変条件（2020年版実データの特徴）", () => {
  it("ビタミンCの推奨量は成人の全年齢区分・両性別で100mgである", () => {
    for (const sex of ["male", "female"] as const) {
      for (const band of MICRONUTRIENT_AGE_BANDS) {
        expect(MICRONUTRIENT_REFERENCE_TABLE[sex][band].vitaminCMg).toBe(100);
      }
    }
  });

  it("ビタミンDの目安量は成人の全年齢区分・両性別で8.5µgである", () => {
    for (const sex of ["male", "female"] as const) {
      for (const band of MICRONUTRIENT_AGE_BANDS) {
        expect(MICRONUTRIENT_REFERENCE_TABLE[sex][band].vitaminDUg).toBe(8.5);
      }
    }
  });

  it("食塩相当量の目標上限は、いずれの年齢区分でも女性が男性以下である", () => {
    for (const band of MICRONUTRIENT_AGE_BANDS) {
      expect(MICRONUTRIENT_REFERENCE_TABLE.female[band].saltEquivalentUpperLimitG).toBeLessThanOrEqual(
        MICRONUTRIENT_REFERENCE_TABLE.male[band].saltEquivalentUpperLimitG,
      );
    }
  });

  it("食物繊維の目標量は、65-74以降で18-64区分より低くなる（高齢期のエネルギー必要量低下の反映）", () => {
    const youngBands: MicronutrientAgeBand[] = ["18-29", "30-49", "50-64"];
    const oldBands: MicronutrientAgeBand[] = ["65-74", "75+"];
    for (const sex of ["male", "female"] as const) {
      const youngMin = Math.min(...youngBands.map((band) => MICRONUTRIENT_REFERENCE_TABLE[sex][band].fiberG));
      const oldMax = Math.max(...oldBands.map((band) => MICRONUTRIENT_REFERENCE_TABLE[sex][band].fiberG));
      expect(oldMax).toBeLessThan(youngMin);
    }
  });
});
