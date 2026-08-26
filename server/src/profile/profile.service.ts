import { ProfileInputSchema, type Profile, type ProfileInput } from "@nutrition/shared";
import type { Result, ValidationError } from "../shared/result.js";
import type { ProfileRepository } from "./profile.repository.js";

/**
 * プロフィール集約の検証と業務ルールを持つサービス
 * （design.md: Domain: Profile > ProfileService > Service Interface）。
 */
export interface ProfileService {
  getProfile(): Profile | null;
  saveProfile(input: ProfileInput): Result<Profile, ValidationError>;
}

/**
 * Zod の `issues` が持つ最小限の形状。`zod` パッケージの型を直接 import せずに
 * 構造的型付けで受け取ることで、`server` パッケージに `zod` への直接依存を追加しない
 * （`zod` は `shared` パッケージが公開する `ProfileInputSchema` を通じてのみ利用する）。
 */
interface ZodIssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * Zod の検証エラーを design.md の `ValidationError.fieldErrors`
 * （`Record<string, string[]>`）形状へ変換する。
 *
 * `ZodError.flatten().fieldErrors` はパスの先頭セグメントのみでグルーピングするため、
 * `exerciseRoutine` のような配列項目のエラー（例: 2行目の `frequencyPerWeek`）が
 * すべて `exerciseRoutine` という1つのキーに丸められ、どの行のどの項目かが失われる。
 * そのため各 issue の `path` をそのまま `.` 区切りに連結したキー
 * （例: `exerciseRoutine.1.frequencyPerWeek`）で個別に集約し、行単位で
 * どのフィールドが違反したかを利用者・呼び出し元が判別できるようにする。
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

/**
 * `profileRepository` に依存する `ProfileService` を生成する。
 *
 * `saveProfile` の検証ルール（必須項目欠落、拡張項目のレンジ検証、食事制限強度・
 * ダイエットモード目標の条件付き必須）は `shared` パッケージの `ProfileInputSchema`
 * （Zod, `.superRefine` を含む）にすべて表現されている（`shared/src/profile.schema.ts`
 * 参照）。本Serviceはその検証結果を `ValidationError` へ変換し、成功時のみ
 * `ProfileRepository.upsert` を呼び出すことで、Preconditions（design.md:
 * 「`input` は `ProfileInputSchema` を満たす」）を満たした状態でのみ永続化を行う。
 */
export function createProfileService(profileRepository: ProfileRepository): ProfileService {
  function getProfile(): Profile | null {
    return profileRepository.findCurrent();
  }

  function saveProfile(input: ProfileInput): Result<Profile, ValidationError> {
    const parsed = ProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: toValidationError(parsed.error.issues) };
    }

    const profile = profileRepository.upsert(parsed.data);
    return { ok: true, value: profile };
  }

  return { getProfile, saveProfile };
}
