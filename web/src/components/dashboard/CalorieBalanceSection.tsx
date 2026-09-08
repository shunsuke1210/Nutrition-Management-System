/**
 * 摂取・消費カロリー収支セクション（ダイエット状況画面、task 6.2）。
 *
 * mockup.html の `#panel-diet` 内 `<section class="block">`（「摂取・消費カロリー収支
 * （今週）」、行868-922）の `.section-caption` + `.block-actions`（2つのトリガーボタン）+
 * `.chart-card`（発散棒グラフ）+ `.advice-callout`のマークアップ構造に対応する
 * （design.md: File Structure Plan `components/dashboard/CalorieBalanceSection.tsx`）。
 * `.block-head`（`<h2>摂取・消費カロリー収支（今週）</h2>`）は`ShoppingListSection.tsx`/
 * `DietGoalStatusSection.tsx`と同じ既存の判断（見出しの描画は将来の`DashboardPage`、
 * task 7.1、へ委譲する）に倣い実装しない。
 *
 * 責務境界（design.md: Requirement 12 Traceability table。他の大半のセクションコンポーネント
 * ——`DashboardPage`が解決済みのデータをpropsで受け取るだけ——とは異なる、
 * `RecipeDetailModal.tsx`/`DietGoalStatusSection.tsx`の「今週の平均」と同種の明示的な例外）:
 * Requirement 12.7が「入力送信が成功した場合にグラフの該当曜日が更新されること」を要求して
 * おり、これはグラフを描画する本コンポーネント自身がデータを保持し再取得できて初めて満たせる。
 * そのため本コンポーネントは`dailyLogClient.getLogsInRange`を`useAsyncData`経由で直接呼び出し、
 * `useAsyncData`が返す`refetch`を2つの入力フォームの`onSaved`としてそのまま渡す（送信成功時に
 * 週データ全体を再取得し、その結果が`CalorieBalanceChart`/`AdviceCallout`へ流れ込む）。
 *
 * `calorieTarget`が単一の固定値である理由（design.mdのRequirement 12 Traceability table
 * （271行目）は`nutritionClient.getSummary`を一切参照しておらず、`DietGoalStatusSection.tsx`の
 * 「今週の平均」（Requirement 18.5、design.md:375が明示的に許可する例外）とは異なり、本要件に
 * 対する同様の「日ごとの目標エネルギー量を7回取得する」根拠が存在しない）: `calorieTarget`は
 * 呼び出し元（将来の`DashboardPage`、`DietGoalStatusSection`と共有する当日の
 * `nutritionSummary.dietMode.calorieTarget`）が解決済みの単一の値としてpropsで受け取り、
 * 7日分すべての差分算出の基準線として使い回す。本コンポーネント自身は`nutritionClient`を
 * 一切呼び出さない。
 *
 * `weekDates`の算出（このコードベースには日付演算の共有ユーティリティが存在しない、
 * `DietGoalStatusSection.tsx`の`addDaysIso`と同じ確立済みの前例）: 本ファイルも
 * 非exportのローカル関数として`addDaysIso`を複製する。
 *
 * 欠測日の扱い（Requirement 12.1、本タスクの解決済み設計判断）: `getLogsInRange`が返す配列は
 * 対象期間中に永続化済みのレコードが存在する日付のみを含む（レコードが無い日は単純に欠落し、
 * ゼロ値で埋め戻されない）。さらに、行自体は存在していても`calorieIntakeActual`自体が`null`
 * （`plannedKcal`未設定かつ手動修正も無い）ケースもある。この両方を「データなし」として同一に
 * 扱い、`varianceKcal: null`（`0`を捏造しない）として`CalorieBalanceChart`/`AdviceCallout`へ
 * 渡す。
 *
 * 曜日ラベルの3つの異なる書式（本タスクの解決済み設計判断。3つとも意図的な局所複製であり
 * 統一しない）: 本ファイルは(1) `CalorieBalanceChart`向けの単一文字形式
 * （`DayColumn.tsx`の`WEEKDAY_LABELS`と同じ）と、(2) `AdviceCallout`向けの「〜曜日」形式
 * （mockup.html 920行目の「土曜日」表記に合わせた、「日」まで含む完全形。`RecipeDetailModal.tsx`
 * の`WEEKDAY_FULL_LABELS`——「月曜」「火曜」…、「日」を含まない——や本specの
 * `DietGoalStatusSection.tsx`のeyebrowとも異なる、3つ目の独立した書式）の2つのローカル配列を
 * 持つ。
 *
 * 3分岐のフェッチ状態（`WeeklyMenuSection.tsx`/`ShoppingListSection.tsx`と同じ確立済みの
 * パターン。ただし本コンポーネントには「未生成」の第3状態が無い——`getLogsInRange`は
 * `menu-generation`の「週間献立プラン未生成」とは異なり`user-profile`の既存エンドポイント
 * パターンを再利用したものであり、成功時は必ず配列（空配列を含む）を返す。「未取得」を表す
 * `data === null`はロード中またはエラー時にのみ発生するため、`logs !== null`の分岐に到達すれば
 * 常に「取得成功」を意味する。念のため、その分岐に到達しなかった場合の防御的な`null`分岐も
 * 用意する（`DietGoalStatusSection.tsx`の`dietMode === null`防御分岐と同じ方針）。
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 19.2, 19.3, 19.4
 */
