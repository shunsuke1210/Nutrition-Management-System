/**
 * 微量栄養素充足率バー一覧。
 *
 * mockup.html の `.nutrient-row` の並び（design.md: File Structure Plan
 * `components/dashboard/charts/NutrientSufficiencyList.tsx`、Components table:
 * 「微量栄養素充足率バー一覧（menu-generationの実績値÷nutrition-engineの目標値を算出して
 * 表示。実績値そのものの計算は行わない）」）のマークアップ構造に対応する。
 *
 * 責務境界（design.md Data Contracts & Integration amendment / Requirements
 * Traceability 1.3, 1.4, 1.5）:
 * `menuPlanClient.getWeekPlan()` が返す当日の `DayMenu.dayNutrition`（実績値）と
 * `nutritionClient.getSummary()` が返す `NutritionSummary.normalMode.micronutrients`
 * （目標値）の取得・受け渡しは `DashboardPage`（task 7.1）と `NutritionSummarySection`
 * （本タスク、task 3.4）が担う。本コンポーネントは既に解決済みの `targets` / `actual` を
 * props で受け取り、充足率（実績÷目標）を算出して表示するだけの状態を持たない純粋な
 * プレゼンテーションコンポーネントである。算出するのは充足率の比のみであり、実績値・
 * 目標値そのものの計算（栄養価算出式の再実装）は一切行わない（Requirement 1.5）。
 *
 * フィールド名対応（design.md Data Contracts & Integration amendment を参照）:
 * `fiberG` / `calciumMg` / `ironMg` / `vitaminAUg` / `vitaminDUg` / `vitaminB1Mg` /
 * `vitaminB2Mg` / `vitaminCMg` の8項目は `VerifiedNutritionValues`（実績）と
 * `MicronutrientTargets`（目標）で同名のため単純に対応する。食塩相当量のみ非対称
 * （実績は `saltEquivalentG`、目標は上限目安を表す `saltEquivalentUpperLimitG`）かつ
 * 「低いほど良い」上限指標であるため、他の8項目とは異なる表示（`{実績}/{上限}g` という
 * 非パーセント表記、`.ceiling` クラス）を行う。
 *
 * Requirements: 1.3（微量栄養素の目標量と充足率を項目名とともに表示する）,
 * 1.4（充足率が100%を超える場合、数値表示は実際の値をそのまま示す。バーの塗りつぶし幅は
 * トラックを物理的に超えられないため100に制限する）,
 * 1.5（充足率の算出（実績値と目標値の比を取るのみ）以外の栄養計算を行わない）
 *
 * `captionOverride`（task 3.5, Requirement 18.2）: 「今週の計画平均」表示時、
 * `NutritionSummarySection`がmockup.html行660の週表示向け文言を渡すための追加・任意のprop。
 * 省略時（「今日」表示時）は既定のキャプション文言をそのまま表示し、task 3.4時点の挙動を
 * 変えない。充足率の算出ロジック自体には影響しない表示文言のみの差し替えである。
 */
import type { MicronutrientTargets, VerifiedNutritionValues } from "@nutrition/shared";

export interface NutrientSufficiencyListProps {
  targets: MicronutrientTargets;
  actual: VerifiedNutritionValues;
  /** 省略時は「今日」向けの既定キャプションを表示する。 */
  captionOverride?: string;
}

type SharedNutrientKey =
  | "fiberG"
  | "calciumMg"
  | "ironMg"
  | "vitaminAUg"
  | "vitaminDUg"
  | "vitaminB1Mg"
  | "vitaminB2Mg"
  | "vitaminCMg";

// mockup.html (行621-626) の表示順そのまま。
const NORMAL_NUTRIENT_ROWS: { key: SharedNutrientKey; label: string }[] = [
  { key: "vitaminAUg", label: "ビタミンA" },
  { key: "vitaminDUg", label: "ビタミンD" },
  { key: "vitaminB1Mg", label: "ビタミンB1" },
  { key: "vitaminB2Mg", label: "ビタミンB2" },
  { key: "vitaminCMg", label: "ビタミンC" },
  { key: "calciumMg", label: "カルシウム" },
  { key: "ironMg", label: "鉄" },
  { key: "fiberG", label: "食物繊維" },
];

/** 実績÷目標の充足率(%)。目標が0の場合はゼロ除算を避け0とする。 */
function sufficiencyPercent(actualValue: number, targetValue: number): number {
  return targetValue === 0 ? 0 : (actualValue / targetValue) * 100;
}

/**
 * 食塩相当量表示用のグラム数を小数第1位に固定して書式化する（表示専用の単純な書式変換）。
 * `menu-generation`の`saltEquivalentG`は複数食材のper100g×グラム量/100の合計であり、
 * 算出パイプライン中に丸めが一切行われない（`nutrition-verification.service.ts`）ため、
 * 実データでは`6.823476...`のような長い小数になり得る。他の数値表示（kcal・充足率%）と
 * 同様に、ここでも表示直前の書式変換としてのみ丸めを行い、充足率算出そのものには影響しない。
 */
function formatGrams1(value: number): string {
  return value.toFixed(1);
}

const DEFAULT_CAPTION =
  "食塩相当量のみ上限目安（1日7.5g未満）に対する割合を示しています。他の項目は目標量に対する充足率です。";

export function NutrientSufficiencyList({ targets, actual, captionOverride }: NutrientSufficiencyListProps) {
  const saltRawPct = sufficiencyPercent(actual.saltEquivalentG, targets.saltEquivalentUpperLimitG);
  const saltFillPct = Math.min(saltRawPct, 100);

  return (
    <div className="nutrient-sufficiency-list">
      {NORMAL_NUTRIENT_ROWS.map(({ key, label }) => {
        const rawPct = sufficiencyPercent(actual[key], targets[key]);
        const fillPct = Math.min(rawPct, 100);
        const displayPct = Math.round(rawPct);

        return (
          <div className="nutrient-row" key={key}>
            <span className="label">{label}</span>
            <div className="track">
              <div className="fill" style={{ width: `${fillPct}%` }} />
            </div>
            <span className="pct">{displayPct}%</span>
          </div>
        );
      })}
      <div className="nutrient-row ceiling">
        <span className="label">食塩相当量</span>
        <div className="track">
          <div className="fill" style={{ width: `${saltFillPct}%` }} />
        </div>
        <span className="pct">
          {formatGrams1(actual.saltEquivalentG)}/{formatGrams1(targets.saltEquivalentUpperLimitG)}g
        </span>
      </div>
      <p className="section-caption">{captionOverride ?? DEFAULT_CAPTION}</p>
    </div>
  );
}
