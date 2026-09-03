/**
 * MenuPlanService — 週間献立生成・週単位再生成のオーケストレーション、依存データの欠損判定、
 * 計画摂取カロリーの送信（task 9.1）。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #MenuPlanService、
 * Requirements 1, 6, 7, 11.1, 11.2, 11.4, 12）に定義されたオーケストレーションを実装する。
 * `regenerateDay`（design.md Service Interface、Requirements 7, 11.1, 11.2, 12。日単位再生成、
 * 他6日考慮）は task 9.2 でこのファイル・`MenuPlanService` インターフェースの双方に追加された
 * （`_Depends: 9.1_`）。`generateWeek`/`regenerateWeek`（task 9.1）と同じ
 * `withGenerationLock` / `hasCompleteDayIndexSet` 相当の防御方針を踏襲しつつ、日単位固有の
 * ロックキー・`findOtherDays` によるコンテキスト取得・`hasCompleteMealTypeSet`（後述）を追加する。
 *
 * ## generateWeek / regenerateWeek が同一のオーケストレーションを共有することについて
 * design.md「週間献立生成・週単位再生成フロー」の直後のコメントが明示するとおり
 * （「週間生成（初回）と週単位再生成は同一フローを辿る。相違点は、再生成時のみ
 * Feedback Serviceから取得した苦手サマリが必ずプロンプトに含まれる点」）、両メソッドは
 * ステップレベルで完全に同一の処理を辿る。初回生成時に苦手サマリが空配列になるのは
 * `FeedbackService.getDislikedSummary()` 自身の結果（フィードバック蓄積が無い）であって、
 * `MenuPlanService` 側の分岐によるものではない。`generation_source`（'initial' /
 * 'week_regenerate'）の決定も `MenuPlanRepository.replaceWeek` 自身が書き込み前の存在確認で
 * 行う（`menu-plan.repository.ts` 冒頭コメント「設計判断1」参照）。したがって本ファイルは
 * 両メソッドの分岐を一切持たず、`runWeeklyGeneration`（内部共有関数）に委譲する2つの薄い
 * exportとしてのみ実装する。
 *
 * ## GenerationError / GenerationFailureReason の定義場所について
 * design.md #MenuPlanService Service Interfaceが定義するこの2つの型は、`@nutrition/shared`
 * にも他のどのtaskの成果物にも存在しない（`shared/src/menu.schema.ts` はこれらをexportしない）。
 * `DislikedItemSummary`（`menu-prompt.builder.ts`）/ `OtherDayContext`
 * （`menu-plan.repository.ts`）等で確立された「型はそれを最初に消費/定義するコンポーネントに
 * 置く」という規約に倣い、本ファイルで定義・exportする。
 *
 * ## MenuPromptBuilder を依存として注入しないことについて
 * design.mdの依存関係表は `MenuPlanService` の依存として `MenuPromptBuilder` を挙げるが、
 * `menu-prompt.builder.ts` 自身のファイル冒頭コメントが明示するとおり、
 * `buildWeeklyPrompt`/`buildDailyPrompt`/`buildRecipeDetailPrompt` は「外部依存を持たない純粋
 * 関数として3つのトップレベル関数」であり、`createXxx(deps)` ファクトリ規約に従わない
 * （`claude-menu.client.ts` のtool定義構築関数群と同じ「ファクトリでラップしない」規約）。
 * したがって `createMenuPlanService` のDI対象（`MenuPlanServiceDependencies`）には
 * `MenuPromptBuilder` を含めず、`buildWeeklyPrompt` を直接importして呼び出す。テストにおいても
 * 差し替え可能なフェイクを用意する対象ではなく、実関数をそのまま利用する
 * （`nutrition-verification.service.ts` が確立した「決定論的な純粋関数はテスト内でも実関数を
 * 使い、フェイク化しない」方針に倣う）。
 *
 * ## dayIndexの網羅性・一意性ガード（task 9.1で新規に追加した防御）
 * `claude-menu.client.ts`（task 6.2）の `WeeklyToolInputSchema` は `days.length === 7` と
 * 各 `dayIndex` が `0 <= dayIndex <= 6` であることをZodで再検証するが、7件が
 * 「0〜6を重複なく網羅している」ことまでは検証しない（例: dayIndexが2件とも0で、5が
 * 欠落しているレスポンスも、要素数7・各要素0-6という制約だけなら通過しうる）。
 * Requirement 1.1（7日×4食種=28食枠すべて）と design.mdの
 * Invariant（`WeeklyGenerationToolResult.days` は常に7件。要求どおりでない場合は
 * `schema_validation_failed` として扱う）を額面通り満たすには、この「網羅性」もオーケストレー
 * ション層が検証しなければならない。本ファイルの `hasCompleteDayIndexSet` がこれを行い、
 * 違反時は `schema_validation_failed`（Claude側のスキーマ不整合と同じ理由）として扱う
 * （TASK_BRIEFの指示どおり）。
 *
 * ## mealTypeの網羅性・一意性ガード（task 9.2で新規に追加する防御）
 * `claude-menu.client.ts` の `MealWireSchema.mealType` は4値のいずれかであることを、
 * `DailyToolInputSchema.meals` / `WeeklyToolInputSchema.days[].meals` は要素数が常に4件で
 * あることをZodで再検証するが、`hasCompleteDayIndexSet` と全く同じ抜け道が食事枠レベルにも
 * 存在する（例: `mealType` が2件とも `"breakfast"` で `"dinner"` が欠落したレスポンスも、
 * 要素数4・各要素が4値のいずれかという制約だけなら通過しうる）。この欠陥を放置すると、
 * `MenuPlanRepository.replaceWeek`/`replaceDay`（`meal_slots.day_menu_id, meal_slots.meal_type`
 * のUNIQUE制約を持つ）に到達して未捕捉の `SqliteError` を投げてしまい、
 * `GenerationError` としてのクリーンな失敗にならない。本ファイルの `hasCompleteMealTypeSet`
 * （`hasCompleteDayIndexSet` と同じ「Setに集めて重複を検出しつつ、期待する値集合をすべて
 * 網羅しているか確認する」方式）がこれを行い、違反時は同じく `schema_validation_failed` として
 * 扱う。`regenerateDay`（新規）の4食枠と、`runWeeklyGeneration`（task 9.1で実装済み、
 * `generateWeek`/`regenerateWeek` が共有する内部関数）の7日×4食枠の両方に適用する
 * （後者は `hasCompleteDayIndexSet` と同じ箇所でのretrofit）。
 *
 * ## インメモリロックについて（Requirement 12.5）
 * `createKeyedLock` は特定のキー形式に紐付かない汎用のキー単位ロックであり、
 * `generateWeek`/`regenerateWeek` は共に `weekStartDate` そのものをロックキーとして共有する
 * （両者は同一の永続化対象を変更するため、同じキーでなければ「同一対象への重複要求」を
 * 検知できない）。
 *
 * `regenerateDay`（task 9.2）は対象日単位でロックする必要があるため、
 * `` `${weekStartDate}:day:${dayIndex}` `` という、週全体のロックキー（`weekStartDate` 単体）
 * とは異なる形式のキーを用いる。`createKeyedLock` / `withGenerationLock` はキーの形式を
 * 一切仮定しない（任意の文字列を受け取る）ため、`regenerateDay` はこの同じヘルパーをそのまま
 * 再利用し、新たなロック機構を実装しない。この結果、同一週への `generateWeek`/`regenerateWeek`
 * と `regenerateDay` は異なるロックキー（`weekStartDate` vs
 * `` `${weekStartDate}:day:${dayIndex}` ``）を持つため互いにブロックしない。design.mdは
 * 「同一対象への重複要求」の防止（Requirement 12.5）のみを求め、週単位操作と日単位操作が
 * 互いをブロックすることまでは要求していないため、これは意図的かつ正しい挙動である
 * （TASK_BRIEFの指示どおり。テストでこの独立性を明示的に確認する）。
 */
