/**
 * ルートページシェル（プレースホルダー）。
 *
 * 実際の ProfilePage への差し替えは task 1.5 で行う。
 * 現時点では Vite + React + TypeScript のビルド/開発パイプラインが疎通する
 * ことを示す最小限のプレースホルダーとして機能する。
 */
import { SHARED_PACKAGE_NAME } from "@nutrition/shared";

export function App() {
  return (
    <div>
      <p>栄養管理システム (scaffold placeholder)</p>
      <p>{SHARED_PACKAGE_NAME}</p>
    </div>
  );
}
