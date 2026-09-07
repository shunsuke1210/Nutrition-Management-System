/**
 * 食事制限設定のchip表示（食事制限タイプ・強度・自由記述）。
 *
 * mockup.html の `.restriction-chip` セクション（1週間のおすすめ献立の直前に配置される
 * chip、design.md: File Structure Plan `components/dashboard/RestrictionChip.tsx`、
 * Components table: 「食事制限タイプ・強度・自由記述のchip表示」）のマークアップ構造に
 * 対応する。
 *
 * 責務境界（design.md Components table / Requirements Traceability 3.1-3.3）:
 * `profileClient.getProfile()` の呼び出しと結果の受け渡しは `DashboardPage`（task 7.1）が
 * 担う。本コンポーネントは既に解決済みの `Profile` の食事制限3フィールドを props で
 * 受け取り描画するだけの、状態を持たない純粋なプレゼンテーションコンポーネントである
 * （`ProfileStrip.tsx` と同じ方針）。「1週間のおすすめ献立の直前に配置する」という
 * レイアウト条件（Requirement 3.1）は、本コンポーネントを配置する親
 * （`WeeklyMenuSection`/`DashboardPage`、task 4.1/7.1）の責務であり、本コンポーネント
 * 自体が構造的に強制するものではない。
 *
 * Requirements: 3.1（食事制限タイプ・強度の表示）, 3.2（自由記述の併記）,
 * 3.3（「制限なし」の場合に制限が設定されていないことが分かる表示）
 */
import type { RestrictionIntensity, RestrictionType } from "@nutrition/shared";

export interface RestrictionChipProps {
  restrictionType: RestrictionType;
  restrictionIntensity: RestrictionIntensity | null;
  restrictionNotes: string | null;
}

// `DietRestrictionSection.tsx` の RESTRICTION_TYPE_LABELS / RESTRICTION_INTENSITY_LABELS
// と同じ日本語表記（`@nutrition/shared` に共有ラベルマップが存在しないため、同一内容を
// このファイルにも複製する。`ProfileStrip.tsx` の GENDER_LABELS 複製と同じ前例）。
const RESTRICTION_TYPE_LABELS: Record<RestrictionType, string> = {
  none: "制限なし",
  low_carb: "糖質制限",
  low_fat: "脂質制限",
  high_protein: "高たんぱく",
  calorie_only: "カロリー制限のみ",
};

const RESTRICTION_INTENSITY_LABELS: Record<RestrictionIntensity, string> = {
  light: "ゆるやか",
  standard: "標準",
  strict: "しっかり",
};

export function RestrictionChip({ restrictionType, restrictionIntensity, restrictionNotes }: RestrictionChipProps) {
  const typeLabel = RESTRICTION_TYPE_LABELS[restrictionType];

  // Requirement 3.3: タイプが「制限なし」の場合（DietRestrictionSection.tsx の
  // validateDietRestriction が定める前提により、この場合 restrictionIntensity は通常
  // null）、強度側を結合せず「制限なし」単独で表示する。タイプが「制限なし」以外でも
  // 強度が未設定（null）の場合は、同様に壊れた「・」の連結を避けるためタイプ単独で表示する。
  const summary =
    restrictionType !== "none" && restrictionIntensity !== null
      ? `${typeLabel}・${RESTRICTION_INTENSITY_LABELS[restrictionIntensity]}`
      : typeLabel;

  const hasNotes = restrictionNotes !== null && restrictionNotes !== "";

  return (
    <div className="restriction-chip">
      <span>
        現在の食事制限設定：<b>{summary}</b>
      </span>
      {hasNotes && <span className="note">その他: 「{restrictionNotes}」</span>}
    </div>
  );
}
