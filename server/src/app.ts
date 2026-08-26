import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { NotFoundError, ValidationError } from "./shared/result.js";

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
 * - この時点ではプロフィール/日次ログのルートはまだ存在しない（task 2.3, 3.3）ため、
 *   ここではルートを登録しない。呼び出し側（`index.ts`、および将来のルートモジュール）は
 *   返された `FastifyInstance` に対して Fastify 標準の `app.register()` / `app.get()` 等を
 *   呼び出すことでルートを追加登録できる。これが「ルートモジュール登録用のプラグイン構成」である。
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
