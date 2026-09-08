/**
 * アプリのルートページシェル。
 *
 * design.md（Domain: UI (Presentation)）はモックアップに対応する単一ページアプリを
 * 想定しており、ルーティングライブラリは導入しない。
 *
 * task 6.1 のスコープ拡張として、`ProfilePage`（メインカラム）と `DailyLogPanel`
 * （サイドバー、「今日の記録」）を同一画面に組み立てる。mockup.html の `.layout`
 * （`.main-col` + `.side-col` の2カラムグリッド）にレイアウト構造を合わせている。
 *
 * この配線は tasks.md のどのタスクにも個別に割り当てられていなかった
 * （`.kiro/specs/user-profile/tasks.md` の Implementation Notes (5.3) 参照:
 * 「`DailyLogPanel` is not yet mounted anywhere in the app」「no task in this file
 * currently assigns that wiring」）。しかし task 6.2 の観測可能な完了条件
 * 「同一セッションで当日の体重・体脂肪率・追加運動記録を記録し、保存内容がパネルに反映される
 * ことを確認する」は、`DailyLogPanel` がブラウザから到達可能な場所に実際に描画されていない
 * 限り検証不可能であり、task 6.1（「フロントエンドの配信を構成する」）の一部として
 * 必要-implied なインフラである（task 5.3 が `dailyLogClient.ts` を同様の理由で
 * 「必要-implied インフラ」として実装したのと同じ判断: design.md の Architecture 図は
 * 元々 `ProfilePageUI` と `DailyLogPanelUI` を両方 `Browser` 配下に描いている）。
 * `ProfilePage.tsx` / `DailyLogPanel.tsx` 自体の内部実装には一切触れていない。
 *
 * task 7.2（results-dashboard spec）: 上記のプロフィール編集画面（`ProfilePage` +
 * `DailyLogPanel`）と、`DashboardPage`（栄養評価画面・ダイエット状況画面、task 7.1で実装済み）
 * を行き来する簡易ナビゲーションを追加する。tasks.mdの指示通り、ルーティングライブラリは
 * 追加せず、`view`のReact状態（`useState`）によるページ切替のみで実装する。要件17.1/17.2
 * （利用者認証を要求しない・単一利用者を前提とし利用者ごとのデータ分離を実装しない）は、
 * この状態切替がログイン等の認証やユーザー単位の分離を一切伴わないことで自明に満たす。
 * ナビゲーション操作（2つのボタン）はどちらの画面表示中でも常に表示し、いつでも他方へ
 * 切り替えられるようにする。デフォルトは`"profile"`とし、既存の初期表示動作
 * （プロフィール編集画面が最初に表示される）を変更しない。
 */
import { useState } from "react";
import { ProfilePage } from "./pages/ProfilePage.js";
import { DailyLogPanel } from "./components/daily-log/DailyLogPanel.js";
import { DashboardPage } from "./pages/DashboardPage.js";

type View = "profile" | "dashboard";

export function App() {
  const [view, setView] = useState<View>("profile");

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="画面切替">
        <button
          type="button"
          className="app-nav-button"
          aria-pressed={view === "profile"}
          onClick={() => setView("profile")}
        >
          プロフィール編集
        </button>
        <button
          type="button"
          className="app-nav-button"
          aria-pressed={view === "dashboard"}
          onClick={() => setView("dashboard")}
        >
          結果ダッシュボード
        </button>
      </nav>

      {view === "profile" ? (
        <div className="layout">
          <div className="main-col">
            <ProfilePage />
          </div>
          <div className="side-col">
            <DailyLogPanel />
          </div>
        </div>
      ) : (
        <DashboardPage />
      )}
    </div>
  );
}
