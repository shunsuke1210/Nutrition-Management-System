import type { CalculationUnavailableReason } from "@nutrition/shared";
import type { ApiError, Result } from "./types.js";

export type HttpMethod = "GET" | "PUT" | "POST" | "DELETE";

export interface ApiRequestOptions {
  method?: HttpMethod;
  body?: unknown;
}

function isValidationErrorPayload(
  payload: unknown,
): payload is { type: "validation"; fieldErrors: Record<string, string[]> } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "validation" &&
    typeof (payload as { fieldErrors?: unknown }).fieldErrors === "object" &&
    (payload as { fieldErrors?: unknown }).fieldErrors !== null
  );
}

function isNotFoundErrorPayload(payload: unknown): payload is { type: "not_found"; message: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "not_found" &&
    typeof (payload as { message?: unknown }).message === "string"
  );
}

function isCalculationUnavailableErrorPayload(
  payload: unknown,
): payload is { type: "calculation_unavailable"; reason: CalculationUnavailableReason; message: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "calculation_unavailable" &&
    typeof (payload as { reason?: unknown }).reason === "string" &&
    typeof (payload as { message?: unknown }).message === "string"
  );
}

function toApiError(payload: unknown, status: number): ApiError {
  if (isValidationErrorPayload(payload)) {
    return { type: "validation", fieldErrors: payload.fieldErrors };
  }
  if (isNotFoundErrorPayload(payload)) {
    return { type: "not_found", message: payload.message };
  }
  if (isCalculationUnavailableErrorPayload(payload)) {
    return { type: "calculation_unavailable", reason: payload.reason, message: payload.message };
  }
  const message =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { message?: unknown }).message === "string"
      ? (payload as { message: string }).message
      : `リクエストが失敗しました (status: ${status})`;
  return { type: "unknown", message };
}

function toNetworkError(cause: unknown): ApiError {
  const message = cause instanceof Error ? cause.message : "ネットワークエラーが発生しました。";
  return { type: "unknown", message };
}

/**
 * `@nutrition/shared` の型でジェネリクス化された共通fetchラッパー。
 *
 * 例外を投げず `Result<T, ApiError>` の判別共用体として成功/失敗を返す
 * （design.md: Error Envelope に準拠。呼び出し側は `result.ok` でパターンマッチできる）。
 * サーバーのエラーレスポンス（`type: "validation" | "not_found" | "internal" |
 * "calculation_unavailable"`）のうち `validation` / `not_found` / `calculation_unavailable`
 * はそのまま判別し（task 2.1, `nutritionClient` 境界: `calculation_unavailable` は
 * `reason` フィールドを含めて保持し、`unknown` へ丸め込まない）、それ以外（`internal` や
 * 解析不能なレスポンス、ネットワーク断）は `unknown` に正規化する。
 */
export async function apiRequest<T>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<Result<T, ApiError>> {
  const { method = "GET", body } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    return { ok: false, error: toNetworkError(cause) };
  }

  if (response.status === 204) {
    return { ok: true, value: undefined as T };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    if (response.ok) {
      return { ok: false, error: toNetworkError(cause) };
    }
    return {
      ok: false,
      error: { type: "unknown", message: `リクエストが失敗しました (status: ${response.status})` },
    };
  }

  if (response.ok) {
    return { ok: true, value: payload as T };
  }

  return { ok: false, error: toApiError(payload, response.status) };
}
