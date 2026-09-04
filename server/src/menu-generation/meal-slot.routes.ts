import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FeedbackInputSchema, MealTypeSchema } from "@nutrition/shared";
import type { NotFoundError, ValidationError } from "../shared/result.js";
import type { GenerationError, GenerationFailureReason } from "./menu-plan.service.js";
import type { RecipeDetailService } from "./recipe-detail.service.js";
import type { FeedbackService } from "./feedback.service.js";
import type { EatingOutSuggestionService } from "./eating-out-suggestion.service.js";

/**
 * `/api/menu-plans/:week/days/:day/meals/:meal` のHTTPハンドリングを担う MealSlotController
 * （task 10.2、design.md: Domain: Menu Plan Generation > MealSlotController、
 * Requirements 8.1, 9.1, 10.1, 10.4, 13.1, 13.2）。
 *
 * design.md の API Contract が定義する3行のうち、最初の2行（レシピ詳細生成・フィードバック記録）
 * はtask 10.2で実装済み。3行目（`GET .../eating-out-suggestion`）は`EatingOutSuggestionService`
 * （task 13.5で実装済み）に委譲するルートであり、本タスク（13.6）で追加する。
 *
 * ## eating-out-suggestionルートのエラー形状がrecipe-detailルートと異なることについて
 * `EatingOutSuggestionService.suggestForMealSlot`は`eating-out-suggestion.service.ts`冒頭コメント
 * のとおり同期関数であり、戻り値は`Result<EatingOutSuggestionResult, NotFoundError>`のみ
 * （`RecipeDetailService.generateForMealSlot`と異なり`GenerationError`を一切返し得ない —
 * このServiceはClaude APIを呼ばないため生成失敗という概念が存在しない、要件15.7）。
 * したがって本ルートには409/502分岐が一切なく、失敗時は常に`NotFoundError`を`throw`して
 * 既存の共通エラーハンドラ（404）に委ねるのみでよい。「候補なし」（`suggestion: null`）は
 * エラーではなく`Result.ok`の一部（`{ok: true, value: {suggestion: null}}`）であるため、
 * 200としてそのまま返す（design.mdのシーケンス図: `Svc-->>Ctrl: EatingOutSuggestionResult
 * （suggestion: 選定結果 または null）` / `Ctrl-->>UI: 200 + EatingOutSuggestionResult`。
 * レスポンスボディは常に`{suggestion: ...}`というJSONオブジェクトであり、`ShoppingList`
 * （task 13.3、対象週にプランが存在しない場合にボディそのものが裸の`null`）とは異なる形状である
 * ことに注意する）。
 *
 * ## weekStartDate/dayIndex/mealTypeの検証について
 * `menu-plan.routes.ts`（task 9.3）が確立した規約をそのまま踏襲する:
 * - `weekStartDate`: フォーマット（`YYYY-MM-DD`）→ 実在するカレンダー日付 → 月曜日始まり
 *   （`Date#getUTCDay() === 1`）の3段階すべてを検証する。`RecipeDetailService`/`FeedbackService`
 *   は永続化済みの週をこの文字列で照会するだけで日付演算は行わないが、システム全体の不変条件
 *   （実在する `week_start_date` は常に月曜日）に揃えるほうが正しく、かつフォーマット不正・
 *   曜日不正な入力に対して404より有益な400を返せる（`menu-plan.routes.ts`冒頭コメント参照）。
 *   このスキーマは `menu-plan.routes.ts` のものと同一の検証規則だが、このコードベースの
 *   「Zodスキーマはこのファイルにローカル定義する」規約（`menu-plan.routes.ts`冒頭コメント参照）
 *   に倣い、本ファイル内に複製する（`menu-plan.routes.ts`側は変更しない、本タスクのboundary外）。
 * - `dayIndex`: `z.coerce.number().int().min(0).max(6)`（`menu-plan.routes.ts`と同一）。
 * - `mealType`: `@nutrition/shared` が公開する実際の `MealTypeSchema`
 *   （`z.enum(["breakfast","lunch","dinner","snack"])`）をそのまま用いる。
 *   `claude-menu.client.ts`/`menu-prompt.builder.ts` と同じ「4値をハンドコピーせず共有スキーマ
 *   から取得する」規約に従う。
 *
 * ## GenerationErrorのHTTPステータスへの変換を `app.ts` に追加しないことについて
 * `menu-plan.routes.ts` が確立したprecedentに倣い、`GenerationError.reason` に応じた409/502への
 * 変換は `generationErrorStatus` によってこのファイル内で直接行う
 * （`reply.status(...).send(error)`）。`recipeDetailService.generateForMealSlot` が実際に返し得る
 * reasonは`profile_missing`/`schema_validation_failed`/`claude_refusal`/`claude_request_failed`/
 * `food_id_not_found`/`unit_not_found`の6つのみだが（`nutrition_unavailable`/
 * `generation_in_progress`はこのServiceの依存構成上到達不能、`recipe-detail.service.ts`冒頭
 * コメント参照）、`GenerationFailureReason`はspec全体で共有される型であるため、
 * `menu-plan.routes.ts`と同一の完全な8-reasonマッピングをそのまま用いる（狭めない）。
 *
 * `NotFoundError` はいずれのルートも `throw` し、`app.ts` の既存の共通エラーハンドラ
 * （変更なし）に404への変換を委ねる。フィードバック記録の `ValidationError`（現状は
 * `{liked: boolean}` にこれ以上の制約が無いため到達不能だが、型としては存在し得る）も同じ
 * `throw` で400へ変換される（同じ `ValidationError` 形状を共通ハンドラが既に認識するため、
 * この経路専用の別の400レスポンス形式を発明しない）。
 *
 * 認証・認可のチェックは一切行わない（Requirement 13.1, 13.2）。
 *
 * `app.ts` の `registerRoutes()` が明示的に `registerMealSlotRoutes` を呼んで登録する
 * （`menu-plan.routes.ts`/`profile.routes.ts`/`daily-log.routes.ts`/`nutrition.routes.ts`と
 * 同じ規約）。
 */

