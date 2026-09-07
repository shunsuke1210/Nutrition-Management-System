/**
 * 「栄養評価」/「ダイエット状況」の表示モード切替コントロール。
 *
 * mockup.html の `.segmented` セクション（`role="tablist" aria-label="表示モード"`、
 * ラベル「栄養評価」「ダイエット状況」）のマークアップ構造に対応する（design.md:
 * File Structure Plan `components/dashboard/ModeToggle.tsx`、Components table:
 * 「通常/ダイエット表示モードの切替コントロール」）。
 *
 * 責務境界（design.md Components table）: 表示モードの状態管理・対応するセクション群の
 * 実際の出し分けは `DashboardPage`（task 7.1）が担う。本コンポーネントは現在のモード値・
 * 変更通知コールバック・ダイエットモード利用可否のみを受け取る、状態を持たない純粋な
 * プレゼンテーションコンポーネントであり、栄養評価/ダイエット状況の実セクションを
 * 自身でインポート・描画しない。
 *
 * Requirements: 2.1（切替操作の提供）, 2.2/2.3（切替に応じた表示の出し分け。実際の出し分けは
 * DashboardPage側の責務だが、本コンポーネントはその切替を駆動するコールバックを提供する）,
 * 2.6（ダイエットモードが無効なプロフィールの場合、ダイエット状況画面への切替操作を
 * 利用不可にし、あわせて案内表示を行う）
 */
export type DashboardMode = "normal" | "diet";

export interface ModeToggleProps {
  mode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
  /** Requirement 2.6: user-profileのダイエットモードが無効な場合はfalseを渡す。 */
  dietModeEnabled: boolean;
}

const NORMAL_MODE_LABEL = "栄養評価";
const DIET_MODE_LABEL = "ダイエット状況";
const DIET_MODE_GUIDANCE = "ダイエットモードを有効にすると利用できます";

export function ModeToggle({ mode, onModeChange, dietModeEnabled }: ModeToggleProps) {
  return (
    <div className="segmented" role="tablist" aria-label="表示モード">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "normal"}
        className={mode === "normal" ? "active" : undefined}
        onClick={() => onModeChange("normal")}
      >
        {NORMAL_MODE_LABEL}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "diet"}
        aria-disabled={!dietModeEnabled}
        disabled={!dietModeEnabled}
        className={mode === "diet" ? "active" : undefined}
        title={dietModeEnabled ? undefined : DIET_MODE_GUIDANCE}
        onClick={() => {
          // Requirement 2.6: ダイエットモードが無効な場合、ネイティブのdisabled属性で
          // クリックイベント自体がReactに届かないが、意図を明示するため二重にガードする。
          if (!dietModeEnabled) {
            return;
          }
          onModeChange("diet");
        }}
      >
        {DIET_MODE_LABEL}
      </button>
      {!dietModeEnabled && (
        <span className="mode-toggle-guidance" role="note">
          {DIET_MODE_GUIDANCE}
        </span>
      )}
    </div>
  );
}