import type {
  DayMenu,
  IsoDate,
  MealSlot,
  MealType,
  VerifiedNutritionValues,
  WeekMenuPlan,
} from "@nutrition/shared";
import { MealTypeSchema } from "@nutrition/shared";
import type { NotFoundError, Result } from "../shared/result.js";
import type {
  ClaudeGenerationErrorType,
  ClaudeMenuClient,
  DailyGenerationToolResult,
  WeeklyGenerationToolResult,
} from "./claude-menu.client.js";
import type { FeedbackService } from "./feedback.service.js";
import { buildDailyPrompt, buildWeeklyPrompt } from "./menu-prompt.builder.js";
import type { MenuPlanRepository } from "./menu-plan.repository.js";
import type { NutritionVerificationService } from "./nutrition-verification.service.js";
import type { NutritionGateway, NutritionTargetSnapshot } from "./nutrition.gateway.js";
import type { PlannedCalorieGateway } from "./planned-calorie.gateway.js";
import type { ProfileGateway } from "./profile.gateway.js";

// --- design.md #MenuPlanService Service Interface（GenerationError / GenerationFailureReason） ---

/** design.md #MenuPlanService Service Interface。 */
export type GenerationFailureReason =
  | "profile_missing"
  | "nutrition_unavailable"
  | "schema_validation_failed"
  | "food_id_not_found"
  | "unit_not_found"
  | "claude_refusal"
  | "claude_request_failed"
  | "generation_in_progress";

