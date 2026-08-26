/**
 * アプリのルートページシェル。
 *
 * design.md（Domain: UI (Presentation)）はモックアップに対応する単一ページアプリを
 * 想定しており、ルーティングライブラリは導入しない。`ProfilePage` をルートビューとして
 * 描画する。
 */
import { ProfilePage } from "./pages/ProfilePage.js";

export function App() {
  return <ProfilePage />;
}
