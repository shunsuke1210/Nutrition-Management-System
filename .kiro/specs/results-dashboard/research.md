# Research & Design Decisions

> **Amendment note**: このresearch.mdの本文（Summary〜Design Decisions）は、`results-dashboard`が買い物リスト・外食時の代替提案・ダイエットインサイトを自spec内で算出する当初設計の記録である。ユーザーレビューの結果、これら3つの算出ロジックは`nutrition-engine`と`menu-generation`側に移管するamendmentが先に実施され、`results-dashboard`は表示専用（バックエンドなし）に変更された。変更内容と経緯は末尾の「Amendment: 買い物リスト・外食時の代替提案・ダイエットインサイトの算出主体の移管」を参照。以下の記録は判断の経緯を残すため削除せず保持する。

## Summary
- **Feature**: `results-dashboard`
- **Discovery Scope**: ロードマップ上最後のspec。技術スタック（Fastify 5 + TypeScript、better-sqlite3 13、Zod 4、React 19 + Vite、npm workspaces monorepo）とレイヤードアーキテクチャ（Route → Service → Repository）・`Result<T,E>`エラー方式・Gatewayポート方式は `user-profile` / `nutrition-engine` / `menu-generation` の3specで確定済みであり、本specはこれをそのまま踏襲する。新規に確定が必要なのは、(1) 本spec最初の本格的なフロントエンド（`web`パッケージ）のコンポーネント/データ取得規約、(2) チャート描画方式、(3) mockup.htmlが要求する3つの表示（買い物リスト・外食代替提案・体重推移/目標達成予測/停滞期/運動シミュレーション）が、どの上流specの契約にも存在しないというギャップの扱い、の3点である。
- **Key Findings**:
  - `mockup.html` はモックアップ作成時点の暫定的な`spec-tag`注記（例: 停滞期アドバイス/運動シミュレーションに`spec: nutrition-engine`）を含むが、`nutrition-engine`の確定済み`design.md`にはこれらを算出するコンポーネントが存在しない。`spec-tag`はレイアウト上の目印であり確定した実装割当てではないと判断し、実装可能な形に再割当てする（詳細は Design Decisions を参照）
  - `menu-generation`の`WeekMenuPlan`/`MealSlot.ingredients`は`foodId`のみを公開し、食品名・カテゴリを含まない。買い物リスト表示には食品名・カテゴリが必須であり、これは`menu-generation`の既存契約の小さな追加拡張を要する未解決の上流ギャップである
  - `menu-generation`の設計は、`results-dashboard`が各spec（`user-profile`/`nutrition-engine`/`menu-generation`）の公開HTTP APIを直接読みに行く構成を想定した図（`ResultsDashboard -.-> Controller`）を描いているが、本specはroadmapの指示に基づき同一`server`パッケージ内の薄い集約バックエンド（Gatewayポート経由の同一プロセス内呼び出し）を追加で持つ。単純な一覧表示は各specの既存APIをフロントエンドから直接呼び出し、本specが新たに導出する3種のデータ（買い物リスト・外食代替提案・ダイエットインサイト）のみ新設のバックエンドを経由する
  - mockupのチャートはいずれもプレーンなインラインSVG + CSS変数によるテーマ切替であり、新規チャートライブラリを追加せずとも再現できる規模・複雑度である

## Research Log

### 買い物リストに必要な食品名・カテゴリの欠落
- **Context**: mockupの買い物リストは「白菜 1/2玉」のように食品名と分類（野菜・きのこ 等）を表示するが、`menu-generation`の`design.md`が公開する`WeekMenuPlan`のインターフェース（`MealSlot.ingredients: IngredientSelection[]`）は`foodId`/`quantity`/`unit`のみを含み、名称・カテゴリを含まない
- **Sources Consulted**: `.kiro/specs/menu-generation/design.md`（`IngredientSelection`、`FoodItemNutrition`、`FoodCompositionRepository`の各Service Interface定義、および物理データモデルの`food_items.name`/`food_items.category`列）
- **Findings**: 食品名・カテゴリのデータ自体は`menu-generation`の`food_items`テーブルおよび`FoodCompositionRepository.findById()`の戻り値（`FoodItemNutrition.name`/`category`）として既に存在するが、`menu-generation`のどの公開Service Interface/APIレスポンスにも表出していない。`FoodCompositionRepository`は`menu-generation`のData層（Repository）であり、他specがRepositoryへ直接依存することは3spec共通で確立された境界規約（Gatewayは相手のService層のみを呼び出す）に反する
- **Implications**: 本spec単独では解決できない上流の契約ギャップである。詳細な対応方針は Design Decisions の「食品名・カテゴリ参照の欠落」を参照