/** design.md #MenuPlanService Service Interface。 */
export interface GenerationError {
  type: "generation_failed";
  reason: GenerationFailureReason;
  message: string;
}

/** design.md #MenuPlanService Service Interface。 */
export interface MenuPlanService {
  generateWeek(weekStartDate: IsoDate): Promise<Result<WeekMenuPlan, GenerationError>>;
  regenerateWeek(weekStartDate: IsoDate): Promise<Result<WeekMenuPlan, GenerationError>>;
  regenerateDay(
    weekStartDate: IsoDate,
    dayIndex: number
  ): Promise<Result<DayMenu, GenerationError | NotFoundError>>;
  getActivePlan(weekStartDate: IsoDate): WeekMenuPlan | null;
}

/**
 * `createMenuPlanService` が受け取る依存の集合。
 * `MenuPromptBuilder`（`buildWeeklyPrompt`/`buildDailyPrompt`）は含めない（ファイル冒頭コメント参照）。
 */
export interface MenuPlanServiceDependencies {
  profileGateway: ProfileGateway;
  nutritionGateway: NutritionGateway;
  plannedCalorieGateway: PlannedCalorieGateway;
  feedbackService: FeedbackService;
  claudeMenuClient: ClaudeMenuClient;
  nutritionVerificationService: NutritionVerificationService;
  menuPlanRepository: MenuPlanRepository;
}

// --- 週の日数（design.md Invariants: `WeeklyGenerationToolResult.days` は常に7件） ---

const DAYS_PER_WEEK = 7;

// --- 日付演算（週開始日 + dayIndex → 各日の日付） ---

/**
 * `date`（`YYYY-MM-DD`）に `days` 日を加算し、UTC真夜中基準で正しく月/年をまたぐ
 * `YYYY-MM-DD` を返す。
 *
 * このコードベースには日付演算の共有ユーティリティが存在しない
 * （`nutrition/diet-insights.calculator.ts` の非export・モジュールローカルな `addDaysIso`、
 * `menu-plan.repository.test.ts` が独自に再実装するテスト用 `addDays` 等、各モジュールが
 * 独自の小さな日付演算ヘルパーを持つのが確立された前例）。本ファイルもその前例に倣い、
 * 非exportのローカル関数として実装する。
 *
 * `noUncheckedIndexedAccess` の下で `date.split("-").map(Number)` の各要素は
 * `number | undefined` になるため、`menu-plan.repository.test.ts` の同名ヘルパーと同じ
 * フォールバック（`?? 1`）を用いる。`weekStartDate` はController層のZod検証を通過済みの
 * `YYYY-MM-DD` 形式であることが本サービスのPrecondition（design.md）であるため、この
 * フォールバックが実際に使われることは想定していない（型検査を通すためだけの防御）。
 */
function addDaysIso(date: IsoDate, days: number): IsoDate {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return utcDate.toISOString().slice(0, 10);
}

// --- dayIndexの網羅性・一意性ガード（ファイル冒頭コメント参照） ---

/**
 * `days` の `dayIndex` が `{0, 1, ..., DAYS_PER_WEEK - 1}` を重複・欠落なく網羅しているかを
 * 判定する。`claude-menu.client.ts` のZod再検証（要素数7・各要素0-6）だけでは検出できない
 * 「重複によって特定の値が欠落する」ケースを捉えるための、本タスクが新規に追加する防御
 * （ファイル冒頭コメント参照）。
 */
