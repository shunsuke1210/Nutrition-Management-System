/**
 * プロフィール概要のchip表示（身長・体重・年齢・性別・活動レベル表示ラベル・ダイエット目標）。
 *
 * mockup.html の `.profile-strip` セクション（`.chip` spanの並び、ダイエット目標のみ
 * `.chip.goal` の追加クラス）のマークアップ構造に対応する（design.md: File Structure Plan
 * `components/dashboard/ProfileStrip.tsx`、Components table: 「身長・体重・年齢・性別・
 * 活動レベル表示ラベル・ダイエット目標のchip表示」）。
 *
 * 責務境界（design.md Components table / Requirements Traceability 2.1-2.6）:
 * `profileClient.getProfile()` / `nutritionClient.getSummary()` の呼び出しと結果の
 * 受け渡しは `DashboardPage`（task 7.1）が担う。本コンポーネントは既に解決済みの
 * `Profile` と `activityLevelLabel` を props で受け取り描画するだけの、状態を持たない
 * 純粋なプレゼンテーションコンポーネントである（ローディング/エラー状態を自身では
 * 扱わない）。
 *
 * Requirements: 2.4（表示モードによらず身長・体重・年齢・性別・活動レベル表示ラベルを
 * 常時表示する）, 2.5（ダイエットモード有効時は目標体重・目標達成期間を含める）,
 * 2.6（ダイエットモード無効時は目標体重・目標達成期間を含めない）
 */
import type { Gender, Profile } from "@nutrition/shared";

export interface ProfileStripProps {
  profile: Profile;
  /** `nutrition-engine` の `NutritionSummary.activityLevelLabel`（design.md参照）。 */
  activityLevelLabel: string;
}

// `BasicInfoSection.tsx` の GENDER_LABELS と同じ日本語表記（`@nutrition/shared` に
// 共有ラベルマップが存在しないため、同一内容をこのファイルにも複製する）。
const GENDER_LABELS: Record<Gender, string> = {
  female: "女性",
  male: "男性",
  undisclosed: "回答しない",
};

export function ProfileStrip({ profile, activityLevelLabel }: ProfileStripProps) {
  return (
    <div className="profile-strip">
      <span className="chip">
        身長 <b>{profile.heightCm}cm</b>
      </span>
      <span className="chip">
        体重 <b>{profile.weightKg}kg</b>
      </span>
      <span className="chip">
        年齢 <b>{profile.age}歳</b>
      </span>
      <span className="chip">
        性別 <b>{GENDER_LABELS[profile.gender]}</b>
      </span>
      <span className="chip">
        活動レベル（推定） <b>{activityLevelLabel}</b>
      </span>
      {profile.dietModeEnabled && (
        <span className="chip goal">
          目標体重 <b>{profile.goalWeightKg}kg</b> ・ 目標期間 <b>{profile.goalPeriodWeeks}週</b>
        </span>
      )}
    </div>
  );
}
