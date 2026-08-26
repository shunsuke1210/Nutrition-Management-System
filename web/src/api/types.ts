/**
 * APIクライアント共通のエラー型・Result型。
 *
 * design.md の「Error Handling / Error Envelope」（`server/src/shared/result.ts` が
 * サーバー側で実装する `Result<T,E>` / `ValidationError` / `NotFoundError`）と同じ
 * JSONフィールド名（`type` / `fieldErrors` / `message`）の規約に従う。
 *
 * この時点（task 1.5, web app bootstrap）では `@nutrition/shared` はこれらの型を
 * 公開していない（1.2 のスコープでは Zod スキーマ由来のドメイン型のみが公開対象）。
 * 本タスクの境界は web app bootstrap のみであり `shared` パッケージを変更できないため、
 * サーバーの契約をコピーする形で web 側のローカル型として定義する。将来 `shared` が
 * これらの共通エラー型を公開するようになった場合、このファイルは re-export に
 * 置き換えられる想定（実装者判断: CONCERNS 参照）。
 */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface ValidationError {
  type: "validation";
  fieldErrors: Record<string, string[]>;
}

export interface NotFoundError {
  type: "not_found";
  message: string;
}

/**
 * サーバーの `type: "internal"` エラー、ネットワーク断、レスポンス解析失敗など、
 * `validation` / `not_found` として判別できないすべての失敗を束ねる、
 * クライアント側のみのフォールバックエラー種別。
 */
export interface UnknownError {
  type: "unknown";
  message: string;
}

export type ApiError = ValidationError | NotFoundError | UnknownError;
