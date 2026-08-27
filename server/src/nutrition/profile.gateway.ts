/**
 * ProfileGateway（`user-profile` の `ProfileService` への狭いアクセスポート）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `ProfileGateway` セクション
 * （Requirements 1.3, 2.4, 12.1, 12.2）に定義された通り、`user-profile` の
 * `ProfileService.getProfile()` をプロセス内で呼び出し（HTTP経由の自己呼び出しは行わない）、
 * 本specが必要とする16フィールドのみを含む `ProfileSnapshot` に射影する薄いアダプタである。
 *
 * - プロフィールが未登録の場合（`ProfileService.getProfile()` が `null` を返す場合）は
 *   `null` をそのまま返す（12.1）。
 * - 登録済みの場合は `Profile`（`user-profile` の全フィールドを持つ、より広い型）から
 *   `ProfileSnapshot` の16フィールドのみを、値の変換・リネームを一切行わずに picking する。
 *   `heightCm`/`weightKg`/`age`（BMR算出に必要, 2.4）と `jobActivityLevel`/`commuteMethod`
 *   （活動係数算出に必要, 1.3）が欠落した場合の「算出不可」判定は、本Gatewayの責務ではなく
 *   `NutritionService`（task 3）の責務である。本Gatewayはフィールドをそのまま通過させるのみ。
 * - `user-profile` の内部実装（`ProfileRepository` 等）には依存せず、公開された
 *   `ProfileService` インターフェースのみに依存する。
 */
import type {
  AlcoholHabit,
  CommuteMethod,
  ExerciseRoutineEntryInput,
  Gender,
  JobActivityLevel,
  RestrictionIntensity,
  RestrictionType,
  SmokingHabit,
} from "@nutrition/shared";
import type { ProfileService } from "../profile/profile.service.js";

/**
 * `NutritionService`（および本spec内の各計算モジュール）が必要とする、`user-profile` の
 * `Profile` の厳密な部分集合（design.md #ProfileGateway Service Interface: `ProfileSnapshot`）。
 *
 * フィールド名・型は `user-profile` の `Profile` インターフェースと完全に一致させ、
 * 変換・リネームを行わない。`Profile` が持つ本spec非依存のフィールド（`medicalNotes` /
 * `pregnancyStatus` / `sleepHours` / `cookingSkill` / `cookingTimePreference` /
 * `budgetPreference` / `ngIngredients` / `preferredIngredients` / `restrictionNotes` /
 * `createdAt` / `updatedAt`）は含まない。
 */
export interface ProfileSnapshot {
  heightCm: number;
  weightKg: number;
  age: number;
  gender: Gender;
  bodyFatPct: number | null;
  jobActivityLevel: JobActivityLevel;
  commuteMethod: CommuteMethod;
  averageDailySteps: number | null;
  exerciseRoutine: ExerciseRoutineEntryInput[];
  smokingHabit: SmokingHabit | null;
  alcoholHabit: AlcoholHabit | null;
  restrictionType: RestrictionType;
  restrictionIntensity: RestrictionIntensity | null;
  dietModeEnabled: boolean;
  goalWeightKg: number | null;
  goalPeriodWeeks: number | null;
}

/** design.md #ProfileGateway Service Interface。 */
export interface ProfileGateway {
  getCurrentProfile(): ProfileSnapshot | null;
}

/**
 * `profileService`（`user-profile` が構築・注入する `ProfileService` インスタンス）に依存する
 * `ProfileGateway` を生成する。
 *
 * `user-profile` 自身の `createProfileService(profileRepository)` と同じファクトリ関数パターンに
 * 揃えている。本Gatewayは `ProfileService` の構築（＝`ProfileRepository`/DBコネクションの配線）を
 * 一切行わない。それは呼び出し側（`NutritionService` を組み立てる task 3、最終的には
 * `server/src/index.ts` の起動処理）の責務であり、本Gatewayは構築済みの `ProfileService` を
 * 受け取るだけの狭いポートである。
 */
export function createProfileGateway(profileService: ProfileService): ProfileGateway {
  function getCurrentProfile(): ProfileSnapshot | null {
    const profile = profileService.getProfile();
    if (profile === null) {
      return null;
    }

    return {
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      age: profile.age,
      gender: profile.gender,
      bodyFatPct: profile.bodyFatPct,
      jobActivityLevel: profile.jobActivityLevel,
      commuteMethod: profile.commuteMethod,
      averageDailySteps: profile.averageDailySteps,
      exerciseRoutine: profile.exerciseRoutine,
      smokingHabit: profile.smokingHabit,
      alcoholHabit: profile.alcoholHabit,
      restrictionType: profile.restrictionType,
      restrictionIntensity: profile.restrictionIntensity,
      dietModeEnabled: profile.dietModeEnabled,
      goalWeightKg: profile.goalWeightKg,
      goalPeriodWeeks: profile.goalPeriodWeeks,
    };
  }

  return { getCurrentProfile };
}