### 停滞期アドバイス・運動併用シミュレーションの算出主体
- **Context**: mockupは両セクションに`spec: nutrition-engine`という注記を付けているが、`nutrition-engine`の確定済み`design.md`のComponents一覧（BmrCalculator/ActivityCoefficientCalculator/PfcCalculator/MicronutrientCalculator/DietModeCalculator/GuardrailEvaluator）にはこれらを算出する要素が存在しない
- **Sources Consulted**: `.kiro/specs/nutrition-engine/design.md`（Components and Interfaces全体、Non-Goals）、`.kiro/specs/user-profile/design.md`（`DailyLogService.getLogsInRange`）
- **Findings**: 停滞判定・体重推移の傾向線・運動併用シミュレーションはいずれも「直近の体重ログの時系列傾向」を入力とする。`nutrition-engine`は日次ログを1日分の追加運動記録取得（`DailyLogGateway.getExerciseEntriesForDate`）にしか使っておらず、体重の時系列（範囲取得）を扱う設計にはなっていない。`user-profile`の`DailyLogService.getLogsInRange(from, to)`は既に存在し、範囲取得インターフェースとして利用可能
- **Implications**: 停滞判定・傾向線・運動併用シミュレーションは、既存の栄養計算式（BMR/TDEE/PFC/ガードレール閾値）を再実装せずに実装可能な「表示のための軽量な導出」であり、`results-dashboard`が自身のバックエンドで担う（詳細は Design Decisions を参照）。ただしエネルギー収支換算定数（体重1kgあたり7700kcal）は`nutrition-engine`の`DietModeCalculator`が採用した値と同一の広く引用される定数であり、本specでも同一の値を独立して採用する（`nutrition-engine`のAPIには公開されていない内部定数のため、値としての重複は許容し明記する）

### チャート描画方式
- **Context**: mockupはPFC構成比の横棒、微量栄養素充足率バー、ダイエット目標の進捗バー、曜日別カロリー差分の発散棒グラフ、体重推移+予測の折れ線グラフ、運動シミュレーションの比較バーをすべてインラインSVG + CSSカスタムプロパティ（ライト/ダーク自動切替）で実装している
- **Findings**: いずれも軸が最大2本、系列数が少ない（1〜3系列）単純なチャートであり、汎用チャートライブラリ（例: Recharts、visx）を導入する複雑さに見合わない規模である。ライブラリを導入した場合、mockupが定義するCSSカスタムプロパティ（`--series-1`等）によるライト/ダークテーマ切替との統合コストも発生する
- **Implications**: 新規チャートライブラリは追加せず、mockupのSVG構造をReactコンポーネント化した専用の軽量チャートコンポーネント群（`web/src/components/dashboard/charts/`）を実装する（Build vs Adopt: Build を選択）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| レイヤードアーキテクチャ（Route → Service → Gateway）+ フロントエンドは各specのAPIを直接呼び出す | 3種の新規導出（買い物リスト・外食代替提案・ダイエットインサイト）のみ本spec専用の薄いバックエンドを追加し、それ以外の表示（栄養サマリ・週間献立・レシピ詳細・日次ログ更新）はフロントエンドが`user-profile`/`nutrition-engine`/`menu-generation`の既存公開APIを直接呼び出す | 既存3specの確立された規約（Gatewayはサービス層のみ呼び出し）を維持しつつ、単純な一覧表示のために不要なプロキシ層を作らない。新規バックエンドの責務が明確（3つの導出のみ） | フロントエンドが複数specのAPIベースURLを扱う必要があるが、単一Fastifyプロセス・単一オリジンのため実質的には単なるパス違い | 採用。既存3specとの一貫性とSimplificationレンズの両方を満たす |
| 本specのバックエンドが全ての上流呼び出しを一元的にプロキシする | フロントエンドは常に`/api/dashboard/*`のみを呼び出す | フロントエンドの呼び出し先が単一になる | 単純な一覧表示（プロフィール取得・週間献立取得等）まで本specが「所有」しているように見え、境界があいまいになる。`menu-generation`のresearch.md等が想定する「results-dashboardは各specの公開APIを読む」という関係性からも外れる | 却下: Boundary Firstの原則（見せかけの所有権を作らない）に反する |
| フロントエンドから各specのSQLiteテーブルを直接参照するバックエンドを持つ | 実装が最短に見える | 3spec共通で確立された「Repositoryは他specから直接参照しない」という境界規約に違反する | 却下 |

