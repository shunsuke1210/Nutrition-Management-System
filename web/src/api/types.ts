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
 *
 * ただし `CalculationUnavailableError`（task 2.1, `nutritionClient` 境界）は
 * `shared/src/nutrition.schema.ts` が既に Zod スキーマ由来のドメイン型として公開済みのため、
 * `ValidationError` / `NotFoundError` と異なりローカルに再定義せず `@nutrition/shared` から
 * そのまま import する。
 *
 * `GenerationError`（task 2.2, `menuPlanClient` 境界。`server/src/menu-generation/
 * menu-plan.service.ts` が定義する、週/日単位の献立(再)生成失敗を表す型）は
 * `CalculationUnavailableError` とは異なり `@nutrition/shared` から公開されていない
 * （`shared/src/menu.schema.ts` にこの型は存在しない。サーバーのみが持つローカル型であり、
 * web は server から直接importできない）。したがってこちらは `ValidationError` /
 * `NotFoundError` と同じ precedent（サーバーの契約をコピーする形でローカルに再定義する）に
 * 従う。
 */

import type { CalculationUnavailableError } from "@nutrition/shared";

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
 * 献立の週/日単位(再)生成の失敗理由（`server/src/menu-generation/menu-plan.service.ts` の
 * `GenerationFailureReason` と同じ8値のローカル複製。上記ファイル冒頭コメント参照）。
 */
export type GenerationFailureReason =
  | "profile_missing"
  | "nutrition_unavailable"
  | "schema_validation_failed"
  | "food_id_not_found"
  | "unit_not_found"
  | "claude_refusal"
  | "claude_request_failed"
  | "generation_in_progress";

/**
 * 献立の週/日単位(再)生成の失敗（`server/src/menu-generation/menu-plan.service.ts` の
 * `GenerationError` と同じ形状のローカル複製。上記ファイル冒頭コメント参照）。
 */
export interface GenerationError {
  type: "generation_failed";
  reason: GenerationFailureReason;
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

export type ApiError =
  | ValidationError
  | NotFoundError
  | UnknownError
  | CalculationUnavailableError
  | GenerationError;