const WEEK_START_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `Date#getUTCDay()` の戻り値: 0=日曜, 1=月曜, ..., 6=土曜。 */
const MONDAY_UTC_DAY = 1;

/**
 * `value`（`YYYY-MM-DD`形式が既に確認済み）が実在するカレンダー日付であることを確認する
 * （`menu-plan.routes.ts` の `isRealCalendarDate` と同一の方式）。
 */
function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * `value`（実在するカレンダー日付であることが既に確認済み）が月曜日であることを確認する
 * （UTC基準、`menu-plan.routes.ts` の `isMondayIsoDate` と同一の方式）。
 */
function isMondayIsoDate(value: string): boolean {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay() === MONDAY_UTC_DAY;
}

/**
 * `weekStartDate` パスパラメータの検証スキーマ（`menu-plan.routes.ts` の
 * `WeekStartDateSchema` と同一の3段階検証。ファイル冒頭コメント参照）。
 */
const WeekStartDateSchema = z
  .string()
  .regex(WEEK_START_DATE_PATTERN, "weekStartDate must be in YYYY-MM-DD format")
  .refine(isRealCalendarDate, "weekStartDate must be a real calendar date")
  .refine(isMondayIsoDate, "weekStartDate must be a Monday (the ISO week start date)");

/**
 * `dayIndex` パスパラメータの検証スキーマ（`menu-plan.routes.ts` の `DayIndexSchema` と同一）。
 */
const DayIndexSchema = z.coerce
  .number()
  .int("dayIndex must be an integer between 0 and 6")
  .min(0, "dayIndex must be an integer between 0 and 6")
  .max(6, "dayIndex must be an integer between 0 and 6");

/**
 * `weekStartDate`/`dayIndex`/`mealType` の3パスパラメータをまとめて検証するスキーマ。
 * 本ファイルの2ルートいずれもこの同一スキーマを共有する。
 */
const MealSlotParamsSchema = z.object({
  weekStartDate: WeekStartDateSchema,
  dayIndex: DayIndexSchema,
  mealType: MealTypeSchema,
});

/**
 * Zodの検証エラーを `ValidationError.fieldErrors`（`Record<string, string[]>`）形状へ変換する
 * （`menu-plan.routes.ts` の `toValidationError` と同一のロジック）。
 */