**選定**: レイヤードアーキテクチャ（Route → Service → Gateway、本specの新規導出のみ）を採用する。

## Design Decisions

### Decision: 食品名・カテゴリ参照の欠落への対応
- **Status: amendmentにより解消済み（下記「Amendment: 買い物リスト・外食時の代替提案・ダイエットインサイトの算出主体の移管」を参照）。以下は原設計時点の記録として保持する。**
- **Context**: 買い物リスト（要件8）は食品名・カテゴリの表示を要求するが、`menu-generation`の確定済み公開契約はこれを提供しない
- **Alternatives Considered**:
  1. `menu-generation`の`FoodCompositionRepository`（Data層）に本specから直接依存する — 3spec共通のGateway境界規約（相手のRepositoryに直接依存しない）に違反する
  2. 買い物リストを`foodId`のみで表示する（名称なし） — mockupが示すユーザー体験（読める食品名でのリスト）を大きく損なう
  3. `menu-generation`に、食品ID一覧から名称・カテゴリのみを返す小さな読み取り専用のService Interface（例: `FoodCompositionRepository`を薄くラップした`FoodCatalogService.getDisplayInfo(foodIds)`）を追加してもらい、本specはそれを`FoodCatalogGateway`経由で呼び出す — 追加的（既存レスポンス形状を変更しない）かつ最小
- **Selected Approach（原設計時点）**: 3を採用する。ただし`menu-generation`の`design.md`は既に承認済みであり、本セッションのスコープは`results-dashboard`のspec作成であるため、本specの設計は「この最小拡張が`menu-generation`側に追加される」ことを前提として`FoodCatalogGateway`を定義し、実装着手前に`menu-generation`側へ小さなアドエンダム（`nutrition-engine`の`activityLevelLabel`アドエンダムと同様の形式）を追加することを推奨事項として記録する
- **Rationale**: 案1は境界規約違反、案2はUI要求を満たさない。案3が最小の追加的変更でmockupの要求を満たす
- **Trade-offs（原設計時点）**: 実装着手前に`menu-generation`側の追加作業（小さいがゼロではない）が必要になる。追加までの間、買い物リストは食品名の代わりに`foodId`を暫定表示するデグレードパスを`design.md`のError Handlingに明記する
- **Follow-up（解消済み）**: 本specが推奨した`menu-generation`側のアドエンダムは、`ShoppingListService`（`menu-generation`が自身の`FoodCompositionRepository`で品目名・カテゴリを解決し`ShoppingList`として返す）という、より広い範囲のamendmentの一部として実現された。本specの`FoodCatalogGateway`と`food-catalog.gateway.ts`は不要になり削除した

### Decision: 停滞期アドバイス・体重推移予測・運動併用シミュレーションの実装主体
- **Status: amendmentにより解消済み。当時「フラグ付き決定」として報告した`roadmap.mdの「zero calculation logic」逸脱`という懸念は、ユーザーが`nutrition-engine`側にこれらの機能を移管するamendmentを承認したことで解消された。以下は原設計時点の記録として保持する。**
- **Context**: mockupのレイアウト上は`nutrition-engine`という注記があるが、実装可能な計算主体は存在しない。roadmapは`results-dashboard`について「各種計算・生成ロジックは一切持たず、他specが提供するデータの表示に専念する」としているが、これらの3機能は既存データの時系列トレンド分析という、単純な受け渡し表示では実現できない性質を持つ
- **Alternatives Considered**:
  1. `nutrition-engine`にこれらの機能を追加する — 既に承認済みの上流specを本セッションのスコープ外で再びオープンする必要があり、影響範囲・レビュー工数が大きい
  2. 機能自体を requirements から削除する — brief.mdおよびmockupが明示的に要求しており、ユーザーが複数回のレビューで確定させたUI/UXの後退になる
  3. `results-dashboard`が、既存の栄養計算式（BMR/TDEE/PFC/ガードレール閾値）を一切再実装せず、既に取得済みの体重ログ・ダイエット目標データに対する単純な線形トレンド算出（最小二乗法による傾き）とエネルギー収支換算（体重1kgあたり7700kcal、`nutrition-engine`と同一の広く知られた定数）のみを用いる「表示専用の導出」として自spec内に実装する
