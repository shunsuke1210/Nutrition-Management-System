import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NotFoundError, ValidationError } from "../shared/result.js";
import type { GenerationError, GenerationFailureReason, MenuPlanService } from "./menu-plan.service.js";
import type { ShoppingListService } from "./shopping-list.service.js";

/**
 * `/api/menu-plans` のHTTPハンドリングを担う MenuPlanController（task 9.3/13.3、
 * design.md: Domain: Menu Plan Generation > MenuPlanController、
 * Requirements 1.1, 6.1, 7.1, 11.3, 12.1-12.5, 13.1, 13.2, 14.1, 14.6）。
 *
 * design.mdの API Contract が定義する5行のうち、最初の4行（生成・再生成・日単位再生成・取得）に
 * 加え、5行目の `GET /api/menu-plans/:weekStartDate/shopping-list`（task 13.3）も本ファイルが
 * 実装する。5行目は `ShoppingListService.buildForWeek`（task 13.1で実装済み、design.md
 * #MenuPlanController Outbound: 「ShoppingListService — 買い物リストの生成 (P0)」）へ単純に
 * 委譲するのみで、`MenuPlanService` の4ルートとは独立したオーケストレーションを持たない
 * （ファイル末尾「GET /api/menu-plans/:weekStartDate/shopping-list について」参照）。
 *
 * ## weekStartDateの検証: フォーマット・実在するカレンダー日付・月曜日始まりの3段階
 * `menu-plan.service.ts` 自身のPrecondition（design.md #MenuPlanService Service Interface:
 * 「`weekStartDate` は月曜日始まりの `YYYY-MM-DD` 形式（Controller層のZod検証を通過済み）」）
 * が示すとおり、`MenuPlanService` はこのController層の検証を信頼して一切再検証しない
 * （`addDaysIso` が任意の日付に対して単純な加算のみを行う。月曜日始まりでない
 * `weekStartDate` を渡すと、`dayIndex` から導出される日付が「その週の月曜日始まり」という
 * 前提と食い違い、`nutrition-engine`/`user-profile` への日付引き渡しが破綻する）。したがって
 * 本Controllerは以下3段階すべてを検証する: (1) `YYYY-MM-DD` 形式の正規表現、(2) 実在する
 * カレンダー日付（`daily-log.routes.ts` の `isValidIsoDate` と同じ「`Date` に通してから
 * ISO文字列に戻し、往復一致を確認する」方式）、(3) `Date#getUTCDay()`（0=日曜, 1=月曜,
 * ..., 6=土曜）が1（月曜日）であること。(3)は最も見落としやすい規約であり、"2026-01-06"
 * のようなカレンダー上は有効だが火曜日の日付は400として拒否されなければならない
 * （`menu-plan.service.ts` の `addDaysIso` と同じUTC基準の日付演算に揃える）。
 *
 * ## Zodスキーマをこのファイルにローカル定義することについて（判断根拠）
 * `nutrition.routes.ts`（task 4.1）は、当時 `server` パッケージが `zod` への直接依存を
 * まだ持っていなかったため、`@nutrition/shared` が公開する共有スキーマ（`NutritionDateQuerySchema`）
 * のみを消費し、`zod` 自体の型を直接importせず構造的型付けの `ZodIssueLike` で受け取る
 * という制約下の設計だった。この制約は本タスクにはもはや当てはまらない:
 * `claude-menu.client.ts`（task 6.2）が既に `zod` を `server/package.json` の直接依存に
 * 追加しており、`weekStartDate`（月曜日始まり）/`dayIndex`（0-6）の検証は
 * `NutritionDateQuerySchema` のように複数ルートが共有するクロスパッケージの形状ではなく、
 * この `MenuPlanController` 1箇所に固有の検証規則である。したがって本ファイルは `zod` の
 * 実際の型（`z.ZodError` 等）を直接importし、スキーマをこのファイル内にローカル定義する
 * （`@nutrition/shared` へは追加しない）。`toValidationError` は `nutrition.routes.ts` の
 * 同名ヘルパーと同じ「`issues` を `fieldErrors`（`Record<string, string[]>`）へ変換する」
 * ロジックをそのまま踏襲するが、`ZodIssueLike` ではなく実際の `z.ZodError` を受け取る点が異なる
 * （この判断のもう一方の理由がもはや成立しないため）。
 *
 * ## GenerationErrorのHTTPステータスへの変換を `app.ts` に追加しないことについて
 * `server/src/app.ts` の `setErrorHandler` は現在 `ValidationError`（→400）と
 * `NotFoundError`（→404）のみを型判定し、それ以外は詳細を隠した500にフォールスルーする。
 * 本タスクの境界（`MenuPlanController`）は `app.ts` の `setErrorHandler` 自体を変更対象に
 * 含まない。`nutrition.routes.ts`（`CalculationUnavailableError` → 409）が既に確立した
 * precedent（同ファイル冒頭コメント参照: 「`app.ts` を変更対象に含まないため、ここでは
 * `throw` に頼らず `reply.status(409).send(result.error)` によってこのファイル内で直接
 * 409へ変換する」）に倣い、`GenerationError.reason` に応じた409/502への変換は
 * `generationErrorStatus` によってこのファイル内で直接行う（`reply.status(...).send(error)`）。
 * 一方、`regenerateDay` が返し得る `NotFoundError` は `app.ts` の `setErrorHandler` が
 * 既に認識する形状であるため、`daily-log.routes.ts`/`nutrition.routes.ts` と同じ
 * 「Controllerはエラー値を`throw`し、共通エラーハンドラに変換を委ねる」規約のまま `throw` する
 * （`app.ts` の変更は一切不要）。
 *
 * ## GET /api/menu-plans/:weekStartDate の null 許容について
 * design.mdの API Contract はこのエンドポイントのレスポンスを `WeekMenuPlan | null`、
 * エラーを400/500のみと定義する（404を含まない）。したがって対象週の有効なプランが
 * 存在しない場合（`MenuPlanService.getActivePlan` が `null` を返す場合）も200として
 * `null` をそのまま返す。`daily-log.routes.ts` の `GET /api/daily-logs/:date`
 * （レコード非存在時に200 + `null`を返す既存の規約）と同じ挙動であり、`regenerateDay`
 * の「対象週の有効なプランが存在しない→404」とは意図的に異なる（design.md参照）。
 *
 * ## GET /api/menu-plans/:weekStartDate/shopping-list について（task 13.3）
 * `ShoppingListService.buildForWeek`（`shopping-list.service.ts`, task 13.1）は
 * `MenuPlanService` の4メソッドと異なり、`async`でも`Result`で包まれてもいない、素の同期関数
 * （`(weekStartDate: IsoDate) => ShoppingList | null`）である。したがって本ルートは
 * `GenerationError`→409/502変換ロジック（`generationErrorStatus`）を一切経由せず、戻り値を
 * そのまま返すだけでよい。対象週の有効なプランが存在しない場合に`buildForWeek`自身が`null`を
 * 返す規約（design.md「既存の`GET /api/menu-plans/:weekStartDate`と同様に200 + nullを返し、
 * 専用のエラー型は導入しない」、要件14.6）は、上記の`GET /api/menu-plans/:weekStartDate`の
 * null許容と全く同じFastifyの挙動（`null`のJSONボディは200として正しくシリアライズされる）に
 * 委ねられており、本ルート側で`null`を特別扱いする分岐は不要である。
 *
 * 認証・認可のチェックは一切行わない（Requirement 13.1, 13.2）。
 *
 * `buildApp()`（`server/src/app.ts`）自体はこのファイルの登録を行わないため、呼び出し側
 * （`app.ts` の `registerRoutes()`）が明示的に `registerMenuPlanRoutes` を呼んで登録する
 * 必要がある（`profile.routes.ts`/`daily-log.routes.ts`/`nutrition.routes.ts` と同じ規約）。
 */

