/**
 * MicronutrientCalculator（微量栄養素目標値ルックアップモジュール）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `MicronutrientCalculator`
 * セクション（Requirements 6.1, 6.2, 6.3, 6.4, 6.5）に定義されたルックアップ・調整ロジックを
 * 実装する純粋関数モジュール。
 *
 * - `calculateMicronutrientTargets`（design.md Service Interface: `calculateTargets`。
 *   `BmrCalculator.calculateBmr` / `PfcCalculator.calculatePfcRatio` 等、本ディレクトリの
 *   他モジュールの命名規則に合わせ、対象を明示する接頭辞付きの名称とする）:
 *   性別×年齢区分をキーに `micronutrient-reference.data.ts` の静的参照テーブルを
 *   ルックアップする（6.1, 6.2）。
 * - `gender === "undisclosed"` の場合は、該当年齢区分の男女基準値のうち9項目それぞれ
 *   独立に、より安全側（過小な目標設定を避ける方向）の値を採用する
 *   （`maxMicronutrientTargets`）。design.mdの文言「該当年齢区分の男女基準値のうち
 *   大きい方を採用する」は、行単位でどちらかの性別の行をまるごと選ぶ（whole-row）とも、
 *   項目ごとに独立して大きい方を選ぶ（per-nutrient）とも読めるが、research.md Design
 *   Decisionsの「回答しないの基準値は…過小な目標設定を避ける」という趣旨（Follow-up）を
 *   踏まえ、栄養素によって男女どちらが大きいかが異なりうる将来のデータ改定でも
 *   「回答しない」利用者がいずれの項目でも過小な目標にならないことを保証できる
 *   per-nutrient max を採用する。
 *   ただし `saltEquivalentUpperLimitG` は「上限目安」であり、値が大きいほど
 *   「より多く摂ってよい＝より緩い」方向になるため、他8項目と同じ理屈で単純に
 *   `Math.max` を適用すると「回答しない」利用者に最も緩い（＝安全側ではない）上限を
 *   与えてしまい、design.mdのルールの趣旨（過小な目標設定＝利用者にとって不利な方向を
 *   避ける）と矛盾する。そのため `saltEquivalentUpperLimitG` に限り `Math.min`
 *   （より厳しい、より保護的な上限）を採用する（design.md #MicronutrientCalculator
 *   Responsibilities & Constraints にこの例外を明記済み。2026-08-27 remediation round 1
 *   でユーザーが明示的に承認した設計変更）。詳細は `maxMicronutrientTargets` の
 *   コメントを参照。
 * - `smokingHabit === "smoker"` の場合はビタミンC目標へ `SMOKING_VITAMIN_C_ADDITION_MG` を、
 *   `alcoholHabit === "frequent"` の場合はビタミンB1目標へ `HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG`
 *   をそれぞれ加算する（6.3, 6.4）。それ以外の値（`"non_smoker"`/`null`、
 *   `"occasional"`/`"none"`/`null`）では加算しない（6.5）。
 */
import type { AlcoholHabit, Gender, MicronutrientTargets, SmokingHabit } from "@nutrition/shared";
import { HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG, SMOKING_VITAMIN_C_ADDITION_MG } from "./constants.js";
import {
  MICRONUTRIENT_REFERENCE_TABLE,
  type MicronutrientAgeBand,
} from "./micronutrient-reference.data.js";

/**
 * 年齢を5段階の年齢区分に分類する（design.md #MicronutrientCalculator, Requirement 6.2）。
 *
 * 区分は「18-29 / 30-49 / 50-64 / 65-74 / 75以上」であり、各区分は両端の年齢を含む
 * 半開区間として実装する（例: 30歳は「18-29」ではなく「30-49」に、49歳は「30-49」に、
 * 50歳は「50-64」に分類される）。
 *
 * 18歳未満の入力は本spec・参照テーブルの対象外（`user-profile`のBMR算出式等と同様、
 * 成人利用者を前提とする）だが、`age` は型レベルでは単なる `number` であるため、
 * 未成年の値が渡された場合は例外を投げず、参照テーブルが定義する最も若い区分
 * （「18-29」）に安全側で分類する（本タスクのCONCERNS参照）。
 */
function classifyAgeBand(age: number): MicronutrientAgeBand {
  if (age < 30) return "18-29";
  if (age < 50) return "30-49";
  if (age < 65) return "50-64";
  if (age < 75) return "65-74";
  return "75+";
}