- **Selected Approach（原設計時点）**: 3を採用する
- **Rationale（原設計時点）**: 案1は本タスクのスコープ外（他specの再オープン）であり実行できない。案2はユーザー承認済みのUI要求を破棄することになり不適切。案3は、ドメイン計算式（活動係数・PFC比率・ガードレール閾値等）を一切再実装せず、既存データの統計的要約（線形回帰）という表示層の責務にとどめることで、roadmapが禁止する「計算・生成ロジック」（栄養価やカロリー目標そのものの算出）とは異なる性質の処理として整理できる
- **Trade-offs（原設計時点）**: roadmap.mdの「zero calculation logic」という文言を字義通りに解釈すると本decisionは逸脱に見えるため、明示的にフラグを立てて本タスクの実行結果として報告する。将来的にこれらの機能を`nutrition-engine`側に移管したくなった場合、本specが定義する`DietInsightsService`のインターフェース（入力: 体重ログ・目標体重・目標期間、出力: 傾向・予測・停滞判定・シミュレーション結果）はそのまま`nutrition-engine`側の同名メソッドに移植可能な形にしておく
- **Follow-up（解消済み）**: ユーザーは本decisionのフラグ付き報告を受けて、案1（`nutrition-engine`側への移管）を選択した。`nutrition-engine`の`design.md`に`DietInsightsCalculator`と`GET /api/nutrition/diet-insights`が追加され、本specの`DietInsightsService`が定義していたインターフェース形状（体重ログ・目標体重・目標期間を入力とし、傾向・予測・停滞判定・シミュレーション結果を出力する）がほぼそのまま移植された。本specの`DietInsightsService`・`ProfileGateway`・`DailyLogGateway`は不要になり削除した

### Decision: 外食時の代替提案のデータソース
- **Status: amendmentにより解消済み。`menu-generation`側に`EatingOutSuggestionService`が追加され、本specの静的参照データ保持方針は不要になった。以下は原設計時点の記録として保持する。**
- **Context**: 要件9が要求する内容（例: 「牛丼並盛の代わりに焼き魚定食」）は、実際にユーザーが選ぶ外食店舗を特定できない以上、汎用的な参考情報の域を出ない。どのspecもこの種のデータを提供しない
- **Alternatives Considered**:
  1. `menu-generation`にClaude APIを使った外食代替案のオンデマンド生成を追加する — LLM呼び出しの追加コスト・プロンプト設計・承認済み設計の再オープンを要する
  2. `results-dashboard`が小さな静的参照データ（一般的な外食メニューとその概算カロリー・たんぱく質量のペアを10〜20件程度）を保持し、当日の目標カロリーとの近さに基づき決定論的に1件選んで表示する
  3. 機能を提供しない
- **Selected Approach（原設計時点）**: 2を採用する
- **Rationale（原設計時点）**: 案1は本タスクのスコープ外。案3はbrief/mockupの明示的要求を破棄する。案2は新たな栄養計算式やLLM呼び出しを伴わない、閲覧専用の参考情報提供にとどまる
- **Trade-offs（原設計時点）**: 提示される代替案は実際の食事ログや外食実績と連動しない一般的な参考情報である。mockupの文言（「今日の昼食を外食にする場合」）と同様、あくまで目安の提示であることを表示文言で明確にする
- **Follow-up（解消済み）**: 最終的には案1に近い形（ただしClaude APIによる自由生成ではなく、`menu-generation`が保有する決定論的な静的参照データによる選定）で`menu-generation`側の`EatingOutSuggestionService` / `GET /api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/eating-out-suggestion`として実装されることになった。選定基準は当日の推奨エネルギー量ではなく対象食事枠自体の検証済みエネルギー量（`meal_slots.energy_kcal`）を基準とする点が本specの原案と異なるが、UIが表示する内容（想定メニュー名・カロリー、代替メニュー名・カロリー、たんぱく質増分）は要件9の要求と一致する。本specの`eating-out-reference.data.ts`・`EatingOutTipService`（算出ロジック部分）は不要になり削除した