const WEEK_START_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `Date#getUTCDay()` の戻り値: 0=日曜, 1=月曜, ..., 6=土曜。 */
const MONDAY_UTC_DAY = 1;

/**
 * `value`（`YYYY-MM-DD`形式が既に確認済み）が実在するカレンダー日付であることを確認する
 * （`daily-log.routes.ts` の `isValidIsoDate` と同じ「`Date` に通してから往復一致を確認する」
 * 方式）。
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
 * （UTC基準、`menu-plan.service.ts` の `addDaysIso` と同じ日付演算の前提に揃える）。
 */
function isMondayIsoDate(value: string): boolean {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay() === MONDAY_UTC_DAY;
}

/**
 * `weekStartDate` パスパラメータの検証スキーマ。フォーマット・実在するカレンダー日付・
 * 月曜日始まりの3段階すべてを検証する（ファイル冒頭コメント参照）。4ルートすべてが
 * この同一スキーマを共有する。
 */
const WeekStartDateSchema = z
  .string()
  .regex(WEEK_START_DATE_PATTERN, "weekStartDate must be in YYYY-MM-DD format")
  .refine(isRealCalendarDate, "weekStartDate must be a real calendar date")
  .refine(isMondayIsoDate, "weekStartDate must be a Monday (the ISO week start date)");

const WeekStartDateParamsSchema = z.object({ weekStartDate: WeekStartDateSchema });