import type { DailyLogEntry, IsoDate } from "@nutrition/shared";
import { getLogsInRange } from "../../api/dailyLogClient.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { AdviceCallout, type DailyCalorieVariance } from "./AdviceCallout.js";
import { CalorieBalanceChart, type CalorieBalanceDatum } from "./charts/CalorieBalanceChart.js";
import { ExerciseEntryForm } from "./ExerciseEntryForm.js";
import { ManualCalorieOverrideForm } from "./ManualCalorieOverrideForm.js";

export interface CalorieBalanceSectionProps {
  /** 月曜始まりの対象週（このspec内の他コンポーネントと同じ規約）。 */
  weekStartDate: IsoDate;
  /** 「今日」の実際の日付。要件12.3/12.5はいずれも「当日」のログが対象であり、「今日」の
   * 解決は本コンポーネントの責務ではなく将来の`DashboardPage`（task 7.1）が担う
   * （`EatingOutTipSection`等、このspec内の他コンポーネントと同じ方針。本コンポーネント内で
   * `Date.now()`/`new Date()`を呼び出すことはない）。 */
  today: IsoDate;
  /** 当日の`nutritionSummary.dietMode.calorieTarget`。7日分すべての差分算出の基準線として
   * 使い回す単一の固定値（ファイル冒頭コメント参照）。 */
  calorieTarget: number;
}

const LOADING_MESSAGE = "カロリー収支を読み込み中です…";
const FETCH_ERROR_MESSAGE = "カロリー収支の取得に失敗しました。";
const SECTION_CAPTION =
  "摂取カロリーは献立通り食べた場合の計画値を自動反映し、実際と違う場合は手動修正できます。" +
  "消費カロリーはTDEE（基礎代謝×活動レベル）に、当日記録した追加運動の消費分を加算して算出します。";

// `CalorieBalanceChart`向けの単一文字の曜日ラベル。`DayColumn.tsx`の`WEEKDAY_LABELS`と
// 同じ値を意図的に複製している（ファイル冒頭コメント参照）。
const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

// `AdviceCallout`向けの「〜曜日」完全形。mockup.html(920行目)の「土曜日」表記に合わせた、
// このspec内で3つ目の独立した曜日ラベル書式（ファイル冒頭コメント参照）。
const WEEKDAY_FULL_LABELS = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"];

/**
 * `date`（`YYYY-MM-DD`）に`days`日を加算し、UTC真夜中基準で正しく月/年をまたぐ`YYYY-MM-DD`を
 * 返す。このコードベースには日付演算の共有ユーティリティが存在しない
 * （`server/src/menu-generation/menu-plan.service.ts`の非export・モジュールローカルな
 * `addDaysIso`等、各モジュールが独自の小さな日付演算ヘルパーを持つのが確立された前例。
 * `DietGoalStatusSection.tsx`の同名関数と同じ実装）。本ファイルもその前例に倣い、非exportの
 * ローカル関数として実装する。
 */
function addDaysIso(date: IsoDate, days: number): IsoDate {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return utcDate.toISOString().slice(0, 10) as IsoDate;
}

export function CalorieBalanceSection({ weekStartDate, today, calorieTarget }: CalorieBalanceSectionProps) {
  const { data: logs, isLoading, error, refetch } = useAsyncData<DailyLogEntry[]>(async () => {
    const result = await getLogsInRange(weekStartDate, addDaysIso(weekStartDate, 6));
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  }, [weekStartDate]);

  if (logs === null && isLoading) {
    return (
      <div className="calorie-balance-section">
        <p className="calorie-balance-loading">{LOADING_MESSAGE}</p>
      </div>
    );
  }

  if (logs === null && !isLoading && error !== null) {
    return (
      <div className="calorie-balance-section">
        <p className="calorie-balance-fetch-error">{FETCH_ERROR_MESSAGE}</p>
      </div>
    );
  }

  if (logs === null) {
    // 防御的分岐（ファイル冒頭コメント参照）: `getLogsInRange`は成功時に必ず配列（空配列を
    // 含む）を返すため、実際にはここに到達しない想定。クラッシュせず何も描画しない。
    return null;
  }

  const weekDates = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDaysIso(weekStartDate, offset));
  const logsByDate = new Map(logs.map((entry) => [entry.date, entry]));

  const chartData: CalorieBalanceDatum[] = weekDates.map((date, index) => {
    const actual = logsByDate.get(date)?.calorieIntakeActual ?? null;
    return {
      weekdayLabel: WEEKDAY_LABELS[index]!,
      varianceKcal: actual === null ? null : actual - calorieTarget,
    };
  });

  const dailyVariances: DailyCalorieVariance[] = weekDates.reduce<DailyCalorieVariance[]>(
    (acc, date, index) => {
      const actual = logsByDate.get(date)?.calorieIntakeActual ?? null;
      if (actual !== null) {
        acc.push({ dayLabel: WEEKDAY_FULL_LABELS[index]!, varianceKcal: actual - calorieTarget });
      }
      return acc;
    },
    [],
  );

  const todayOverrideKcal = logsByDate.get(today)?.manualOverrideKcal ?? null;

  return (
    <div className="calorie-balance-section">
      <p className="section-caption">{SECTION_CAPTION}</p>
      <div className="block-actions">
        <ManualCalorieOverrideForm date={today} currentOverrideKcal={todayOverrideKcal} onSaved={refetch} />
        <ExerciseEntryForm date={today} onSaved={refetch} />
      </div>
      <CalorieBalanceChart data={chartData} />
      <AdviceCallout variant="calorieBalance" dailyVariances={dailyVariances} />
    </div>
  );
}