function hasCompleteDayIndexSet(days: readonly { dayIndex: number }[]): boolean {
  const seen = new Set<number>();
  for (const day of days) {
    if (seen.has(day.dayIndex)) {
      return false;
    }
    seen.add(day.dayIndex);
  }
  for (let dayIndex = 0; dayIndex < DAYS_PER_WEEK; dayIndex++) {
    if (!seen.has(dayIndex)) {
      return false;
    }
  }
  return true;
}

// --- mealTypeの網羅性・一意性ガード（ファイル冒頭コメント参照） ---

/** `MealType` の4値（`@nutrition/shared` の `MealTypeSchema` から実行時に取得、書き写さない）。 */
const MEAL_TYPE_VALUES = MealTypeSchema.options;

/**
 * `meals` の `mealType` が `MealType` の4値（朝食・昼食・夕食・間食）を重複・欠落なく
 * 網羅しているかを判定する。`hasCompleteDayIndexSet` と同じ「Setに集めて重複を検出しつつ、
 * 期待する値集合をすべて網羅しているか確認する」方式であり、`claude-menu.client.ts` の
 * Zod再検証（要素数4・各要素が4値のいずれか）だけでは検出できない「重複によって特定の値が
 * 欠落する」ケースを捉えるための、本タスクが新規に追加する防御（ファイル冒頭コメント参照）。
 */
function hasCompleteMealTypeSet(meals: readonly { mealType: MealType }[]): boolean {
  const seen = new Set<MealType>();
  for (const meal of meals) {
    if (seen.has(meal.mealType)) {
      return false;
    }
    seen.add(meal.mealType);
  }
  for (const mealType of MEAL_TYPE_VALUES) {
    if (!seen.has(mealType)) {
      return false;
    }
  }
  return true;
}

// --- GenerationError構築ヘルパー ---

function generationError(reason: GenerationFailureReason, message: string): GenerationError {
  return { type: "generation_failed", reason, message };
}

function generationErrResult<T>(
  reason: GenerationFailureReason,
  message: string
): Result<T, GenerationError> {
  return { ok: false, error: generationError(reason, message) };
}

/** `ClaudeGenerationError.type` → `GenerationFailureReason` のマッピング（TASK_BRIEFの対応表）。 */
function mapClaudeErrorReason(type: ClaudeGenerationErrorType): GenerationFailureReason {
  switch (type) {
    case "refusal":
      return "claude_refusal";
    case "request_failed":
      return "claude_request_failed";
    case "schema_validation_failed":
      return "schema_validation_failed";
  }
}

// --- インメモリのキー単位ロック（Requirement 12.5） ---

/**
 * 汎用のキー単位ロック。特定のキー形式（週単位・日単位のいずれ）にも紐付かない
 * （ファイル冒頭コメント「インメモリロックについて」参照。task 9.2 が日単位のキー形式で
 * 再利用する前提の設計）。
 */
interface KeyedLock {
  /** `key` のロックを試みる。既にロック済みなら `false`、取得できれば `true` を返す。 */
  tryAcquire(key: string): boolean;
  /** `key` のロックを解放する。 */
  release(key: string): void;
}

function createKeyedLock(): KeyedLock {
  const lockedKeys = new Set<string>();
  return {
    tryAcquire(key: string): boolean {
      if (lockedKeys.has(key)) {
        return false;
      }
      lockedKeys.add(key);
      return true;
    },
    release(key: string): void {
      lockedKeys.delete(key);
    },
  };
}

/**
 * `key` のロックを最初のアクションとして取得し（TASK_BRIEF: 「プロフィールチェックより前に」）、
 * 取得できなければ `fn` を一切呼び出さず即座に `generation_in_progress` を返す。
 * ロックが取得できた場合、`fn` の実行結果（成功・Result失敗・例外のいずれであっても）を問わず、
 * `finally` で必ずロックを解放する（TASK_BRIEF: 「スタックしたロックは対象週の以降すべての
 * 生成を永久にブロックしてしまうため、本タスクで最も安全性に関わる性質」）。
 *
 * `TError`（既定 `never`）は `fn` が `GenerationError` に加えて返しうる追加のエラー型を表す
 * （task 9.2 `regenerateDay` の `NotFoundError` のように）。`generateWeek`/`regenerateWeek`
 * （`fn` が `Result<T, GenerationError>` のみを返す）はこの型引数を指定する必要がなく、
 * 既定の `never` のまま従来どおり動作する。
 */
