/**
 * 一言アドバイス表示（栄養評価・ダイエット状況の両方で使う共通コンポーネント）。
 *
 * mockup.html の `.advice-callout` / `.a-icon`（💡）/ `.a-body`（`<b>`で強調した1項目名を含む）の
 * マークアップ構造に対応する（design.md File Structure Plan
 * `components/dashboard/AdviceCallout.tsx`、Components table:
 * 「一言アドバイスの表示（栄養評価画面: 充足率最低の微量栄養素、ダイエット状況画面: 曜日別
 * カロリー収支の傾向）」）。
 *
 * 責務境界（Requirement 19.3, 19.4）:
 * 本コンポーネントは既に解決済みの `targets`/`actual`（栄養評価）または `dailyVariances`
 * （ダイエット状況）を props で受け取るだけの状態を持たない純粋なプレゼンテーション
 * コンポーネントである。行うのは「最小値/最大値の項目を1つ選び、定型文に当てはめる」ことのみ
 * （Requirement 19.3）であり、それ以外の判定・計算（例: 選ばれた値が言及に値するかどうかの
 * 追加判断）は一切行わない。対象データが存在しない場合（週間献立未生成、カロリー収支データ
 * なし等）は何も描画しない（Requirement 19.4）。データの取得・受け渡しは `DashboardPage`
 * （task 7.1）および各画面のセクションコンポーネント（task 6.2 等）が担う。
 *
 * mockup.html のイラスト用文言（行666, 920）は複数栄養素の同時言及や「きのこ・青魚・海藻や
 * 豆類を意識すると...」「今週は外食で+310kcal」といった、実データの裏付けがない原因推定・
 * 提案を含んでおり、Requirement 19.1（単数形「最も低い微量栄養素」）および19.3（min/max選択
 * 以外の判定・計算の禁止）と矛盾する。そのため本実装ではマークアップ構造・視覚的な規約
 * （`.advice-callout`/`.a-icon`💡/`.a-body`内`<b>`）のみをモックアップに合わせ、文言は単一
 * 項目・単一数値のみを含むシンプルな定型文に置き換えている。
 */
import type { JSX, ReactNode } from "react";
import type { MicronutrientTargets, VerifiedNutritionValues } from "@nutrition/shared";

export interface DailyCalorieVariance {
  /** 表示用に既に整形済みの曜日ラベル（例: "土曜日"）。書式化は呼び出し側の責務。 */
  dayLabel: string;
  /** 実績摂取カロリー - 目標エネルギー量。正の値が「目標超過」。 */
  varianceKcal: number;
}

export type AdviceCalloutProps =
  | { variant: "nutrition"; targets: MicronutrientTargets | null; actual: VerifiedNutritionValues | null }
  | { variant: "calorieBalance"; dailyVariances: DailyCalorieVariance[] | null };

// NutrientSufficiencyList.tsx (NORMAL_NUTRIENT_ROWS) と同じ8項目・同じ表示順を意図的に
// 値として複製している（このリポジトリのこのspec内で確立された、コンポーネントごとの
// ラベルマップ・簡単な数式の局所的複製という慣行に倣う）。食塩相当量
// (`saltEquivalentG`/`saltEquivalentUpperLimitG`) は「低いほど良い」上限指標であり、
// 「実績/上限」比が低いことは望ましい状態を意味するため、この8項目には含めない
// （「最も充足率が低い＝最も気にすべき」栄養素選定に混ぜると意味的に誤りとなる）。
type SharedNutrientKey =
  | "vitaminAUg"
  | "vitaminDUg"
  | "vitaminB1Mg"
  | "vitaminB2Mg"
  | "vitaminCMg"
  | "calciumMg"
  | "ironMg"
  | "fiberG";

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

function AdviceCalloutShell({ children }: { children: ReactNode }) {
  return (
    <div className="advice-callout">
      <div className="a-icon">💡</div>
      <div className="a-body">{children}</div>
    </div>
  );
}

function NutritionAdvice({
  targets,
  actual,
}: {
  targets: MicronutrientTargets;
  actual: VerifiedNutritionValues;
}) {
  // NORMAL_NUTRIENT_ROWS は8要素固定のリテラル配列であるため非空が保証されている。
  let lowest = NORMAL_NUTRIENT_ROWS[0]!;
  let lowestPercent = sufficiencyPercent(actual[lowest.key], targets[lowest.key]);

  for (const row of NORMAL_NUTRIENT_ROWS.slice(1)) {
    const percent = sufficiencyPercent(actual[row.key], targets[row.key]);
    if (percent < lowestPercent) {
      lowest = row;
      lowestPercent = percent;
    }
  }

  return (
    <AdviceCalloutShell>
      現在、<b>{lowest.label}</b>の充足率が最も低くなっています（{Math.round(lowestPercent)}%）。意識して摂ると良いでしょう。
    </AdviceCalloutShell>
  );
}

/** 符号付きの丸めkcal文字列（例: "+310kcal", "-90kcal"）を返す。 */
function formatSignedKcal(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded}kcal`;
}

function CalorieBalanceAdvice({ dailyVariances }: { dailyVariances: DailyCalorieVariance[] }) {
  // 呼び出し元(AdviceCallout)で length === 0 の場合はここに到達しないため非空が保証されている。
  let worst = dailyVariances[0]!;

  for (const entry of dailyVariances.slice(1)) {
    if (entry.varianceKcal > worst.varianceKcal) {
      worst = entry;
    }
  }

  return (
    <AdviceCalloutShell>
      <b>{worst.dayLabel}</b>の収支が今週で最も目標を超えています（{formatSignedKcal(worst.varianceKcal)}）。
    </AdviceCalloutShell>
  );
}

export function AdviceCallout(props: AdviceCalloutProps): JSX.Element | null {
  if (props.variant === "nutrition") {
    if (props.targets === null || props.actual === null) {
      return null;
    }
    return <NutritionAdvice targets={props.targets} actual={props.actual} />;
  }

  if (props.dailyVariances === null || props.dailyVariances.length === 0) {
    return null;
  }
  return <CalorieBalanceAdvice dailyVariances={props.dailyVariances} />;
}
