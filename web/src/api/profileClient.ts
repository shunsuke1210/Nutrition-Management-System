import type { Profile, ProfileInput } from "@nutrition/shared";
import { apiRequest } from "./httpClient.js";
import type { ApiError, Result } from "./types.js";

const PROFILE_ENDPOINT = "/api/profile";

/**
 * `GET /api/profile` の型付きクライアント（design.md: API Contract）。
 * プロフィールが未登録の場合はサーバーが `null` を返す。
 */
export function getProfile(): Promise<Result<Profile | null, ApiError>> {
  return apiRequest<Profile | null>(PROFILE_ENDPOINT, { method: "GET" });
}

/**
 * `PUT /api/profile` の型付きクライアント（design.md: API Contract）。
 * 検証済みの `ProfileInput` を送信し、保存後の `Profile` を受け取る。
 */
export function saveProfile(input: ProfileInput): Promise<Result<Profile, ApiError>> {
  return apiRequest<Profile>(PROFILE_ENDPOINT, { method: "PUT", body: input });
}
