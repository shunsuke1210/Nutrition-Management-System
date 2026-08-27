/**
 * BmrCalculator（基礎代謝量算出モジュール）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `BmrCalculator` セクション
 * （Requirements 2.1-2.5）に定義された計算式をそのまま実装する純粋関数モジュール。
 *
 * - `bodyFatPct`（体脂肪率）が非nullの場合は Katch-McArdle式、null の場合は
 *   Mifflin-St Jeor式（性別オフセット適用）でBMRを算出する（2.1, 2.2）。
 * - Mifflin-St Jeor式の性別オフセットは `constants.ts` の `MIFFLIN_GENDER_OFFSET` を
 *   用いる。`undisclosed`（回答しない）は男女平均のオフセットであり、性別未回答でも
 *   算出可能にする（2.3）。
 * - 身長・体重・年齢の欠落チェック（Requirement 2.4）は本コンポーネントの責務ではない。
 *   design.md の `BmrCalculator` Responsibilities に明記される通り、その検証は
 *   `NutritionService` が `ProfileGateway` から取得した `ProfileSnapshot` の
 *   必須項目チェックとして行う（`user-profile` 側で必須項目として保証済みのため、
 *   本コンポーネントは型レベルで非null値のみを受け取る）。したがって本モジュールは
 *   `heightCm` / `weightKg` / `age` / `gender` に対する欠損防御チェックを行わない。
 */
import type { Gender } from "@nutrition/shared";
import { MIFFLIN_GENDER_OFFSET } from "./constants.js";

/**
 * BmrCalculator の入力（design.md BmrCalculator Service Interface: `BmrInput`）。
 *
 * `NutritionService` と `BmrCalculator` の間の内部契約であり、HTTP境界で検証される
 * 形状ではないため、Zod スキーマではなくプレーンな TypeScript 型として定義する
 * （`shared/src/nutrition.schema.ts` のコメント方針に準拠。列挙型 `Gender` のみ
 * `@nutrition/shared` の既存定義を再利用し、重複定義しない）。
 */
export interface BmrInput {
  /** 体重（kg）。 > 0 */
  weightKg: number;
  /** 身長（cm）。 > 0 */
  heightCm: number;
  /** 年齢。 > 0 */
  age: number;
  gender: Gender;
  /** 体脂肪率（%、0-100）。非nullならKatch-McArdle式を使用する。 */
  bodyFatPct: number | null;
}

/**
 * 算出結果が正の数値であることを内部でアサートする（design.md #BmrCalculator, Requirement 2.5）。
 *
 * 現実的な人体測定値（正の体重・身長・年齢、0-100%の体脂肪率）を入力とする限り、
 * Katch-McArdle式・Mifflin-St Jeor式のいずれも常に正の値を返すが、design.md は
 * 「算出結果が正の数値であることを内部でアサートする」ことを明示的に要求しているため、
 * 数式の結果を信頼するだけでなく実行時にも保証する。
 */
function assertPositiveBmr(bmr: number): number {
  if (!(bmr > 0)) {
    throw new Error(
      `BmrCalculator: 算出されたBMRが正の数値ではありません（bmr=${bmr}）。` +
        "Requirement 2.5（算出したBMRが正の数値であることを保証する）に違反する入力です。",
    );
  }
  return bmr;
}

/**
 * BMR（基礎代謝量、kcal/day）を算出する（design.md BmrCalculator Service Interface: `calculate`）。
 *
 * - `input.bodyFatPct !== null`（Katch-McArdle式, Requirement 2.1）:
 *   `leanBodyMassKg = weightKg × (1 − bodyFatPct / 100)`
 *   `bmr = 370 + 21.6 × leanBodyMassKg`
 * - `input.bodyFatPct === null`（Mifflin-St Jeor式, Requirement 2.2, 2.3）:
 *   `bmr = 10 × weightKg + 6.25 × heightCm − 5 × age + MIFFLIN_GENDER_OFFSET[gender]`
 */
export function calculateBmr(input: BmrInput): number {
  if (input.bodyFatPct !== null) {
    const leanBodyMassKg = input.weightKg * (1 - input.bodyFatPct / 100);
    return assertPositiveBmr(370 + 21.6 * leanBodyMassKg);
  }

  return assertPositiveBmr(
    10 * input.weightKg +
      6.25 * input.heightCm -
      5 * input.age +
      MIFFLIN_GENDER_OFFSET[input.gender],
  );
}