/**
 * 2つの `MicronutrientTargets`（男性・女性の基準値）から、9項目それぞれ独立に
 * 「回答しない」利用者にとって安全側（過小な目標設定を避ける方向）の値を採用した
 * `MicronutrientTargets` を作る。
 *
 * - `saltEquivalentUpperLimitG` 以外の8項目（推奨量・目安量・目標量「以上」）は、
 *   値が大きいほど「より多く摂取するよう推奨する」方向であり、過小な目標設定を
 *   避けるという design.md のルールの趣旨に沿って `Math.max` を適用する。
 * - `saltEquivalentUpperLimitG` は「上限目安（目標量「未満」）」であり、他8項目とは
 *   意味の向きが逆転する: 値が大きいほど「より多く摂ってよい＝より緩い上限」になる。
 *   ここで単純に `Math.max` を適用すると、「回答しない」利用者に最も緩い（保護的でない）
 *   上限を与えてしまい、「過小な目標設定を避ける（＝利用者にとって不利な方向を避ける）」
 *   という design.md のルールの趣旨とは逆の結果になる。そのため
 *   `saltEquivalentUpperLimitG` に限り `Math.min`（より厳しい、より保護的な上限）を
 *   採用する（design.md #MicronutrientCalculator Responsibilities & Constraints に
 *   明記。2026-08-27 remediation round 1でユーザーが明示的に承認した設計変更）。
 */
export function maxMicronutrientTargets(
  a: MicronutrientTargets,
  b: MicronutrientTargets,
): MicronutrientTargets {
  return {
    vitaminAUg: Math.max(a.vitaminAUg, b.vitaminAUg),
    vitaminDUg: Math.max(a.vitaminDUg, b.vitaminDUg),
    vitaminB1Mg: Math.max(a.vitaminB1Mg, b.vitaminB1Mg),
    vitaminB2Mg: Math.max(a.vitaminB2Mg, b.vitaminB2Mg),
    vitaminCMg: Math.max(a.vitaminCMg, b.vitaminCMg),
    calciumMg: Math.max(a.calciumMg, b.calciumMg),
    ironMg: Math.max(a.ironMg, b.ironMg),
    fiberG: Math.max(a.fiberG, b.fiberG),
    // 上限項目のみ Math.min（より保護的な、より厳しい上限を採用する）。他8項目とは
    // 意味の向きが逆であるため、意図的に Math.max ではなく Math.min を用いている。
    saltEquivalentUpperLimitG: Math.min(a.saltEquivalentUpperLimitG, b.saltEquivalentUpperLimitG),
  };
}

/** 喫煙・飲酒による調整前の基準値を、性別×年齢区分からルックアップする。 */
function lookupBaseTargets(gender: Gender, ageBand: MicronutrientAgeBand): MicronutrientTargets {
  if (gender === "undisclosed") {
    return maxMicronutrientTargets(
      MICRONUTRIENT_REFERENCE_TABLE.male[ageBand],
      MICRONUTRIENT_REFERENCE_TABLE.female[ageBand],
    );
  }
  return MICRONUTRIENT_REFERENCE_TABLE[gender][ageBand];
}

/**
 * 微量栄養素の目標摂取量を算出する
 * （design.md MicronutrientCalculator Service Interface: `calculateTargets`）。
 *
 * 1. `gender` × `classifyAgeBand(age)` で基準値をルックアップする（6.1, 6.2）。
 *    `gender === "undisclosed"` の場合は `maxMicronutrientTargets` で男女基準値の
 *    項目ごとに、より安全側の値（`saltEquivalentUpperLimitG`のみ小さい方、他8項目は
 *    大きい方）を採用する。
 * 2. `smokingHabit === "smoker"` ならビタミンC目標へ `SMOKING_VITAMIN_C_ADDITION_MG` を
 *    加算する（6.3）。
 * 3. `alcoholHabit === "frequent"` ならビタミンB1目標へ
 *    `HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG` を加算する（6.4）。
 * 4. 上記以外の `smokingHabit` / `alcoholHabit` の値では加算を行わない（6.5）。
 */
export function calculateMicronutrientTargets(
  gender: Gender,
  age: number,
  smokingHabit: SmokingHabit | null,
  alcoholHabit: AlcoholHabit | null,
): MicronutrientTargets {
  const ageBand = classifyAgeBand(age);
  const base = lookupBaseTargets(gender, ageBand);

  return {
    ...base,
    vitaminCMg: base.vitaminCMg + (smokingHabit === "smoker" ? SMOKING_VITAMIN_C_ADDITION_MG : 0),
    vitaminB1Mg:
      base.vitaminB1Mg + (alcoholHabit === "frequent" ? HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG : 0),
  };
}
