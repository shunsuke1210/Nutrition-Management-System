/**
 * ProfileGateway（`user-profile` の `ProfileService` への狭いアクセスポート）。
 *
 * design.md（`.kiro/specs/menu-generation/design.md` #ProfileGateway セクション、
 * Requirements 2, 12.1）に定義された通り、`user-profile` の `ProfileService.getProfile()` を
 * プロセス内で呼び出し（HTTP経由の自己呼び出しは行わない）、本specが必要とする8フィールドのみを
 * 含む `MenuProfileSnapshot` に射影する薄いアダプタである。
 *
 * - プロフィールが未登録の場合（`ProfileService.getProfile()` が `null` を返す場合）は
 *   `null` をそのまま返す（12.1）。`null` を `GenerationError(profile_missing)` へ変換する
 *   判定自体は本Gatewayの責務ではなく `MenuPlanService`（後続task）の責務である。
 * - 登録済みの場合は `Profile`（`user-profile` の全フィールドを持つ、より広い型）から
 *   `MenuProfileSnapshot` の8フィールドのみを、値の変換・リネームを一切行わずに picking する。
 * - `user-profile` の内部実装（`ProfileRepository` 等）には依存せず、公開された
 *   `ProfileService` インターフェースのみに依存する（`nutrition-engine` の `ProfileGateway` と
 *   同じ方針、`server/src/nutrition/profile.gateway.ts` 参照）。
 */
import type { RestrictionIntensity, RestrictionType } from "@nutrition/shared";
import type { ProfileService } from "../profile/profile.service.js";

/**
 * `MenuPromptBuilder`（task 6.3で実装予定）が必要とする、`user-profile` の `Profile` の
 * 厳密な部分集合（design.md #ProfileGateway Service Interface / #MenuPromptBuilder Service
 * Interface 双方に定義された `MenuProfileSnapshot`）。
 *
 * フィールド名・型は `user-profile` の `Profile` インターフェースと完全に一致させ、
 * 変換・リネームを行わない。`Profile` が持つ本spec非依存のフィールド（`heightCm` /
 * `weightKg` / `age` / `gender` / `bodyFatPct` / `medicalNotes` / `pregnancyStatus` /
 * `sleepHours` / `alcoholHabit` / `smokingHabit` / `jobActivityLevel` / `commuteMethod` /
 * `averageDailySteps` / `exerciseRoutine` / `dietModeEnabled` / `goalWeightKg` /
 * `goalPeriodWeeks` / `createdAt` / `updatedAt`）は含まない。
 */
export interface MenuProfileSnapshot {
  ngIngredients: string[];
  preferredIngredients: string[];
  restrictionType: RestrictionType;
  restrictionIntensity: RestrictionIntensity | null;
  restrictionNotes: string | null;
  cookingSkill: string | null;
  cookingTimePreference: string | null;
  budgetPreference: string | null;
}

/** design.md #ProfileGateway Service Interface。 */
export interface ProfileGateway {
  getCurrentProfile(): MenuProfileSnapshot | null;
}

/**
 * `profileService`（`user-profile` が構築・注入する `ProfileService` インスタンス）に依存する
 * `ProfileGateway` を生成する。
 *
 * `nutrition-engine` の `createProfileGateway` と同じファクトリ関数パターンに揃えている。
 * 本Gatewayは `ProfileService` の構築（＝`ProfileRepository`/DBコネクションの配線）を一切行わない。
 * それは呼び出し側（`MenuPlanService` 等を組み立てる起動処理、最終的には `server/src/index.ts`）の
 * 責務であり、本Gatewayは構築済みの `ProfileService` を受け取るだけの狭いポートである。
 */
export function createProfileGateway(profileService: ProfileService): ProfileGateway {
  function getCurrentProfile(): MenuProfileSnapshot | null {
    const profile = profileService.getProfile();
    if (profile === null) {
      return null;
    }

    return {
      ngIngredients: profile.ngIngredients,
      preferredIngredients: profile.preferredIngredients,
      restrictionType: profile.restrictionType,
      restrictionIntensity: profile.restrictionIntensity,
      restrictionNotes: profile.restrictionNotes,
      cookingSkill: profile.cookingSkill,
      cookingTimePreference: profile.cookingTimePreference,
      budgetPreference: profile.budgetPreference,
    };
  }

  return { getCurrentProfile };
}
