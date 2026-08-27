/**
 * NG食材・好み食材のchip追加/削除を行う共通UI。
 *
 * mockup.html の「食の好み・NG食材」セクション内、各リストの `.chip-row`
 * （`.chip-removable` の一覧 + `.chip-add` ボタン）に対応する
 * （design.md: File Structure Plan `components/profile/IngredientChipList.tsx`）。
 * NG食材一覧・好み食材一覧の両方から同一コンポーネントとして再利用される
 * （タスク4.3: 「両リストで共通コンポーネントを再利用」。呼び出し側は `FoodPreferenceSection.tsx`）。
 *
 * `string[]` というフラットな一覧を管理するだけであり、`ExerciseRoutineTable`
 * のような行単位のZod検証は行わない。`shared/src/profile.schema.ts` の
 * `ngIngredients`/`preferredIngredients` は `z.array(z.string())` で、文字列単体への
 * レンジ制約（`.min(1)`等）が存在しないため、再利用できる検証ルールがない。
 * 空文字列の追加を防ぐことのみ、UIレベルのガードとして行う（ビジネスルールの
 * 重複ではない。`handleAdd` 内コメント参照）。
 *
 * Requirements: 3.1（NG食材一覧の保持）, 3.2（好み食材一覧の保持）,
 * 3.3（食材名の追加）, 3.4（登録済み食材の削除）, 3.5（0件でも保存を許可）
 */
import { useId, useState, type ChangeEvent, type KeyboardEvent } from "react";

export interface IngredientChipListProps {
  /** グループの見出し・アクセシブルネーム（例:「NG食材・苦手な食材」）。呼び出し側ごとに異なる値を渡す。 */
  label: string;
  value: readonly string[];
  onChange: (value: string[]) => void;
}

export function IngredientChipList({ label, value, onChange }: IngredientChipListProps) {
  const [draft, setDraft] = useState("");
  const groupLabelId = useId();

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      // UIレベルのガード: 空文字列のchipを追加しない。`shared` 側に文字列単体への
      // レンジ制約（例: `.min(1)`）が存在しないため、これはビジネスルールの
      // 重複実装ではない（Requirement 3.3 は「食材名を追加した場合」が前提であり、
      // 空文字列の追加自体は要件が想定していない入力である）。
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="field wide">
      <span id={groupLabelId}>{label}</span>
      <div className="chip-row" role="group" aria-labelledby={groupLabelId}>
        {value.map((ingredient, index) => (
          <span className="chip-removable" key={`${ingredient}-${index}`}>
            {ingredient}
            <button
              type="button"
              className="x"
              aria-label={`${ingredient}を削除`}
              onClick={() => handleRemove(index)}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          aria-label={`${label}に追加する食材名`}
          placeholder="食材名を入力"
          value={draft}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <button type="button" className="chip-add" onClick={handleAdd}>
          ＋ 追加
        </button>
      </div>
    </div>
  );
}