/**
 * `dayIndex` パスパラメータの検証スキーマ。URLパスパラメータは常に文字列で渡されるため
 * `z.coerce.number()` で数値化したうえで、0-6の整数であることを検証する
 * （`shared/src/menu.schema.ts` の `DayMenuSchema.dayIndex: z.number().int().min(0).max(6)`
 * と同じ範囲制約）。
 */
const DayIndexSchema = z.coerce
  .number()
  .int("dayIndex must be an integer between 0 and 6")
  .min(0, "dayIndex must be an integer between 0 and 6")
  .max(6, "dayIndex must be an integer between 0 and 6");

const DayRegenerateParamsSchema = z.object({
  weekStartDate: WeekStartDateSchema,
  dayIndex: DayIndexSchema,
});

/**
 * Zodの検証エラーを `ValidationError.fieldErrors`（`Record<string, string[]>`）形状へ変換する
 * （`nutrition.routes.ts` の `toValidationError` と同じロジックだが、`ZodIssueLike` ではなく
 * 実際の `z.ZodError` を直接受け取る。ファイル冒頭コメント「Zodスキーマをこのファイルに
 * ローカル定義することについて」参照）。
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
 * design.md #MenuPlanController Responsibilities & Constraints: 「`GenerationError` の
 * `reason` に応じて409（前提条件未達・重複要求）または502（Claude API起因の失敗）を返す」。
 * `menu-plan.service.ts` が定義する8つの `GenerationFailureReason` のうち、前提条件未達
 * （`profile_missing`/`nutrition_unavailable`）と重複要求（`generation_in_progress`）の
 * 3つが409、残り5つ（Claude APIまたは栄養価検証起因の失敗）が502。
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
 * `error` が `regenerateDay` の失敗Result（`GenerationError | NotFoundError`）のうち
 * `NotFoundError` であるかを判定する（`app.ts` の `isNotFoundError` と同じ判別方法だが、
 * このファイルは `app.ts` をimportしないため、同じ判別ロジックをここに複製する。
 * 両者は同一の `NotFoundError` 形状（`server/src/shared/result.ts`）に対する判定であり、
 * 挙動が食い違う余地はない）。
 */
function isNotFoundError(error: GenerationError | NotFoundError): error is NotFoundError {
  return error.type === "not_found";
}

export function registerMenuPlanRoutes(
  app: FastifyInstance,
  menuPlanService: MenuPlanService,
  shoppingListService: ShoppingListService
): void {
  app.post("/api/menu-plans/:weekStartDate/generate", async (request, reply) => {
    const parsed = WeekStartDateParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw toValidationError(parsed.error);
    }

    const result = await menuPlanService.generateWeek(parsed.data.weekStartDate);
    if (!result.ok) {
      reply.status(generationErrorStatus(result.error.reason)).send(result.error);
      return;
    }

    return result.value;
  });

  app.post("/api/menu-plans/:weekStartDate/regenerate", async (request, reply) => {
    const parsed = WeekStartDateParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw toValidationError(parsed.error);
    }

    const result = await menuPlanService.regenerateWeek(parsed.data.weekStartDate);
    if (!result.ok) {
      reply.status(generationErrorStatus(result.error.reason)).send(result.error);
      return;
    }

    return result.value;
  });

  app.post("/api/menu-plans/:weekStartDate/days/:dayIndex/regenerate", async (request, reply) => {
    const parsed = DayRegenerateParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw toValidationError(parsed.error);
    }

    const { weekStartDate, dayIndex } = parsed.data;
    const result = await menuPlanService.regenerateDay(weekStartDate, dayIndex);
    if (!result.ok) {
      if (isNotFoundError(result.error)) {
        throw result.error;
      }
      reply.status(generationErrorStatus(result.error.reason)).send(result.error);
      return;
    }

    return result.value;
  });

  app.get("/api/menu-plans/:weekStartDate", (request) => {
    const parsed = WeekStartDateParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw toValidationError(parsed.error);
    }

    // design.md API Contract: レスポンスは `WeekMenuPlan | null`、エラーは400/500のみ
    // （404は含まない）。有効なプランが存在しない場合も200 + `null` をそのまま返す
    // （ファイル冒頭コメント「GET /api/menu-plans/:weekStartDate の null 許容について」）。
    return menuPlanService.getActivePlan(parsed.data.weekStartDate);
  });

  app.get("/api/menu-plans/:weekStartDate/shopping-list", (request) => {
    const parsed = WeekStartDateParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw toValidationError(parsed.error);
    }

    // `ShoppingListService.buildForWeek` は素の同期関数で `ShoppingList | null` を直接返す
    // （ファイル冒頭コメント「GET /api/menu-plans/:weekStartDate/shopping-list について」）。
    // 対象週の有効なプランが存在しない場合の200 + `null` もそのまま透過する（要件14.6）。
    return shoppingListService.buildForWeek(parsed.data.weekStartDate);
  });
}