function toValidationError(error: z.ZodError): ValidationError {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    const messages = fieldErrors[key] ?? (fieldErrors[key] = []);
    messages.push(issue.message);
  }

  return { type: "validation", fieldErrors };
}

/**
 * `menu-plan.routes.ts` の `generationErrorStatus` と同一の8-reasonマッピング
 * （ファイル冒頭コメント「GenerationErrorのHTTPステータスへの変換」参照）。
 */
const CONFLICT_REASONS: ReadonlySet<GenerationFailureReason> = new Set([
  "profile_missing",
  "nutrition_unavailable",
  "generation_in_progress",
]);

function generationErrorStatus(reason: GenerationFailureReason): 409 | 502 {
  return CONFLICT_REASONS.has(reason) ? 409 : 502;
}

/**
 * `error` が `generateForMealSlot` の失敗Result（`GenerationError | NotFoundError`）のうち
 * `NotFoundError` であるかを判定する（`menu-plan.routes.ts` の `isNotFoundError` と同一の
 * 判別方法。両者は同一の `NotFoundError` 形状（`server/src/shared/result.ts`）に対する判定であり
 * 挙動が食い違う余地はない）。
 */
function isNotFoundError(error: GenerationError | NotFoundError): error is NotFoundError {
  return error.type === "not_found";
}

export function registerMealSlotRoutes(
  app: FastifyInstance,
  recipeDetailService: RecipeDetailService,
  feedbackService: FeedbackService,
  eatingOutSuggestionService: EatingOutSuggestionService
): void {
  app.post(
    "/api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/recipe-detail",
    async (request, reply) => {
      const parsed = MealSlotParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw toValidationError(parsed.error);
      }

      const { weekStartDate, dayIndex, mealType } = parsed.data;
      const result = await recipeDetailService.generateForMealSlot(weekStartDate, dayIndex, mealType);
      if (!result.ok) {
        if (isNotFoundError(result.error)) {
          throw result.error;
        }
        reply.status(generationErrorStatus(result.error.reason)).send(result.error);
        return;
      }

      return result.value;
    }
  );

  app.post(
    "/api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/feedback",
    async (request, reply) => {
      const parsedParams = MealSlotParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        throw toValidationError(parsedParams.error);
      }

      const parsedBody = FeedbackInputSchema.safeParse(request.body);
      if (!parsedBody.success) {
        throw toValidationError(parsedBody.error);
      }

      const { weekStartDate, dayIndex, mealType } = parsedParams.data;
      // `recordFeedback` は同期関数（`feedback.service.ts`参照）。戻り値は
      // `Result<void, ValidationError | NotFoundError>` — いずれの失敗形状も `app.ts` の
      // 既存の共通エラーハンドラが認識する形状であるため、判別せずそのまま `throw` する
      // （ファイル冒頭コメント参照）。
      const result = feedbackService.recordFeedback(weekStartDate, dayIndex, mealType, parsedBody.data);
      if (!result.ok) {
        throw result.error;
      }

      reply.code(204).send();
    }
  );

  app.get(
    "/api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/eating-out-suggestion",
    async (request) => {
      const parsed = MealSlotParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw toValidationError(parsed.error);
      }

      const { weekStartDate, dayIndex, mealType } = parsed.data;
      // `suggestForMealSlot` は同期関数（`eating-out-suggestion.service.ts`参照）。戻り値は
      // `Result<EatingOutSuggestionResult, NotFoundError>` — `GenerationError`は一切登場しない
      // ため409/502分岐は不要（ファイル冒頭コメント「eating-out-suggestionルートのエラー形状が
      // recipe-detailルートと異なることについて」参照）。失敗は常に`NotFoundError`であり、
      // 既存の共通エラーハンドラに404への変換を委ねるため `throw` する。
      const result = eatingOutSuggestionService.suggestForMealSlot(weekStartDate, dayIndex, mealType);
      if (!result.ok) {
        throw result.error;
      }

      // 「候補なし」（`result.value.suggestion === null`）は失敗ではなく正常応答の一部
      // （要件15.5）。`value`をそのまま返すことで、常に`{suggestion: ...}`というJSONオブジェクトが
      // 200で返る（ファイル冒頭コメント参照。裸の`null`ボディにはしない）。
      return result.value;
    }
  );
}