### Decision: チャート描画方式（Build vs Adopt）
- **Context**: Research Logの「チャート描画方式」を参照
- **Selected Approach**: 新規チャートライブラリを追加せず、mockupのインラインSVG構造をReactコンポーネント化する
- **Rationale**: mockupのチャートは低複雑度であり、ライブラリ導入のコスト（バンドルサイズ増、独自CSS変数テーマとの統合）が利益を上回らない
- **Trade-offs**: 将来チャート種別が大幅に増えた場合は改めてライブラリ導入を検討する余地を残す

### Decision: フロントエンドの状態管理・データ取得方式
- **Context**: 本specが`web`パッケージに初めて本格的な画面を構築するにあたり、データ取得方式の規約を確定する必要がある
- **Alternatives Considered**:
  1. React Query等のデータ取得ライブラリを導入する
  2. `user-profile`の`profileClient.ts`/`dailyLogClient.ts`と同様、型付きfetchラッパー + Reactの標準フック（`useState`/`useEffect`）のみで構成する
- **Selected Approach**: 2を採用する
- **Rationale**: `user-profile`が確立した規約（型付きfetchラッパー、ライブラリ非導入）との一貫性を優先する。本アプリはシングルユーザー・単一セッションであり、React Queryが解決するキャッシュ無効化・再検証の複雑さは現時点で必要ない
- **Trade-offs**: 手動での再フェッチ・ローディング状態管理が各コンポーネントに必要になるが、共通の`useAsyncData`的な小さなフックで重複を抑える

### Decision: ページ内モード切替の実装方式
- **Context**: mockupは栄養評価/ダイエット状況（旧称: 通常結果/ダイエット結果）をCSSのradio inputのみで切り替える単一HTMLファイルとして実装している
- **Alternatives Considered**:
  1. ルーティングライブラリ（react-router等）を導入し、`/normal`・`/diet`のURLを分ける
  2. ルーティングライブラリを導入せず、`DashboardPage`内のReact状態（`useState<"normal" | "diet">`）でセクションの表示/非表示を切り替える
- **Selected Approach**: 2を採用する
- **Rationale**: mockupが単一ページ内のトグルとして設計しており、URLの分離が要求されていない。新規依存を増やさないSimplificationレンズに合致する
- **Trade-offs**: モードの状態がブラウザの再読み込みやURL共有で保持されない。将来的にURL共有が必要になった場合はクエリパラメータ（`?mode=diet`）への昇格が可能な設計にする

## Risks & Mitigations（原設計時点。下記Amendmentにより多くが解消済み）
- ~~`menu-generation`の食品名・カテゴリ拡張（`FoodCatalogGateway`が依存する契約）が実装されるまで、買い物リストは`foodId`のみのデグレード表示になる~~ — 解消済み。`menu-generation`の`ShoppingListService`が品目名・カテゴリを解決した`ShoppingList`を返すため、本specはデグレードパスを持たない
- ~~`DietInsightsService`の線形回帰は外れ値（測定誤差の大きい体重記録）に敏感である~~ — 解消済み（算出主体が`nutrition-engine`の`DietInsightsCalculator`に移管されたため、本specの実装リスクではなくなった。予測・停滞判定を表示しないフォールバックの表示要件（10.5, 13.4, 14.3, 15.3）自体は引き続き有効）
- 外食代替提案は実際の外食実績と連動しない参考情報であり、ユーザーに「実測に基づく提案」と誤解される可能性がある — 表示文言で「目安」であることを明示する（この文言表示自体は引き続き本specの責務。選定ロジックは`menu-generation`に移管済み）
- ~~体重1kgあたり7700kcalの換算定数を`nutrition-engine`と本specの双方で独立に保持することになる~~ — 解消済み。本specはこの定数を保持しない（`nutrition-engine`の`constants.ts`にのみ存在する）

## Amendment: 買い物リスト・外食時の代替提案・ダイエットインサイトの算出主体の移管

