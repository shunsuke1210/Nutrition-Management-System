/**
 * 「1週間のおすすめ献立」セクション（栄養評価画面にのみ配置し、ダイエット状況画面には
 * 配置しない。Requirement 4.1, 4.2）。
 *
 * mockup.html の行670-755（`<section class="block">` > `.week-scroll-actions`（週全体差し替え
 * ボタン `.week-regen`）+ `.week-scroll`（7件の `.day-col`))のマークアップ構造のうち、
 * 本タスクのスコープである週全体/日単位の差し替え操作と曜日カード列そのものに対応する部分
 * のみを実装する（design.md: File Structure Plan `components/dashboard/WeeklyMenuSection.tsx`）。
 * `.restriction-chip` / `.section-caption`（食事制限表示・利用案内文）はこのセクションの
 * どの要件（4/5/17.4）にも対応しないため実装しない。曜日カードのクリックによるレシピ詳細
 * モーダル表示（task 4.2、`MealCell`/`RecipeDetailModal`）は下記「食事セルクリックと
 * レシピ詳細モーダル」の節を参照。
 *
 * 責務境界（design.md Components table / 「解決済みの設計判断」参照）:
 * `data`/`isLoading`/`error`は`useAsyncData`の`AsyncDataState<T>`と同じ規約で
 * `DashboardPage`（task 7.1、未実装）が制御する。本コンポーネントは`menuPlanClient`を
 * 直接importせず、`onRegenerateWeek`/`onRegenerateDay`という既に解決済みのコールバックを
 * 呼ぶだけで、成功時に表示中の内容を更新するのは「新しい`data`propを受け取って再描画される」
 * ことによってのみ実現される（本コンポーネント自身は取得結果をローカルにキャッシュ・マージ
 * しない）。本コンポーネントが自前で保持するのは、差し替え操作そのものの進行状況
 * （`regeneratingScope`）と直近の失敗メッセージ（`scopeError`）のみである。
 *
 * 単一のグローバルロック（Requirement 5.5）: 週単位の差し替えは7曜日すべてを同時に
 * 書き換えるため、週全体差し替えと特定曜日の差し替えを同時に走らせるとデータ競合の
 * リスクがある。そのため「週全体」「特定の曜日」を区別する`regeneratingScope`は
 * `"week" | number | null`のただ一つの値として保持し、いずれかの差し替えが進行中の間は
 * 週ボタン・7曜日すべてのボタン・（未生成時の）生成ボタンをすべて無効化する。
 *
 * 食事セルクリックとレシピ詳細モーダル（task 4.2, Requirement 6.1-6.4）: `selectedMeal`
 * （`{dayIndex, mealType} | null`）は「現在レシピ詳細モーダルを開いている食事セル」のみを
 * 保持する薄い選択状態であり、`RecipeDetailModal`に渡す`dishName`は`selectedMeal`自体には
 * キャッシュせず、都度`data`（現在のprops）から検索して求める。これは本コンポーネントが
 * 自身の表示するデータをローカルにキャッシュ・マージしない、という既存の設計判断
 * （ファイル冒頭コメント参照）と同じ理由に基づく。`RecipeDetailModal`が
 * `mealSlotClient.generateRecipeDetail`を直接呼び出す実装であるため、本コンポーネントは
 * モーダルの開閉状態の管理のみを行い、レシピ詳細の取得・生成中/失敗状態の管理は一切行わない。
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5,
 * 6.6, 17.4
 */
import { useState } from "react";
import type { DayMenu, MealType, WeekMenuPlan } from "@nutrition/shared";
import type { ApiError, Result } from "../../api/types.js";
import { DayColumn } from "./DayColumn.js";
import { RecipeDetailModal } from "./RecipeDetailModal.js";

export interface WeeklyMenuSectionProps {
  /** `menuPlanClient.getWeekPlan()` の結果。対象週の週間献立プランが未生成の場合は `null`。 */
  data: WeekMenuPlan | null;
  isLoading: boolean;
  error: unknown;
  /** 週全体の再生成（初回生成・Requirement 4.5と、後続の差し替え・Requirement 5.3の両方で使う）。 */
  onRegenerateWeek: () => Promise<Result<WeekMenuPlan, ApiError>>;
  /** 特定曜日の再生成（Requirement 5.4）。 */
  onRegenerateDay: (dayIndex: number) => Promise<Result<DayMenu, ApiError>>;
}

/** 差し替え処理の進行スコープ。7曜日を同時に書き換える週単位と衝突しないよう単一ロックとする。 */
type RegeneratingScope = "week" | number | null;

interface ScopeError {
  scope: "week" | number;
  message: string;
}

const LOADING_MESSAGE = "献立を読み込み中です…";
const FETCH_ERROR_MESSAGE = "献立の取得に失敗しました。";
const NOT_GENERATED_MESSAGE = "1週間のおすすめ献立はまだ生成されていません。";
const GENERATE_BUTTON_LABEL = "献立を生成";
const WEEK_REGEN_BUTTON_LABEL = "🔄 週全体を差し替え";
const PROCESSING_LABEL = "処理中…";
const WEEK_REGEN_FAILURE_MESSAGE = "週全体の差し替えに失敗しました。";
const DAY_REGEN_FAILURE_MESSAGE = "この曜日の差し替えに失敗しました。";

