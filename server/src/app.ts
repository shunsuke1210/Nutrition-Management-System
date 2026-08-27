import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { NotFoundError, ValidationError } from "./shared/result.js";
import { registerProfileRoutes } from "./profile/profile.routes.js";
import type { ProfileService } from "./profile/profile.service.js";
import { registerDailyLogRoutes } from "./daily-log/daily-log.routes.js";
import type { DailyLogService } from "./daily-log/daily-log.service.js";

function isValidationError(error: unknown): error is ValidationError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "validation"
  );
}

function isNotFoundError(error: unknown): error is NotFoundError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "not_found"
  );
}

/**
 * Fastifyアプリを構築するブートストラップ関数。
 *
 * - このタスク（1.4）の時点ではプロフィール/日次ログのルートはまだ存在しなかったため、
 *   `buildApp()` 自体は今もルートを一切登録しない（route-agnostic）。これは意図的な設計判断:
 *   `buildApp()` を単体でテスト可能に保つ（`app.test.ts` がルート依存を一切構築せずに
 *   共通エラーハンドラのみを検証できる）ため、task 6.1 でルート登録が可能になった後も
 *   `buildApp()` のシグネチャ・挙動は変更していない。
 * - ルート登録は本ファイルが公開する `registerRoutes()`（下記）が担う。呼び出し側
 *   （`index.ts`）は `buildApp()` で得た `FastifyInstance` に対し `registerRoutes(app, deps)`
 *   を呼び出すことでプロフィール/日次ログの両ルートを登録する。これにより
 *   `server/src/app.ts` が design.md の File Structure Plan が言う
 *   「Fastifyアプリのブートストラップ・ルート登録」の両方を担うファイルであるという位置づけを
 *   保ちつつ、`buildApp()` 自体は route-agnostic のままにしている。
 *   （もちろん Fastify標準の `app.register()` / `app.get()` 等を呼び出せばこれ以外の
 *   ルートモジュールも自由に追加登録できる。）
 * - `Result<T,E>` の `ValidationError` / `NotFoundError` をHTTPレスポンスへ変換する共通エラー
 *   ハンドラを設定する。Service層はこれらのエラー値を `Result` の `error` として返し、Controller層
 *   （task 2.3, 3.3）はそれを `throw` することでこのハンドラに変換を委ねる。
 *   - `ValidationError` → 400 + フィールド別エラー
 *   - `NotFoundError` → 404 + メッセージ
 *   - それ以外（インフラ障害等の予期しない例外）→ ログに詳細を記録した上で、詳細を漏らさない 500
 */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.setErrorHandler<ValidationError | NotFoundError | Error>((error, request, reply) => {
    if (isValidationError(error)) {
      reply.code(400).send({ type: "validation", fieldErrors: error.fieldErrors });
      return;
    }

    if (isNotFoundError(error)) {
      reply.code(404).send({ type: "not_found", message: error.message });
      return;
    }

    request.log.error(error);
    reply.code(500).send({ type: "internal", message: "Internal Server Error" });
  });

  return app;
}

/** `registerRoutes()` が必要とするService依存（task 6.1で構築され、`index.ts` から渡される）。 */
export interface AppRouteDependencies {
  profileService: ProfileService;
  dailyLogService: DailyLogService;
}

/**
 * `ProfileController`（`registerProfileRoutes`, task 2.3）と `DailyLogController`
 * （`registerDailyLogRoutes`, task 3.3）を `app` に登録する（design.md: Architecture の
 * `ProfileController`/`DailyLogController` が Fastify アプリに登録される図、および
 * File Structure Plan の `app.ts` = 「Fastifyアプリのブートストラップ・ルート登録」）。
 *
 * 両ルートモジュールはすでに `buildApp()` の共通エラーハンドラ（`ValidationError` → 400,
 * `NotFoundError` → 404）を前提に実装されている（`profile.routes.ts` / `daily-log.routes.ts`
 * のコメント参照）ため、本関数は `buildApp()` で構築済みのアプリに対して呼び出すことを想定する。
 * `profile/**` / `daily-log/**` の内部実装には一切触れず、それぞれの `register*Routes` を
 * 呼び出すだけの薄い配線層である。
 */
export function registerRoutes(app: FastifyInstance, deps: AppRouteDependencies): void {
  registerProfileRoutes(app, deps.profileService);
  registerDailyLogRoutes(app, deps.dailyLogService);
}
