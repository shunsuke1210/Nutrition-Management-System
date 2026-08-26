import type { FastifyInstance } from "fastify";
import type { DailyLogInput, ExerciseEntryInput } from "@nutrition/shared";
import type { NotFoundError, ValidationError } from "../shared/result.js";
import type { DailyLogService } from "./daily-log.service.js";

/**
 * `/api/daily-logs` のHTTPハンドリングを担う DailyLogController
 * （design.md: Components and Interfaces > DailyLogController、
 * Domain: UI (Presentation) > API Contract > Daily Log）。
 *
 * - ControllerはHTTPの関心事（パス/クエリパラメータの取り出し・日付形式の妥当性チェック・
 *   ステータスコードの決定）のみを扱い、業務ルール（レンジ検証・ハイブリッド解決）は
 *   `DailyLogService`（Service層）に閉じ込める（design.md: Architecture Integration > 境界順守。
 *   `profile.routes.ts` と同じ規約）。
 * - `GET /api/daily-logs?from=&to=` は取得した配列（`DailyLogEntry[]`、日付昇順）を
 *   そのまま返すのみで、グラフ描画・可視化・集計処理は一切行わない（Requirement 11.3）。
 * - 各Serviceメソッドが `{ ok: false }` を返した場合は `result.error`（`ValidationError` /
 *   `NotFoundError`）を `throw` し、`app.ts` の共通エラーハンドラにHTTPステータスへの変換を
 *   委ねる（`profile.routes.ts` と同じ規約: 「Controllerはエラー値をthrowする」）。
 * - 認証・認可のチェックは一切行わない（Requirement 12.1, 12.2, 12.3）。
 *
 * `buildApp()`（`server/src/app.ts`）自体はまだこのルートを登録しない（task 6.1 の責務）ため、
 * 呼び出し側が明示的にこの関数を呼んで登録する必要がある。
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `value` が `YYYY-MM-DD` 形式であり、かつ実在する日付（例:「2024-02-30」のような
 * カレンダー上存在しない日付を除外する）であることを確認する。
 */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString().slice(0, 10) === value;
}

/** 日付パラメータの形式不正を表す `ValidationError` を組み立てる。 */
function invalidDateError(field: string): ValidationError {
  return {
    type: "validation",
    fieldErrors: { [field]: [`${field} must be a valid YYYY-MM-DD date`] },
  };
}

export function registerDailyLogRoutes(
  app: FastifyInstance,
  dailyLogService: DailyLogService
): void {
  app.get("/api/daily-logs", (request) => {
    const { from, to } = request.query as { from?: unknown; to?: unknown };

    if (typeof from !== "string" || !isValidIsoDate(from)) {
      throw invalidDateError("from");
    }
    if (typeof to !== "string" || !isValidIsoDate(to)) {
      throw invalidDateError("to");
    }

    return dailyLogService.getLogsInRange(from, to);
  });

  app.get("/api/daily-logs/:date", (request) => {
    const { date } = request.params as { date: string };

    if (!isValidIsoDate(date)) {
      throw invalidDateError("date");
    }

    return dailyLogService.getLog(date);
  });

  app.put("/api/daily-logs/:date", (request) => {
    const { date } = request.params as { date: string };

    if (!isValidIsoDate(date)) {
      throw invalidDateError("date");
    }

    const input = request.body as DailyLogInput;
    const result = dailyLogService.upsertLog(date, input);

    if (!result.ok) {
      throw result.error;
    }

    return result.value;
  });

  app.put("/api/daily-logs/:date/planned-calories", (request) => {
    const { date } = request.params as { date: string };

    if (!isValidIsoDate(date)) {
      throw invalidDateError("date");
    }

    const { plannedKcal } = request.body as { plannedKcal: number };
    const result = dailyLogService.setPlannedCalories(date, plannedKcal);

    if (!result.ok) {
      throw result.error;
    }

    return result.value;
  });

  app.post("/api/daily-logs/:date/exercise-entries", (request) => {
    const { date } = request.params as { date: string };

    if (!isValidIsoDate(date)) {
      throw invalidDateError("date");
    }

    const input = request.body as ExerciseEntryInput;
    const result = dailyLogService.addExerciseEntry(date, input);

    if (!result.ok) {
      throw result.error;
    }

    return result.value;
  });

  app.delete("/api/daily-logs/:date/exercise-entries/:entryId", (request, reply) => {
    const { date, entryId } = request.params as { date: string; entryId: string };
    const parsedEntryId = Number(entryId);

    // API Contract（design.md）は DELETE のエラーとして 404 / 500 のみを定義し、400 を
    // 定義しない。そのため `entryId` が数値として解釈できない場合も、Serviceへ問い合わせず
    // 直ちに「見つからない」404 として扱う（数値でないIDに一致するレコードは存在しないため、
    // 挙動としても `removeExerciseEntry` に委譲した場合と等価）。
    if (!Number.isInteger(parsedEntryId)) {
      const notFound: NotFoundError = {
        type: "not_found",
        message: `Exercise entry ${entryId} not found for date ${date}`,
      };
      throw notFound;
    }

    const result = dailyLogService.removeExerciseEntry(date, parsedEntryId);

    if (!result.ok) {
      throw result.error;
    }

    reply.code(204).send();
  });
}
