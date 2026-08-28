import type { FastifyInstance } from "fastify";
import { NutritionDateQuerySchema } from "@nutrition/shared";
import type { ValidationError } from "../shared/result.js";
import type { NutritionService } from "./nutrition.service.js";

/**
 * `/api/nutrition/summary` のHTTPハンドリングを担う NutritionController
 * （design.md: Components and Interfaces > NutritionController、
 * Domain: Nutrition Calculation > NutritionController > API Contract、
 * Requirements 12.1, 12.2, 13.1, 13.2, 13.3, 13.4）。
 *
 * - ControllerはHTTPの関心事（クエリパラメータの検証・ステータスコードの決定）のみを扱い、
 *   欠損データ判定・計算のオーケストレーションは `NutritionService`（Service層）に閉じ込める
 *   （design.md: Architecture Integration > 境界順守。`profile.routes.ts` / `daily-log.routes.ts`
 *   と同じ規約）。
 * - `date` クエリパラメータは `shared/src/nutrition.schema.ts` の `NutritionDateQuerySchema`
 *   （`GET /api/nutrition/summary` と `GET /api/nutrition/diet-insights` が共有する日付クエリ
 *   スキーマ）で検証する。スキーマ自身は `date` を optional なだけで値を補完しないため、
 *   省略時（`undefined`）はこのController側で当日日付（サーバーのローカルタイムゾーンにおける
 *   暦日）を補う（design.md API Contract: 「date省略時は当日日付を使用」）。
 * - クエリ検証に失敗した場合は `ValidationError` を `throw` し、`app.ts` の共通エラー
 *   ハンドラ（`setErrorHandler`）にHTTP 400への変換を委ねる（`profile.routes.ts` /
 *   `daily-log.routes.ts` と同じ規約: 「Controllerはエラー値をthrowする」）。
 * - `NutritionService.getSummary` が `{ ok: false }`（`CalculationUnavailableError`）を返した
 *   場合は、HTTP 409で直接応答する。`server/src/app.ts` の現在の `setErrorHandler` 実装を確認
 *   したところ、`ValidationError`（→400）と `NotFoundError`（→404）のみを型判定しており、
 *   `type: "calculation_unavailable"` は一切認識しない（フォールスルーして詳細を隠した500に
 *   丸め込まれる）。本タスクの境界（`NutritionController`）は `app.ts` を変更対象に含まないため、
 *   ここでは `throw` に頼らず `reply.status(409).send(result.error)` によってこのファイル内で
 *   直接409へ変換する（`CONCERNS` 参照）。
 * - 認証・認可のチェックは一切行わない（Requirement 13.3）。
 *
 * `buildApp()`（`server/src/app.ts`）自体はまだこのルートを登録しない（task 4.2 の責務）ため、
 * 呼び出し側が明示的にこの関数を呼んで登録する必要がある（`profile.routes.ts` の task 2.3 /
 * `daily-log.routes.ts` の task 3.3 と同じ規約）。
 */

/** サーバーのローカルタイムゾーンにおける当日の日付を "YYYY-MM-DD" 形式で返す。 */
function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Zod の `issues` が持つ最小限の形状。`zod` パッケージの型を直接 import せずに
 * 構造的型付けで受け取ることで、`server` パッケージに `zod` への直接依存を追加しない
 * （`zod` は `shared` パッケージが公開する `NutritionDateQuerySchema` を通じてのみ利用する。
 * `profile.service.ts` の `ZodIssueLike` と同じ規約）。
 */
interface ZodIssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * Zod の検証エラーを `ValidationError.fieldErrors`（`Record<string, string[]>`）形状へ変換する
 * （`profile.service.ts` の `toValidationError` と同じ規約）。
 */
function toValidationError(issues: readonly ZodIssueLike[]): ValidationError {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    const messages = fieldErrors[key] ?? (fieldErrors[key] = []);
    messages.push(issue.message);
  }

  return { type: "validation", fieldErrors };
}

export function registerNutritionRoutes(
  app: FastifyInstance,
  nutritionService: NutritionService
): void {
  app.get("/api/nutrition/summary", (request, reply) => {
    const parsed = NutritionDateQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      throw toValidationError(parsed.error.issues);
    }

    const date = parsed.data.date ?? todayIsoDate();

    const result = nutritionService.getSummary(date);

    if (!result.ok) {
      reply.status(409).send(result.error);
      return;
    }

    return result.value;
  });
}
