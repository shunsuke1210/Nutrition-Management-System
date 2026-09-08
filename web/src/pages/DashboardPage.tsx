/**
 * ダッシュボードページ（栄養評価画面 / ダイエット状況画面）。task 3-6で実装した各セクション
 * コンポーネントへ、上流spec（`user-profile` / `nutrition-engine` / `menu-generation`）の
 * 公開APIから取得したデータを配線する、本specのキーストーンとなる統合タスク（design.md:
 * Components table「DashboardPage」、Requirements Traceability 2, 16）。
 *
 * 2段構成（プロフィールゲート + コンテンツ本体）: Reactのフック呼び出し順序を毎レンダー
 * 不変に保つ必要があるため（Rules of Hooks）、`DashboardPage`自体は`profileClient.getProfile()`
 * のみを`useAsyncData`で呼び出し、`data`（`Profile | null`）が確定するまで他のフックを
 * 一切呼び出さない。`data !== null`が確定して初めて別コンポーネント`DashboardContent`を
 * マウントし、以降の全フェッチ・モード/期間状態・セクション配線はそちらに委譲する
 * （design.mdの「初回マウント時にprofileClient.getProfile()を呼び出し、nullであれば以降の
 * データ取得を行わない」という要件16.1の実現方法）。
 *
 * `today`は本ファイルが「現在日付」を解決する唯一の箇所である（本spec内の他の全コンポーネント
 * ——`CalorieBalanceSection.tsx`等——は意図的に`new Date()`/`Date.now()`を呼び出さず、
 * 「今日」の解決をこのページに委ねている）。テスト容易性のため、オプションの`today`propで
 * 上書き可能にする（本番では省略時に`new Date()`から算出する。`server/src/index.ts`の
 * `resolvePort(env)`等、このコードベースで確立された「注入可能な環境/時計値」という慣行に倣う）。
 *
 * Requirements: 2.1, 2.2, 2.3, 16.1, 16.3, 16.4, 16.5, 17.1, 17.2, 17.3
 */
import { useState, type JSX } from "react";
import type {
  DayMenu,
  DietInsights,
  EatingOutSuggestionResult,
  IsoDate,
  NutritionSummary,
  Profile,
  ShoppingList,
  WeekMenuPlan,
} from "@nutrition/shared";
import type { ApiError, Result } from "../api/types.js";
import { getProfile } from "../api/profileClient.js";
import { getDietInsights, getSummary } from "../api/nutritionClient.js";
import {
  getShoppingList,
  getWeekPlan,
  regenerateDay,
  regenerateWeek,
} from "../api/menuPlanClient.js";
import { getEatingOutSuggestion } from "../api/mealSlotClient.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ModeToggle, type DashboardMode } from "../components/dashboard/ModeToggle.js";
import { ProfileStrip } from "../components/dashboard/ProfileStrip.js";
import { RestrictionChip } from "../components/dashboard/RestrictionChip.js";
import { NutritionSummarySection } from "../components/dashboard/NutritionSummarySection.js";
import { AdviceCallout } from "../components/dashboard/AdviceCallout.js";
import { type Period } from "../components/dashboard/PeriodToggle.js";
import { WeeklyMenuSection } from "../components/dashboard/WeeklyMenuSection.js";
import { ShoppingListSection } from "../components/dashboard/ShoppingListSection.js";
import { EatingOutTipSection } from "../components/dashboard/EatingOutTipSection.js";
import { DietGoalStatusSection } from "../components/dashboard/DietGoalStatusSection.js";
import { CalorieBalanceSection } from "../components/dashboard/CalorieBalanceSection.js";
import { WeightTrendSection } from "../components/dashboard/WeightTrendSection.js";
import { PlateauAdviceCallout } from "../components/dashboard/PlateauAdviceCallout.js";
import { ExerciseSimulationSection } from "../components/dashboard/ExerciseSimulationSection.js";

