/**
 * `@nutrition/web` の最小プレースホルダーロジック。
 *
 * 実際の ProfilePage / セクションコンポーネントは task 1.5 以降で追加される。
 * このファイルは web ワークスペースの Vite + TypeScript + Vitest パイプラインが
 * 機能することを証明するための最小限のプレースホルダーである。
 */
import { ping } from "@nutrition/shared";

/** `@nutrition/shared` からの値を組み込んだプレースホルダー文言を返す */
export function buildPlaceholderGreeting(): string {
  return `web:ok+${ping()}`;
}