- **Context**: 原設計は、上記3つのDecisionで記録した通り、いずれのUI要求も既存の上流spec契約でカバーされないという判断のもと、`ShoppingListService` / `EatingOutTipService` / `DietInsightsService`という3つの算出ロジックを`results-dashboard`自身のバックエンド（`server/src/dashboard/`）に実装する設計とした。ユーザーはこの設計をレビューし、roadmap.mdのBoundary Strategy（`results-dashboard`は表示専用、計算ロジックを一切持たない）により厳格に従うべきと判断し、3つの算出ロジックをそれぞれ本来の責務を持つべきspecへ移管するamendmentを、`nutrition-engine`と`menu-generation`の両方に対して先に実施した
- **What changed upstream**:
  - `nutrition-engine`: 要件14-17（体重推移の傾向分析と将来予測・目標体重到達見込み週数・減量停滞の検知・運動併用シミュレーション）とdesign.mdの`DietInsightsCalculator`コンポーネント・`GET /api/nutrition/diet-insights?date=`エンドポイントが追加された（`nutrition-engine`のtasks.md フェーズ6-7で実装対象）
  - `menu-generation`: 要件14-15（週間買い物リストの生成・外食代替提案の生成）とdesign.mdの`ShoppingListService` / `EatingOutSuggestionService`コンポーネント・`GET /api/menu-plans/:weekStartDate/shopping-list` / `GET /api/menu-plans/:weekStartDate/days/:dayIndex/meals/:mealType/eating-out-suggestion`エンドポイントが追加された（`menu-generation`のtasks.md フェーズ13-14で実装対象）
- **What changed in this spec**: `results-dashboard`の`ShoppingListService` / `EatingOutTipService` / `DietInsightsService`と、それぞれが依存していた専用Gateway群（`ProfileGateway` / `DailyLogGateway` / `NutritionGateway` / `MenuGateway` / `FoodCatalogGateway`）、静的参照データ（`category-display-groups.data.ts` / `eating-out-reference.data.ts`）、共有スキーマ（`shared/src/dashboard.schema.ts`）を全て削除した。本spec専用のバックエンド（`server/src/dashboard/`）自体が不要になったため、`server` / `shared`パッケージへの追加は一切なくなった。フロントエンドは、既存の`nutritionClient.getSummary` / `menuPlanClient.getWeekPlan`と同じ「上流specの公開APIを直接呼び出す」パターンに従い、`nutritionClient.getDietInsights` / `menuPlanClient.getShoppingList` / `mealSlotClient.getEatingOutSuggestion`を新設して3つのAPIを直接呼び出す。UI（コンポーネント構成・レイアウト・mockup.htmlとの対応）は変更していない
- **Flagged gap（解消済み）**: `menu-generation`の`ShoppingList`の各品目の数量表現について、当初は`mockup.html`が示す食材固有の自然な単位表現（例:「白菜 1/2玉」）と一致するか確定できないとして未解決フラグを立てていた。その後の`menu-generation`側の追加amendmentにより、`ShoppingListItem`が`quantityGrams`（正規化済みグラム量）に加えて`displayQuantity`/`displayUnit`（`food_items.display_unit_code`が設定済みの食品は換算後の自然な単位、未設定の食品はグラム表示にフォールバック）を返すことが確定した。本specは変換ロジックを持たず`item.displayQuantity`+`item.displayUnit`をそのまま表示する方針を`ShoppingListSection`のタスクに反映済み（tasks.md 5.1）

## References
- `.kiro/specs/user-profile/design.md`（技術スタック・レイヤードアーキテクチャ・`Result<T,E>`・フロントエンド規約の確定内容）
- `.kiro/specs/nutrition-engine/design.md`（`NutritionSummary`契約、`activityLevelLabel`アドエンダム、amendment: `DietInsights`契約・`GET /api/nutrition/diet-insights`）
- `.kiro/specs/nutrition-engine/requirements.md`（amendment: 要件14-17、体重推移傾向・ゴールETA・停滞検知・運動併用シミュレーション）
- `.kiro/specs/menu-generation/design.md`（`WeekMenuPlan`/`MealSlot`/`RecipeDetail`契約、`FoodCompositionRepository`、amendment: `ShoppingList`/`EatingOutSuggestionResult`契約・`GET .../shopping-list`・`GET .../eating-out-suggestion`）
- `.kiro/specs/menu-generation/requirements.md`（amendment: 要件14-15、週間買い物リストの生成・外食代替提案の生成）
- `.kiro/specs/results-dashboard/mockup.html`（UI/UXの承認済みground truth）