export interface DashboardPageProps {
  /** テスト容易性のための注入可能な「今日」。省略時は本番同様 `new Date()` から算出する。 */
  today?: IsoDate;
}

const PROFILE_LOADING_MESSAGE = "読み込み中…";
const PROFILE_FETCH_ERROR_MESSAGE = "プロフィールの取得に失敗しました。";
const PROFILE_MISSING_MESSAGE =
  "プロフィールが登録されていません。プロフィール編集画面からプロフィールを登録してください。";

/**
 * `Result<T, ApiError>`を返すクライアント呼び出しを、`useAsyncData`が期待する
 * 「失敗時はreject」という規約に変換する共通アダプター（`RecipeDetailModal.tsx` /
 * `DietGoalStatusSection.tsx` / `CalorieBalanceSection.tsx`で確立された同一パターン）。
 */
async function unwrapResult<T>(promise: Promise<Result<T, ApiError>>): Promise<T> {
  const result = await promise;
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/**
 * `date`（`YYYY-MM-DD`）に`days`日を加算した`YYYY-MM-DD`をUTC真夜中基準で返す。このコードベースに
 * 日付演算の共有ユーティリティが存在しない確立された前例（`server/src/menu-generation/
 * menu-plan.service.ts`の`addDaysIso`、`DietGoalStatusSection.tsx`/`CalorieBalanceSection.tsx`の
 * 同名ローカル関数）に倣い、本ファイルも非exportのローカル関数として実装する。
 */
function addDaysIso(date: IsoDate, days: number): IsoDate {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10) as IsoDate;
}

/**
 * `date`が属する週の月曜日（ISO 8601週開始）を返す。この spec の月曜始まり規約
 * （menu-generationのdesign.mdで確定済み）に合わせる。
 */
function getWeekStartDate(date: IsoDate): IsoDate {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const jsDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const daysSinceMonday = (jsDayOfWeek + 6) % 7; // Mon->0, Tue->1, ..., Sun->6
  return addDaysIso(date, -daysSinceMonday);
}

/**
 * `from`から`to`までの日数差（`to - from`）。`getWeekStartDate`が既に算出済みの
 * `weekStartDate`から`todayDayIndex`（Monday=0..Sunday=6）を導出するために使う。
 * `getWeekStartDate`内部の曜日計算をここで独立に再実装すると2箇所の計算がずれるリスクが
 * あるため、`weekStartDate`（月曜日）と`today`の日数差という、`weekStartDate`の算出結果に
 * 対して数学的に導出される値として計算する（`weekStartDate`の定義上、この差は必ず0-6に
 * 収まる）。
 */