async function withGenerationLock<T, TError = never>(
  lock: KeyedLock,
  key: string,
  fn: () => Promise<Result<T, GenerationError | TError>>
): Promise<Result<T, GenerationError | TError>> {
  if (!lock.tryAcquire(key)) {
    return generationErrResult(
      "generation_in_progress",
      `対象（${key}）への生成要求は既に処理中です。完了するまで新たな生成要求は受け付けられません。`
    );
  }
  try {
    return await fn();
  } finally {
    lock.release(key);
  }
}

/**
 * `weekStartDate` / `nutritionGateway` に対する、週の7日分の日付→栄養目標値の解決結果。
 * `targetsRecord` は `buildWeeklyPrompt` へそのまま渡し、`byDayIndex` は検証・永続化段階で
 * 各日の `targetKcal`（`NutritionTargetSnapshot.calorieTarget`）を参照するために使う
 * （TASK_BRIEF ステップ4: 「日付キーのrecordと per-dayIndex target の両方が必要」）。
 */
interface WeeklyTargets {
  targetsRecord: Record<IsoDate, NutritionTargetSnapshot>;
  byDayIndex: { dayIndex: number; dayDate: IsoDate; target: NutritionTargetSnapshot }[];
}

/**
 * `createMenuPlanService`（DIファクトリ関数パターン、このコードベースの規約）に対する
 * `MenuPlanService` を生成する。`generateWeek`/`regenerateWeek` は完全に同一の
 * `runWeeklyGeneration` に委譲する薄いexportである（ファイル冒頭コメント参照）。
 */
