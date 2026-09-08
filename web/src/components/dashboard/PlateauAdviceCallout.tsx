/**
 * 減量停滞期アドバイスの表示。
 *
 * mockup.html の `.status-callout.warning`（行960-972、「停滞期アドバイス」ブロック）の
 * マークアップ構造に対応する（design.md: File Structure Plan
 * `components/dashboard/PlateauAdviceCallout.tsx`）。
 *
 * mockup.html 行969の`.s-body`（「目標カロリーを1日あたり50kcal引き下げるか、
 * 有酸素運動を週10分追加することで、停滞を打開できる可能性があります。まずは1週間、
 * 様子を見ることもおすすめです。」）は、mockup自体を読む人間向けの具体例であり、
 * 実データとして再現すべき固定文言ではないため、本コンポーネントはこの文言を採用せず、
 * `plateau.message`（nutrition-engineが既に生成済みのメッセージ）をそのまま表示する
 * （`GuardrailWarningCallout.tsx`が`warning.message`を素通しする前例と同じ方針）。
 * 一方、`.s-title`（「この2週間、体重の減少が停滞しています」）は特定のデータ由来ではない
 * 汎用的な固定文言であるため、静的なタイトルとして採用する。
 *
 * 責務境界: 本コンポーネントは `plateau`（`DietInsights.plateau`）を props で受け取り
 * 描画するだけの、状態を持たない純粋なプレゼンテーションコンポーネントである。
 * `"plateaued"` の場合のみ表示し、`"on_track"` / `"insufficient_data"` /
 * `"not_applicable"` のいずれの場合も何も表示しない（3者を区別する必要はなく、
 * いずれも「表示しない」という同一の結果になるため、単一の早期returnでまとめて扱う）。
 *
 * Requirements: 14.1（減量の停滞を判定した場合、停滞している旨と助言メッセージを表示する）,
 * 14.2（on_trackの場合、停滞期アドバイスを表示しない）,
 * 14.3（体重記録の不足、または目標が減量方向でないことにより判定を行わない場合、
 * 停滞期アドバイスを表示しない）
 */
import type { PlateauStatus } from "@nutrition/shared";

export interface PlateauAdviceCalloutProps {
  plateau: PlateauStatus;
}

const PLATEAU_TITLE = "この2週間、体重の減少が停滞しています";

export function PlateauAdviceCallout({ plateau }: PlateauAdviceCalloutProps) {
  if (plateau.status !== "plateaued") {
    return null;
  }

  return (
    <div className="status-callout warning">
      <span className="s-icon">💬</span>
      <div>
        <div className="s-title">{PLATEAU_TITLE}</div>
        <div className="s-body">{plateau.message}</div>
      </div>
    </div>
  );
}