function daysBetweenIso(from: IsoDate, to: IsoDate): number {
  const fromParts = from.split("-").map(Number);
  const toParts = to.split("-").map(Number);
  const fromUtc = Date.UTC(fromParts[0] ?? 1970, (fromParts[1] ?? 1) - 1, fromParts[2] ?? 1);
  const toUtc = Date.UTC(toParts[0] ?? 1970, (toParts[1] ?? 1) - 1, toParts[2] ?? 1);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

export function DashboardPage({ today }: DashboardPageProps): JSX.Element {
  const profileState = useAsyncData<Profile | null>(() => unwrapResult(getProfile()), []);

  if (profileState.isLoading) {
    return <p className="dashboard-loading">{PROFILE_LOADING_MESSAGE}</p>;
  }
  if (profileState.error !== null) {
    return <p className="dashboard-fetch-error">{PROFILE_FETCH_ERROR_MESSAGE}</p>;
  }
  if (profileState.data === null) {
    // Requirement 16.1: プロフィール未登録の場合、結果を表示せず以降のデータ取得も行わない
    // （`DashboardContent`自体をマウントしないため、他の全クライアントは一切呼び出されない）。
    return <p className="dashboard-profile-missing">{PROFILE_MISSING_MESSAGE}</p>;
  }

  return <DashboardContent profile={profileState.data} today={today} />;
}

interface DashboardContentProps {
  profile: Profile;
  today?: IsoDate;
}

const DIET_MODE_DISABLED_MESSAGE =
  "ダイエットモードが無効です。プロフィール編集画面でダイエットモードを有効にしてください。";
const SECTION_LOADING_MESSAGE = "読み込み中です…";

function DashboardContent({ profile, today: todayProp }: DashboardContentProps): JSX.Element {
  const [mode, setMode] = useState<DashboardMode>("normal");
  const [period, setPeriod] = useState<Period>("today");

  // このページが「今日」を解決する唯一の箇所（ファイル冒頭コメント参照）。
  const today: IsoDate = todayProp ?? (new Date().toISOString().slice(0, 10) as IsoDate);
  const weekStartDate = getWeekStartDate(today);
  const todayDayIndex = daysBetweenIso(weekStartDate, today);

  const nutritionSummary = useAsyncData<NutritionSummary>(
    () => unwrapResult(getSummary(today)),
    [today],
  );
  const dietInsights = useAsyncData<DietInsights>(
    () => unwrapResult(getDietInsights(today)),
    [today],
  );
  const weekPlan = useAsyncData<WeekMenuPlan | null>(
    () => unwrapResult(getWeekPlan(weekStartDate)),
    [weekStartDate],
  );
  const shoppingList = useAsyncData<ShoppingList | null>(
    () => unwrapResult(getShoppingList(weekStartDate)),
    [weekStartDate],
  );
  const eatingOutSuggestion = useAsyncData<EatingOutSuggestionResult>(
    () => unwrapResult(getEatingOutSuggestion(weekStartDate, todayDayIndex, "lunch")),
    [weekStartDate, todayDayIndex],
  );

  // Requirement 5.3: 週全体の差し替え成功後、表示中の週間献立を更新後の内容に置き換える。
  // `WeeklyMenuSection`自身はdataをローカルにキャッシュ・マージしないため（design.md参照）、
  // 成功時に`weekPlan.refetch()`を呼んで新しいdataがpropsとして流れ込むようにする。
  // `ShoppingListSection`/`NutritionSummarySection`のdayNutritionも同じ`weekPlan`から
  // 導出されるため、この単一のrefetchで下流も一貫して更新される。
  async function handleRegenerateWeek(): Promise<Result<WeekMenuPlan, ApiError>> {
    const result = await regenerateWeek(weekStartDate);
    if (result.ok) {
      weekPlan.refetch();
    }
    return result;
  }

  // Requirement 5.4: 特定曜日の差し替え成功後も同様に、対象曜日のみでなく`weekPlan`全体を
  // refetchする（`WeeklyMenuSection`は現在のprops内から対象dayIndexの内容を再検索するのみで、
  // サーバー側から見て最新のWeekMenuPlan全体を都度取得し直す方が単純かつ確実なため）。
  async function handleRegenerateDay(dayIndex: number): Promise<Result<DayMenu, ApiError>> {
    const result = await regenerateDay(weekStartDate, dayIndex);
    if (result.ok) {
      weekPlan.refetch();
    }
    return result;
  }

  function renderProfileArea(): JSX.Element {
    const { data: summary, isLoading, error } = nutritionSummary;
    if (isLoading) {
      return <p className="profile-strip-loading">{SECTION_LOADING_MESSAGE}</p>;
    }
    if (error !== null || summary === null) {
      return <p className="profile-strip-error">プロフィール概要を表示できません。</p>;
    }
    return <ProfileStrip profile={profile} activityLevelLabel={summary.activityLevelLabel} />;
  }

  // Requirement 1, 18: `NutritionSummarySection`は`nutritionSummary`と`weekPlan`（当日の
  // `dayNutrition`を含む）の両方が揃って初めて描画できる。それぞれ独立に取得されるため、
  // 4分岐（読み込み中/算出不可/他方待ち/週間献立未生成）で段階的にガードする。
  function renderNutritionSummaryArea(): JSX.Element {
    const { data: summary, isLoading: summaryLoading, error: summaryError } = nutritionSummary;
    if (summaryLoading) {
      return <p className="nutrition-summary-loading">{SECTION_LOADING_MESSAGE}</p>;
    }
    if (summaryError !== null || summary === null) {
      return <p className="nutrition-summary-fetch-error">栄養目標値を算出できませんでした。</p>;
    }

    const { data: plan, isLoading: planLoading } = weekPlan;
    if (planLoading) {
      return <p className="nutrition-summary-loading">{SECTION_LOADING_MESSAGE}</p>;
    }
    if (plan === null) {
      return (
        <p className="nutrition-summary-week-plan-missing">
          週間献立が未生成のため本日の実績栄養価を表示できません。
        </p>
      );
    }

    const dayNutrition = plan.days[todayDayIndex]!.dayNutrition;
    return (
      <>
        <NutritionSummarySection
          nutritionSummary={summary}
          dayNutrition={dayNutrition}
          weekPlan={plan}
          period={period}
          onPeriodChange={setPeriod}
        />
        <AdviceCallout
          variant="nutrition"
          targets={summary.normalMode.micronutrients}
          actual={dayNutrition}
        />
      </>
    );
  }

  function renderDietGoalStatusArea(): JSX.Element {
    const { data: summary, isLoading: summaryLoading, error: summaryError } = nutritionSummary;
    const { data: insights, isLoading: insightsLoading, error: insightsError } = dietInsights;
    if (summaryLoading || insightsLoading) {
      return <p className="diet-goal-status-loading">{SECTION_LOADING_MESSAGE}</p>;
    }
    if (summaryError !== null || insightsError !== null || summary === null || insights === null) {
      return <p className="diet-goal-status-fetch-error">ダイエット目標の状況を表示できません。</p>;
    }
    return (
      <DietGoalStatusSection
        nutritionSummary={summary}
        dietInsights={insights}
        profile={profile}
        weekStartDate={weekStartDate}
        period={period}
        onPeriodChange={setPeriod}
      />
    );
  }

  function renderCalorieBalanceArea(): JSX.Element {
    const { data: summary, isLoading, error } = nutritionSummary;
    if (isLoading) {
      return <p className="calorie-balance-area-loading">{SECTION_LOADING_MESSAGE}</p>;
    }
    if (error !== null || summary === null || summary.dietMode === null) {
      return (
        <p className="calorie-balance-area-fetch-error">摂取・消費カロリー収支を表示できません。</p>
      );
    }
    return (
      <CalorieBalanceSection
        weekStartDate={weekStartDate}
        today={today}
        calorieTarget={summary.dietMode.calorieTarget}
      />
    );
  }

  function renderWeightTrendArea(): JSX.Element {
    const { data: insights, isLoading, error } = dietInsights;
    if (isLoading) {
      return <p className="weight-trend-area-loading">{SECTION_LOADING_MESSAGE}</p>;
    }
    if (error !== null || insights === null) {
      return <p className="weight-trend-area-fetch-error">体重推移を表示できません。</p>;
    }
    return <WeightTrendSection dietInsights={insights} profile={profile} />;
  }

  function renderPlateauArea(): JSX.Element {
    const { data: insights, isLoading, error } = dietInsights;
    if (isLoading) {
      return <p className="plateau-area-loading">{SECTION_LOADING_MESSAGE}</p>;
    }
    if (error !== null || insights === null) {
      return <p className="plateau-area-fetch-error">停滞期アドバイスを表示できません。</p>;
    }
    return <PlateauAdviceCallout plateau={insights.plateau} />;
  }

  function renderExerciseSimulationArea(): JSX.Element {
    const { data: insights, isLoading, error } = dietInsights;
    if (isLoading) {
      return <p className="exercise-simulation-area-loading">{SECTION_LOADING_MESSAGE}</p>;
    }
    if (error !== null || insights === null) {
      return (
        <p className="exercise-simulation-area-fetch-error">
          運動併用シミュレーションを表示できません。
        </p>
      );
    }
    return <ExerciseSimulationSection exerciseSimulation={insights.exerciseSimulation} />;
  }

  // Requirement 2.3: ダイエット状況画面は通常モード向けのセクションに加えてダイエット専用の
  // セクションを表示する（決して置き換えではない。本タスクの中核判断、ファイル冒頭コメント
  // および要件2.3の文言「〜に加えて表示する」参照）。ただし要件4.2（design.mdでも3箇所で
  // 反復される）により「1週間のおすすめ献立」セクション（および要件3.1によりその直前に
  // 配置される`RestrictionChip`）は、この加算原則の唯一の例外として栄養評価画面にのみ配置し
  // ダイエット状況画面には配置しない。この2つは本関数ではなく`mode === "normal"`ガードの
  // 側に配置している（下記メインの`return`内、`renderDietModeArea`の外）。
  // Requirement 16.3: `ModeToggle`が既に`dietModeEnabled===false`の場合ダイエットタブを
  // 無効化しユーザー操作からは到達不能にしているが、防御的にもこの画面自体でも同じ条件を
  // 再確認し、案内メッセージに置き換える。
  function renderDietModeArea(): JSX.Element | null {
    if (mode !== "diet") {
      return null;
    }
    if (!profile.dietModeEnabled) {
      return <p className="diet-mode-disabled-guidance">{DIET_MODE_DISABLED_MESSAGE}</p>;
    }

    return (
      <>
        <h2>ダイエット目標の状況</h2>
        {renderDietGoalStatusArea()}

        <h2>摂取・消費カロリー収支（今週）</h2>
        {renderCalorieBalanceArea()}

        <h2>体重推移と目標達成予測</h2>
        {renderWeightTrendArea()}

        <h2>停滞期アドバイス</h2>
        {renderPlateauArea()}

        <h2>運動を組み合わせた場合のシミュレーション</h2>
        {renderExerciseSimulationArea()}
      </>
    );
  }

  return (
    <div className="dashboard-content">
      <ModeToggle mode={mode} onModeChange={setMode} dietModeEnabled={profile.dietModeEnabled} />
      {renderProfileArea()}

      <h2>1日の推奨栄養量</h2>
      {renderNutritionSummaryArea()}

      {mode === "normal" && (
        <>
          {/*
            Requirement 4.2 / design.md（3箇所で反復）: 「1週間のおすすめ献立」セクションは
            栄養評価画面にのみ配置し、ダイエット状況画面には配置しない（要件2.3の「加えて表示」
            という加算原則の唯一の例外）。`RestrictionChip`は要件3.1によりこの献立セクションの
            直前に配置される、献立の前提条件を示すための付随コンポーネントであり、献立
            セクション自体が存在しないダイエット状況画面では単独で表示する意味を持たないため、
            同じ`mode === "normal"`ガードでまとめて出し分ける。
          */}
          <h2>1週間のおすすめ献立</h2>
          <RestrictionChip
            restrictionType={profile.restrictionType}
            restrictionIntensity={profile.restrictionIntensity}
            restrictionNotes={profile.restrictionNotes}
          />
          <WeeklyMenuSection
            data={weekPlan.data}
            isLoading={weekPlan.isLoading}
            error={weekPlan.error}
            onRegenerateWeek={handleRegenerateWeek}
            onRegenerateDay={handleRegenerateDay}
          />
        </>
      )}

      <h2>買い物リスト（今週分）</h2>
      <ShoppingListSection
        data={shoppingList.data}
        isLoading={shoppingList.isLoading}
        error={shoppingList.error}
      />

      <h2>外食時の代替提案</h2>
      <EatingOutTipSection
        data={eatingOutSuggestion.data}
        isLoading={eatingOutSuggestion.isLoading}
        error={eatingOutSuggestion.error}
      />

      {renderDietModeArea()}
    </div>
  );
}
