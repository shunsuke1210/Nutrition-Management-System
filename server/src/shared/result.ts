/**
 * Service層の処理結果を表現する判別共用体。
 *
 * design.md の「Error Handling / Error Envelope」で定義された形状の通り、
 * Service層は例外を投げる代わりにこの型を返す。Controller層はこれを
 * 見て成功時のレスポンスを組み立てるか、`error` を投げて共通エラーハンドラ
 * （`app.ts` の `setErrorHandler`）にHTTPレスポンスへの変換を委ねる。
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/**
 * 入力検証エラー（必須項目欠落・レンジ逸脱・条件付き必須違反など）。
 * 共通エラーハンドラによりHTTP 400（フィールド別エラーを含む）へ変換される。
 */
export interface ValidationError {
  type: "validation";
  fieldErrors: Record<string, string[]>;
}

/**
 * 指定された識別子のリソースが存在しないエラー。
 * 共通エラーハンドラによりHTTP 404へ変換される。
 */
export interface NotFoundError {
  type: "not_found";
  message: string;
}