export function WeeklyMenuSection({
  data,
  isLoading,
  error,
  onRegenerateWeek,
  onRegenerateDay,
}: WeeklyMenuSectionProps) {
  const [regeneratingScope, setRegeneratingScope] = useState<RegeneratingScope>(null);
  const [scopeError, setScopeError] = useState<ScopeError | null>(null);
  // 現在レシピ詳細モーダルを開いている食事セル（Requirement 6.1）。dishName等はキャッシュせず、
  // 描画のたびに`data`（現在のprops）から都度検索して求める（ファイル冒頭コメント参照）。
  const [selectedMeal, setSelectedMeal] = useState<{ dayIndex: number; mealType: MealType } | null>(
    null,
  );

  // Requirement 5.5: 既に何らかの差し替えが進行中の場合、React の再描画を待たずにここで
  // 呼び出し自体を止める（ネイティブの`disabled`属性による抑止と二重にガードする）。
  function handleRegenerateWeek() {
    if (regeneratingScope !== null) {
      return;
    }
    setScopeError(null);
    setRegeneratingScope("week");
    onRegenerateWeek().then(
      (result) => {
        setRegeneratingScope(null);
        if (!result.ok) {
          setScopeError({ scope: "week", message: WEEK_REGEN_FAILURE_MESSAGE });
        }
      },
      () => {
        setRegeneratingScope(null);
        setScopeError({ scope: "week", message: WEEK_REGEN_FAILURE_MESSAGE });
      },
    );
  }

  function handleRegenerateDay(dayIndex: number) {
    if (regeneratingScope !== null) {
      return;
    }
    setScopeError(null);
    setRegeneratingScope(dayIndex);
    onRegenerateDay(dayIndex).then(
      (result) => {
        setRegeneratingScope(null);
        if (!result.ok) {
          setScopeError({ scope: dayIndex, message: DAY_REGEN_FAILURE_MESSAGE });
        }
      },
      () => {
        setRegeneratingScope(null);
        setScopeError({ scope: dayIndex, message: DAY_REGEN_FAILURE_MESSAGE });
      },
    );
  }

  // --- 初期取得の状態（Requirement 4.5の「未生成」判定と衝突しない、最小限の表示） ---

  if (data === null && isLoading) {
    return (
      <section className="weekly-menu-section">
        <p className="week-plan-loading">{LOADING_MESSAGE}</p>
      </section>
    );
  }

  if (data === null && !isLoading && error !== null) {
    return (
      <section className="weekly-menu-section">
        <p className="week-plan-fetch-error">{FETCH_ERROR_MESSAGE}</p>
      </section>
    );
  }

  if (data === null) {
    // isLoading===false && error===null: 対象週の週間献立プランがまだ生成されていない、
    // という正常な状態（Requirement 4.5。`menuPlanClient.getWeekPlan`は未生成時に
    // `Result.ok:true, value:null`を返すため、これはエラーではない）。
    const isGenerating = regeneratingScope !== null;
    return (
      <section className="weekly-menu-section">
        <p className="week-plan-not-generated">{NOT_GENERATED_MESSAGE}</p>
        <button
          type="button"
          className="btn-ghost week-generate"
          disabled={isGenerating}
          onClick={handleRegenerateWeek}
        >
          {isGenerating ? PROCESSING_LABEL : GENERATE_BUTTON_LABEL}
        </button>
        {scopeError !== null && scopeError.scope === "week" && (
          <p className="week-regen-error">{scopeError.message}</p>
        )}
      </section>
    );
  }

  // --- 週間献立プランが存在する状態（Requirement 4.3, 4.4, 5.1, 5.2, 17.4） ---
  // バックグラウンド再取得による`isLoading`/`error`の重複はこのタスクのスコープ外として扱い、
  // `data`が存在する限りは常にこの表示を優先する。

  const anyRegenerating = regeneratingScope !== null;
  const isWeekRegenerating = regeneratingScope === "week";

  return (
    <section className="block weekly-menu-section">
      <div className="week-scroll-actions">
        <button
          type="button"
          className="btn-ghost week-regen"
          disabled={anyRegenerating}
          onClick={handleRegenerateWeek}
        >
          {isWeekRegenerating ? PROCESSING_LABEL : WEEK_REGEN_BUTTON_LABEL}
        </button>
      </div>
      {scopeError !== null && scopeError.scope === "week" && (
        <p className="week-regen-error">{scopeError.message}</p>
      )}
      <div className="week-scroll">
        {data.days.map((day) => (
          <DayColumn
            key={day.dayIndex}
            day={day}
            isRegenerating={regeneratingScope === day.dayIndex}
            disabled={anyRegenerating && regeneratingScope !== day.dayIndex}
            errorMessage={scopeError !== null && scopeError.scope === day.dayIndex ? scopeError.message : null}
            onRegenerate={() => handleRegenerateDay(day.dayIndex)}
            onMealClick={(mealType) => setSelectedMeal({ dayIndex: day.dayIndex, mealType })}
          />
        ))}
      </div>
      {selectedMeal !== null &&
        (() => {
          // `selectedMeal`自体はdishNameをキャッシュせず、現在のdata propsから都度検索する
          // （ファイル冒頭コメント参照）。万一見つからない場合（データ更新のタイミング等）は
          // 防御的に何も描画しない。
          const selectedDishName = data.days
            .find((d) => d.dayIndex === selectedMeal.dayIndex)
            ?.meals.find((m) => m.mealType === selectedMeal.mealType)?.dishName;
          if (selectedDishName === undefined) {
            return null;
          }
          return (
            <RecipeDetailModal
              weekStartDate={data.weekStartDate}
              dayIndex={selectedMeal.dayIndex}
              mealType={selectedMeal.mealType}
              dishName={selectedDishName}
              onClose={() => setSelectedMeal(null)}
            />
          );
        })()}
    </section>
  );
}