export function createMenuPlanService(deps: MenuPlanServiceDependencies): MenuPlanService {
  const lock = createKeyedLock();

  /**
   * TASK_BRIEF「5. オーケストレーション手順」のステップ3〜13を実装する共有の内部処理。
   * ロックの取得・解放は呼び出し元（`generateWeek`/`regenerateWeek`）が
   * `withGenerationLock` を通じて担うため、本関数自身はロックを一切意識しない。
   */
  async function runWeeklyGeneration(
    weekStartDate: IsoDate
  ): Promise<Result<WeekMenuPlan, GenerationError>> {
    // ステップ3: プロフィール取得（Requirement 12.1）。
    const profile = deps.profileGateway.getCurrentProfile();
    if (profile === null) {
      return generationErrResult(
        "profile_missing",
        "プロフィールが登録されていません。献立を生成するには、先にプロフィールを登録してください。"
      );
    }

    // ステップ4: 週の7日分について栄養目標値を1日ずつ取得する（Requirement 1.5, 12.2）。
    // 最初に失敗した時点で即座に返す（残りの日を確認する必要はない）。
    const targetsRecord: Record<IsoDate, NutritionTargetSnapshot> = {};
    const byDayIndex: WeeklyTargets["byDayIndex"] = [];
    for (let dayIndex = 0; dayIndex < DAYS_PER_WEEK; dayIndex++) {
      const dayDate = addDaysIso(weekStartDate, dayIndex);
      const targetResult = deps.nutritionGateway.getTargetsForDate(dayDate);
      if (!targetResult.ok) {
        return generationErrResult(
          "nutrition_unavailable",
          `対象日 ${dayDate}（dayIndex: ${dayIndex}）の栄養目標値が算出できません: ${targetResult.error.message}`
        );
      }
      targetsRecord[dayDate] = targetResult.value;
      byDayIndex.push({ dayIndex, dayDate, target: targetResult.value });
    }

    // ステップ5: 苦手サマリの取得（Requirement 6.2, 7.5, 10.3）。
    // generateWeek/regenerateWeekのいずれであっても無条件に呼び出す（ファイル冒頭コメント参照）。
    const dislikedSummary = deps.feedbackService.getDislikedSummary();

    // ステップ6: プロンプト構築（`MenuPromptBuilder` は実関数を直接呼び出す）。
    const payload = buildWeeklyPrompt(profile, targetsRecord, dislikedSummary);

    // ステップ7: Claudeへの週間生成要求（Requirement 1.2, 3, 12.3, 12.4）。
    const claudeResult = await deps.claudeMenuClient.generateWeek(payload);
    if (!claudeResult.ok) {
      return generationErrResult(
        mapClaudeErrorReason(claudeResult.error.type),
        claudeResult.error.message
      );
    }

    // ステップ8: dayIndexの網羅性・一意性ガード（task 9.1で新規に追加した防御、ファイル冒頭コメント参照）。
    const weeklyResult: WeeklyGenerationToolResult = claudeResult.value;
    if (!hasCompleteDayIndexSet(weeklyResult.days)) {
      return generationErrResult(
        "schema_validation_failed",
        "Claudeの週間献立生成結果のdayIndexが0〜6の7件を重複・欠落なく網羅していません。"
      );
    }

    // ステップ8': mealTypeの網羅性・一意性ガード（task 9.2で新規に追加するretrofit、
    // ファイル冒頭コメント参照）。7日それぞれの4食枠について確認する。
    for (const day of weeklyResult.days) {
      if (!hasCompleteMealTypeSet(day.meals)) {
        return generationErrResult(
          "schema_validation_failed",
          `Claudeの週間献立生成結果のdayIndex ${day.dayIndex} の4食枠のmealTypeが` +
            "朝食・昼食・夕食・間食を重複・欠落なく網羅していません。"
        );
      }
    }

    // ステップ9〜10: 28食枠すべての栄養価検証と DayMenu[] の組み立て（Requirement 4.3-4.7）。
    // dayIndexで引けるようMapへ変換する（`byDayIndex` と同じ順序で0..6を反復するため）。
    const claudeDaysByIndex = new Map(weeklyResult.days.map((day) => [day.dayIndex, day]));

    const days: DayMenu[] = [];
    for (const { dayIndex, dayDate, target } of byDayIndex) {
      // `hasCompleteDayIndexSet` がステップ8で真を返しているため、このルックアップは
      // 必ず成功する（`noUncheckedIndexedAccess` 対応のための防御的ガードのみ）。
      const claudeDay = claudeDaysByIndex.get(dayIndex);
      if (!claudeDay) {
        return generationErrResult(
          "schema_validation_failed",
          `dayIndex ${dayIndex} に対応するClaudeの生成結果が見つかりません（到達不能なはずの状態）。`
        );
      }

      const meals: MealSlot[] = [];
      for (const claudeMeal of claudeDay.meals) {
        const verifyResult = deps.nutritionVerificationService.verifyDish(claudeMeal.ingredients);
        if (!verifyResult.ok) {
          return generationErrResult(
            verifyResult.error.type,
            `対象日 ${dayDate}（dayIndex: ${dayIndex}）の ${claudeMeal.mealType}（${claudeMeal.dishName}）の栄養価検証に失敗しました: ${verifyResult.error.message}`
          );
        }
        meals.push({
          mealType: claudeMeal.mealType as MealType,
          dishName: claudeMeal.dishName,
          ingredients: claudeMeal.ingredients,
          nutrition: verifyResult.value,
        });
      }

      const dayNutrition: VerifiedNutritionValues = deps.nutritionVerificationService.verifyDay(
        meals.map((meal) => meal.nutrition)
      );
      const plannedKcal = dayNutrition.energyKcal;
      const targetKcal = target.calorieTarget;
      const varianceKcal = deps.nutritionVerificationService.computeVarianceKcal(
        plannedKcal,
        targetKcal
      );

      days.push({
        dayDate,
        dayIndex,
        meals,
        dayNutrition,
        plannedKcal,
        targetKcal,
        varianceKcal,
      });
    }

    // ステップ11: 永続化（Requirement 1.3, 1.4, 4.6, 6.1）。
    // ここまでに一度でも失敗していれば早期returnしており、`replaceWeek` はこの1箇所でのみ、
    // 完全に組み立てられた28食枠分のデータに対してのみ呼び出される
    // （部分的な献立プランを永続化しない）。
    const persisted = deps.menuPlanRepository.replaceWeek(weekStartDate, days);

    // ステップ12: 計画摂取カロリーの送信（Requirement 11.2, 11.4）。
    // 個々の送信が失敗しても処理全体は継続し、成功結果を返す。失敗はログにのみ記録する。
    for (const day of persisted.days) {
      const submitResult = deps.plannedCalorieGateway.submitPlannedCalories(
        day.dayDate,
        day.plannedKcal
      );
      if (!submitResult.ok) {
        console.error(
          `MenuPlanService: 計画摂取カロリーの送信に失敗しました（date: ${day.dayDate}, plannedKcal: ${day.plannedKcal}）: ${submitResult.error.message}`
        );
      }
    }

    // ステップ13: 成功。
    return { ok: true, value: persisted };
  }

  async function generateWeek(
    weekStartDate: IsoDate
  ): Promise<Result<WeekMenuPlan, GenerationError>> {
    return withGenerationLock(lock, weekStartDate, () => runWeeklyGeneration(weekStartDate));
  }

  async function regenerateWeek(
    weekStartDate: IsoDate
  ): Promise<Result<WeekMenuPlan, GenerationError>> {
    return withGenerationLock(lock, weekStartDate, () => runWeeklyGeneration(weekStartDate));
  }

  /**
   * `regenerateDay`（task 9.2）の内部オーケストレーション。design.md「日単位再生成フロー
   * （他6日考慮）」のNoteのとおり、プロフィール取得・栄養目標取得・苦手サマリ取得は
   * `runWeeklyGeneration` と同一の手順を、対象日1日分に限定して辿る。ロックの取得・解放は
   * 呼び出し元（`regenerateDay`）が `withGenerationLock` を通じて担うため、本関数自身は
   * ロックを一切意識しない（`runWeeklyGeneration` と同じ役割分担）。
   */
  async function runDailyGeneration(
    weekStartDate: IsoDate,
    dayIndex: number
  ): Promise<Result<DayMenu, GenerationError | NotFoundError>> {
    // ステップ3: 対象週の有効なプランの存在確認（Requirement 7.4、design.md NotFoundError分岐）。
    const activePlan = deps.menuPlanRepository.getActivePlan(weekStartDate);
    if (activePlan === null) {
      const notFound: NotFoundError = {
        type: "not_found",
        message:
          `対象週（${weekStartDate}）の有効な週間献立プランが見つかりません。` +
          "日単位の再生成を行うには、先に週間献立を生成してください。",
      };
      return { ok: false, error: notFound };
    }

    // ステップ4: プロフィール取得（Requirement 12.1、週間生成と同一の手順）。
    const profile = deps.profileGateway.getCurrentProfile();
    if (profile === null) {
      return generationErrResult(
        "profile_missing",
        "プロフィールが登録されていません。献立を生成するには、先にプロフィールを登録してください。"
      );
    }

    // ステップ5: 対象日の栄養目標値取得（Requirement 1.5, 12.2、週間生成と同一の手順）。
    const dayDate = addDaysIso(weekStartDate, dayIndex);
    const targetResult = deps.nutritionGateway.getTargetsForDate(dayDate);
    if (!targetResult.ok) {
      return generationErrResult(
        "nutrition_unavailable",
        `対象日 ${dayDate}（dayIndex: ${dayIndex}）の栄養目標値が算出できません: ${targetResult.error.message}`
      );
    }
    const target = targetResult.value;

    // ステップ6: 残り6日分の料理名・食品ID一覧の取得（Requirement 7.2）。
    const otherDays = deps.menuPlanRepository.findOtherDays(weekStartDate, dayIndex);

    // ステップ7: 苦手サマリの取得（Requirement 7.5, 10.3、週間生成と同一の手順）。
    const dislikedSummary = deps.feedbackService.getDislikedSummary();

    // ステップ8: プロンプト構築（`MenuPromptBuilder` は実関数を直接呼び出す）。
    const payload = buildDailyPrompt(profile, target, otherDays, dislikedSummary);

    // ステップ9: Claudeへの日単位生成要求（Requirement 1.2, 3, 12.3, 12.4）。
    const claudeResult = await deps.claudeMenuClient.generateDay(payload);
    if (!claudeResult.ok) {
      return generationErrResult(
        mapClaudeErrorReason(claudeResult.error.type),
        claudeResult.error.message
      );
    }

    // ステップ10: mealTypeの網羅性・一意性ガード（このタスクで新規に追加する防御、ファイル冒頭コメント参照）。
    const dailyResult: DailyGenerationToolResult = claudeResult.value;
    if (!hasCompleteMealTypeSet(dailyResult.meals)) {
      return generationErrResult(
        "schema_validation_failed",
        `対象日 ${dayDate}（dayIndex: ${dayIndex}）のClaudeの日単位献立生成結果の4食枠のmealTypeが` +
          "朝食・昼食・夕食・間食を重複・欠落なく網羅していません。"
      );
    }

    // ステップ11: 4食枠分の栄養価検証とMealSlot[]の組み立て（Requirement 4.3-4.7）。
    const meals: MealSlot[] = [];
    for (const claudeMeal of dailyResult.meals) {
      const verifyResult = deps.nutritionVerificationService.verifyDish(claudeMeal.ingredients);
      if (!verifyResult.ok) {
        return generationErrResult(
          verifyResult.error.type,
          `対象日 ${dayDate}（dayIndex: ${dayIndex}）の ${claudeMeal.mealType}（${claudeMeal.dishName}）の栄養価検証に失敗しました: ${verifyResult.error.message}`
        );
      }
      meals.push({
        mealType: claudeMeal.mealType as MealType,
        dishName: claudeMeal.dishName,
        ingredients: claudeMeal.ingredients,
        nutrition: verifyResult.value,
      });
    }

    // ステップ12: 日次合計・計画摂取カロリーの算出（Requirement 11.1）。
    // `plannedKcal` は4食枠の検証済みエネルギー量の合計そのもの（TASK_BRIEFのCRITICAL事項）。
    // `MenuPlanRepository.replaceDay` は渡された `meals` から独自に `varianceKcal` を導出するため
    // （`menu-plan.repository.ts` の `runReplaceDay` 参照）、ここで算出する `plannedKcal` が
    // その導出と整合していなければ `planned_kcal` 列が矛盾した値になる。
    const dayNutrition: VerifiedNutritionValues = deps.nutritionVerificationService.verifyDay(
      meals.map((meal) => meal.nutrition)
    );
    const plannedKcal = dayNutrition.energyKcal;
    const targetKcal = target.calorieTarget;

    // ステップ13: 永続化（対象日のみを置換、Requirement 7.1, 7.4）。
    const persisted = deps.menuPlanRepository.replaceDay(
      weekStartDate,
      dayIndex,
      meals,
      plannedKcal,
      targetKcal
    );

    // ステップ14: 計画摂取カロリーの送信（Requirement 11.2, 11.4、非致命的）。
    const submitResult = deps.plannedCalorieGateway.submitPlannedCalories(
      persisted.dayDate,
      persisted.plannedKcal
    );
    if (!submitResult.ok) {
      console.error(
        `MenuPlanService: 計画摂取カロリーの送信に失敗しました（date: ${persisted.dayDate}, plannedKcal: ${persisted.plannedKcal}）: ${submitResult.error.message}`
      );
    }

    // ステップ15: 成功。
    return { ok: true, value: persisted };
  }

  /**
   * design.md #MenuPlanService Service Interface `regenerateDay`（task 9.2、
   * Requirements 7, 11.1, 11.2, 12）。ロックキーは `` `${weekStartDate}:day:${dayIndex}` ``
   * （週全体のロックキーである `weekStartDate` 単体とは異なる、ファイル冒頭コメント参照）。
   */
  async function regenerateDay(
    weekStartDate: IsoDate,
    dayIndex: number
  ): Promise<Result<DayMenu, GenerationError | NotFoundError>> {
    return withGenerationLock<DayMenu, NotFoundError>(
      lock,
      `${weekStartDate}:day:${dayIndex}`,
      () => runDailyGeneration(weekStartDate, dayIndex)
    );
  }

  function getActivePlan(weekStartDate: IsoDate): WeekMenuPlan | null {
    // 読み取り専用のため、ロックは不要（TASK_BRIEF「6. getActivePlan」）。
    return deps.menuPlanRepository.getActivePlan(weekStartDate);
  }

  return { generateWeek, regenerateWeek, regenerateDay, getActivePlan };
}
