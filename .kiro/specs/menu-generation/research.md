# Research & Design Decisions

## Summary
- **Feature**: `menu-generation`
- **Discovery Scope**: New Feature（greenfield。ただし技術スタック・アーキテクチャパターン・エラーハンドリング方針は起点spec `user-profile` で確定済みであり、`nutrition-engine` がそれを踏襲した前例があるため、本specも同一の方針を再利用する。新規に確定が必要なのは、本spec固有の関心事である Claude API 連携方式・tool制約設計・食品成分DBのデータ調達方針・単位正規化・満足度フィードバックの保存方式である）
- **Key Findings**:
  - 技術スタック（Fastify 5 + TypeScript、better-sqlite3 13、Zod 4、npm workspaces monorepo）、レイヤードアーキテクチャ（Route → Service → Repository）、`Result<T,E>` エラーエンベロープ、テスト戦略は `user-profile` / `nutrition-engine` の design.md / research.md で確定済みであり、本specはこれをそのまま踏襲する（再選定は行わない）
  - `nutrition-engine` が確立した「狭いGatewayポート経由でのプロセス内呼び出し」パターン（`ProfileGateway` / `DailyLogGateway`）を本specでも採用し、`user-profile`（読み取り・書き込み）と `nutrition-engine`（読み取り）への依存をそれぞれ専用のGatewayに閉じ込める
  - Claude APIの構造化出力（`strict: true` のtool use）は現行のMessages APIで提供される機能であり、JSON Schemaの `enum` 制約を用いて食品IDの選択肢を列挙できる。これによりbriefが要求する「食材選択をtool呼び出しに限定する」設計をそのまま実現できる
  - シングルユーザー・個人利用というコスト意識の高い前提から、既定モデルは `claude-sonnet-5`（Opus系より低コストで、コーディング・エージェント的タスクでOpusに迫る品質）を採用する。将来的な品質向上が必要な場合はモデルIDを設定値として `claude-opus-5` に切り替えられるようにする
  - MEXT「日本食品標準成分表（八訂）増補2023」の全収載食品（2000件超）をv1で網羅することはtool schemaの列挙サイズとメンテナンスコストの観点で過剰であり、日常的な家庭料理をカバーする厳選サブセット（数百件規模）から開始し、将来拡張可能な構造にする方が現実的である

## Research Log

### Claude APIによる構造化出力とtool制約の実現方式
- **Context**: briefで「食材選択はClaudeの自由記述ではなく、既知の食品IDリストからのtool呼び出しで行う」ことが既に決定されているが、具体的なAPI機能・スキーマ設計・モデル選定はdesignフェーズで確定する必要がある
- **Sources Consulted**: Anthropic Claude API 利用ガイド（`claude-api` スキル、2026年6月時点でキャッシュされたモデル一覧・料金・Tool Use仕様を含む）
- **Findings**:
  - Strict tool use はtool定義に `strict: true` をトップレベルフィールドとして設定することで有効化され、`input_schema` に `additionalProperties: false` と `required` を指定することで、`tool_use.input` がスキーマに厳密に一致することを保証できる。ベータヘッダは不要
  - JSON Schemaの `enum` 制約はstrict tool useでサポートされており、食材選択プロパティ（`food_id`）の型を「食品成分DBに存在する食品IDの列挙」に制約できる。数値制約（`minimum`/`maximum`）や文字列長制約はサポート外だが、本specでは分量は正の数値というアプリケーション層の検証で十分カバーできる
  - 現行モデルのうち `claude-sonnet-5`（Sonnetティア最新）は $3/$15 per MTok（導入価格 $2/$10、2026-08-31まで）とOpusティア（`claude-opus-5`: $5/$25）より低コストであり、コーディング・エージェント的タスクでOpusに迫る品質を持つ。個人利用のシングルユーザーアプリという「コスト意識が高い」性質上、既定モデルとして妥当である
  - `claude-sonnet-5` は思考なし（`thinking`未指定）でもデフォルトでadaptive thinkingが有効になる。コストを抑えたい単純なタスク（1食分のレシピ生成等）では `thinking: {type: "disabled"}` を明示し、`effort: "low"` を用いることで、週間献立生成（`effort: "medium"`、adaptive thinking有効）よりも軽量な呼び出しにできる
  - toolのJSON Schemaに食品ID一覧を `enum` として埋め込む場合、tool定義はリクエストごとに同一内容になるため、プロンプトキャッシュ（`cache_control`をtool配列の末尾に設定）により2回目以降のリクエストでのtool定義部分のトークンコストを大幅に削減できる
- **Implications**: 献立生成・レシピ生成それぞれについて `strict: true` のtool定義を用意し、食材選択プロパティに食品成分DBの `food_id` 一覧を `enum` として埋め込む。既定モデルは `claude-sonnet-5` とし、週間/日単位生成は `effort: "medium"` + adaptive thinking、レシピ詳細生成は `effort: "low"` + thinking無効とする。tool定義（食品ID列挙を含む）にはプロンプトキャッシュを適用する

### 食品成分DB（MEXT八訂）の収載範囲
- **Context**: roadmap制約により「日本食品標準成分表（八訂）増補2023」を一次データソースとすることが確定しているが、全収載食品（2000件超）を収載するか、実用的なサブセットに絞るかはdesignで判断する必要がある
- **Sources Consulted**: brief.md（MEXT八訂を一次データソースとする制約）、`nutrition-engine` のMicronutrientCalculator設計（公的資料の静的参照テーブル化という前例）
- **Findings**: MEXT八訂の全収載食品には、家庭調理では通常使用しない特殊な加工食品・地域限定食材・詳細な部位区分等が多数含まれる。tool schemaの `enum` にこれら全件を含めることは、（1）tool定義のトークンコストが際限なく増大する、（2)Claudeが実用性の低い食品IDを選択するリスクが増える、という2つの点で不利益が大きい
- **Implications**: v1では、主食・肉魚介・野菜・卵乳製品・大豆製品・調味料・果物・菓子類等の主要カテゴリから日常的な家庭料理に十分な数百件規模の食品を厳選した作業用カタログを構築し、実装タスクとして一次資料（MEXT公表データ）から転記する。データモデルはMEXTの食品番号をそのまま`food_id`として保持する構造とし、将来的に収載件数を拡張する場合もスキーマ変更が不要な設計とする（Design Synthesisの「Simplification」レンズに基づく判断）

### 満足度フィードバックの保存方式
- **Context**: 好き/苦手のフィードバックは食事枠（週・曜日・食事種別の組み合わせ）単位で記録され、同一食事枠への再フィードバックは最新値のみを保持する必要がある（要件10.5）。一方、フィードバックは次回以降の生成プロンプトへの反映のため、対象の献立（`meal_slots`）が再生成で置き換えられた後も参照可能である必要がある
- **Alternatives Considered**:
  1. `meal_slots.id` への外部キーでフィードバックを保持する — 再生成時に`meal_slots`行がCASCADE DELETEされるとフィードバック履歴も失われてしまう
  2. フィードバックを完全に独立したスナップショット（料理名・主要食材IDのJSON配列）として保存し、`(week_start_date, day_index, meal_type)` の組を「食事枠インスタンス」の識別子とするユニーク制約でupsertする
- **Selected Approach**: 2を採用する
- **Rationale**: フィードバックの目的は「この組み合わせの献立を再提案しない」ことであり、`meal_slots`テーブルの行のライフサイクル（再生成による置き換え）に依存させるべきではない。`(week_start_date, day_index, meal_type)` は要件10.4が求める食事種別ごとの独立した記録単位とも一致し、要件10.5の「同一食事枠インスタンスへの再フィードバックは最新値のみ保持」をユニーク制約によるupsertで自然に表現できる
- **Trade-offs**: `meal_slots`との厳密な参照整合性（FK）を持たないため、フィードバック記録時点の料理名・食材IDのスナップショットが実際に生成された献立と一致することはアプリケーション層の責任で保証する

### 計画摂取カロリーのuser-profileへの提供方向
- **Context**: brief および roadmap は「計画献立kcalをuser-profileの日次ログに反映する」ことを求めており、`user-profile` の design.md はこれを受信する `DailyLogService.setPlannedCalories(date, plannedKcal)` を既に公開している
- **Findings**: `nutrition-engine` は `user-profile` の `ProfileService.getProfile()` / `DailyLogService.getLog(date)` を「狭いGatewayポート」経由でプロセス内呼び出しする設計を確立している（`ProfileGateway` / `DailyLogGateway`）。本specも同一プロセス・同一monorepoの `server` パッケージ内で動作するため、HTTP自己ループバックではなくプロセス内呼び出しが適切である
- **Implications**: 本specは `user-profile` の `DailyLogService.setPlannedCalories(date, plannedKcal)` を呼び出す専用の `PlannedCalorieGateway` を持つ。これは「本specが `user-profile` に依存し、その公開Service Interfaceを呼び出す」という、`nutrition-engine` が確立した依存方向・実装パターンと完全に一致する（ロードマップの依存順序 `user-profile → nutrition-engine → menu-generation` とも整合する）。読み取り専用の `ProfileGateway`（`user-profile`）・`NutritionGateway`（`nutrition-engine`）と、書き込みを行う `PlannedCalorieGateway`（`user-profile`）の3つのGatewayを持つ点が本specの特徴である

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| レイヤードアーキテクチャ（Route → Service → Repository）+ 外部API統合層 | `user-profile`/`nutrition-engine`と同一パターンを踏襲し、Claude API連携を専用のClientコンポーネントとしてService層の依存先に追加 | 一貫性（3つのspec全てで同じ設計言語）、Claude API呼び出しロジックが独立してテスト・差し替え可能、既存パターンへの追加コストが低い | Service層のオーケストレーションがやや複雑になる（プロフィール取得・栄養目標取得・フィードバック集約・プロンプト構築・Claude呼び出し・検証・永続化・計画kcal送信という多段の処理） | 段階の多さは複数の小さなコンポーネント（PromptBuilder, ClaudeMenuClient, NutritionVerificationService等）に分割することで吸収する。本specの規模（LLM連携+DB照合+フィードバック学習の3領域）に見合う |
| Claude API呼び出しをRepository層に混在させる | 専用のクライアント層を設けず、MenuPlanRepositoryにClaude呼び出しも含める | コンポーネント数が減る | 外部I/O（Claude API）とローカルDB永続化という性質の異なる責務が同一コンポーネントに混在し、単体テストでのモック化が困難になる | 却下: `design-principles.md`のInterface Segregationおよびnutrition-engineの前例（計算モジュールとGatewayを分離する設計）に反する |
| イベント駆動（生成要求をキューイングし非同期ワーカーが処理） | 生成要求をジョブキューに積み、バックグラウンドワーカーが処理する | 長時間かかるLLM呼び出しをHTTPリクエストから切り離せる | シングルユーザー・ローカル完結のアプリにキュー基盤（Redis等）を追加するのは過剰。Claude APIの応答時間は同期HTTPリクエストの範囲内で十分許容できる | 却下: Simplificationレンズに基づき、同期的なRoute→Service呼び出しで十分と判断。将来的に生成時間が問題になった場合はSSEストリーミングでの進捗表示を検討する余地があるが、本spec範囲外とする |

**選定**: レイヤードアーキテクチャ（Route → Service → Repository）+ Gatewayポート（`user-profile`/`nutrition-engine`向け）+ 外部API統合コンポーネント（Claude API向け）を採用する。

## Design Decisions

### Decision: Claude APIモデルとパラメータの選定
- **Context**: briefは「Claude API（Messages API）を用いる」ことのみを確定しており、具体的なモデルID・thinking設定・effort設定はdesignで確定する必要がある
- **Alternatives Considered**:
  1. `claude-opus-5` を既定モデルとする — 品質は最も高いが、シングルユーザーの個人利用アプリには料金（$5/$25 per MTok）がコスト意識に見合わない
  2. `claude-sonnet-5` を既定モデルとする — Opusに迫る品質を持ちつつ、コーディング・エージェント的タスクで実用十分な性能を、より低コスト（$3/$15、導入価格$2/$10）で得られる
  3. `claude-haiku-4-5` を既定モデルとする — 最も低コストだが、7日間×4食種の栄養バランス・食事制限・重複回避を同時に満たす複雑な制約充足タスクには力不足のリスクが高い
- **Selected Approach**: 2（`claude-sonnet-5`）を既定モデルとする。モデルIDは設定値として外部化し、将来的に `claude-opus-5` へ切り替え可能にする
- **Rationale**: 個人利用・シングルユーザーというプロジェクト全体の性質（roadmap.md）と、brief.mdが明示する「コスト意識」を踏まえ、品質とコストのバランスが取れたSonnetティアを既定とする。週間献立生成・日単位再生成は制約充足の複雑さから `thinking: {type: "adaptive"}` + `output_config: {effort: "medium"}` を用い、レシピ詳細生成（単一料理の手順生成）は相対的に単純なタスクのため `thinking: {type: "disabled"}` + `effort: "low"` を用いてコストを抑える
- **Trade-offs**: モデル更新（Anthropicによる新モデルリリース）のたびにモデルIDの見直しが必要になる。設定値として外部化することでコード変更なしに追従できるようにする
- **Follow-up**: 実装時にモデルの実際の生成品質（NG食材の遵守率、重複回避の精度等）を評価し、不十分な場合は `effort` を引き上げるか `claude-opus-5` への切り替えを検討する

### Decision: 食材選択のtool schema設計と食品成分DBの収載範囲
- **Context**: briefが要求する「食材選択を既知の食品ID一覧からのtool呼び出しに限定する」設計を、MEXT八訂の全収載食品（2000件超）を対象にするか、実用的なサブセットにするかを判断する必要がある
- **Alternatives Considered**:
  1. MEXT八訂の全収載食品をtool schemaの `enum` に含める — 網羅性は最大だが、tool定義のトークンコストが増大し、実用性の低い食品ID（特殊な加工食品等）が選択されるリスクも増える
  2. 日常的な家庭料理をカバーする数百件規模の厳選サブセットを `food_id` の `enum` として用意し、将来拡張可能なテーブル構造にする
- **Selected Approach**: 2を採用する
- **Rationale**: 家庭料理の献立生成という本specのユースケースにおいて、全収載食品の網羅性よりも、生成される献立の実用性とtool呼び出しの応答品質・コストを優先すべきである。`food_items`テーブルの構造自体はMEXTの食品番号をそのまま`food_id`として保持するため、収載件数の拡張は新規行の追加のみで完結し、スキーマ変更を伴わない
- **Trade-offs**: 収載されていない食材が必要な献立（specialな食材を使う和食等）には対応できない。実装タスクで収載範囲を明記し、将来のフィードバックに応じて拡張する運用とする
- **Follow-up**: 実装タスクにて、MEXT「日本食品標準成分表（八訂）増補2023」の一次資料（政府公表データ）から主要カテゴリ（主食・肉類・魚介類・卵類・乳類・豆類・野菜類・果実類・調味料類・菓子類等）を横断する数百件規模のデータを転記し、出典表示を伴って登録する

### Decision: 満足度フィードバックとレシピ詳細のライフサイクル
- **Context**: 週単位・日単位の再生成により`meal_slots`の行は置き換えられる（既存行の削除・新規行の作成）ため、フィードバックとレシピ詳細をどのライフサイクルに紐づけるかを判断する必要がある
- **Selected Approach**: フィードバックは `(week_start_date, day_index, meal_type)` を食事枠インスタンスの識別子とする独立したスナップショットとして保存し、`meal_slots`のライフサイクルに依存しない（Research Log参照）。レシピ詳細は `meal_slots.id` への1対1の外部キー（CASCADE DELETE）で保持し、当該食事枠の食材が再生成で置き換えられた場合は自動的に古いレシピ詳細も削除される（要件8.4）
- **Rationale**: フィードバックは「学習データ」としての性質上、対象の献立が消えても参照可能であるべきだが、レシピ詳細は「その時点で確定している食材に基づく詳細情報」であり、食材が変われば無効になるべきという性質の違いを反映した設計である
- **Trade-offs**: 2つの子テーブルで異なる参照整合性ポリシー（スナップショット vs CASCADE DELETE）を採用するため、実装者はこの違いを明示的に理解する必要がある。それぞれの意図をコメント・ドキュメントで明記する

### Decision: エラー応答のHTTPステータスマッピング
- **Context**: 生成失敗には性質の異なる複数の原因（前提条件未達・Claude APIの応答品質問題・入力検証エラー）があり、一貫したステータスコード方針が必要
- **Selected Approach**:
  - 400: リクエストの入力検証エラー（日付形式・dayIndex範囲・mealType等）
  - 404: 存在しない週・日・食事枠を指定したレシピ詳細生成・フィードバック記録要求
  - 409: 前提条件未達（プロフィール未登録・栄養目標値算出不可）および同一対象への重複生成要求
  - 502: Claude APIおよびその応答品質に起因する生成失敗（ネットワーク/サーバーエラー・refusal・tool出力のスキーマ検証失敗・食品ID不存在・単位未定義）を統一し、`reason`フィールドで詳細を区別する
- **Rationale**: 409は`nutrition-engine`が`CalculationUnavailableError`に用いた前例を踏襲し、前提条件が未達である状態を表す。502は「本spec自身の実装の問題ではなく、依存する外部サービス（Claude API）の応答に起因する失敗」であることをクライアントに明示する意図で採用する
- **Trade-offs**: Claude APIに起因する失敗を細分化せず502に統一するため、クライアント側でリトライ可否を判断する場合は`reason`フィールドを参照する必要がある（`claude_request_failed`はリトライ余地あり、`claude_refusal`はリトライ不要等）

## Risks & Mitigations
- MEXT八訂データの転記ミスがそのまま栄養価計算の誤りに直結するリスク — 実装タスクで一次資料のURL・転記元テーブルを明記し、レビュー時に数値を照合する（`nutrition-engine`の微量栄養素参照テーブルと同様のリスク対策を踏襲）
- Claude APIのtool呼び出しが期待通りのスキーマに従わない、または実用性の低い食品ID選択を行うリスク — `strict: true`によるスキーマレベルの保証に加え、`enum`による食品ID制約、および生成失敗時に部分的な献立を永続化しない防御的設計で対応する
- 食品成分DBの収載範囲が限定的であるため、収載されていない食材が必要な献立に対応できないリスク — v1のスコープとして明示し、収載範囲の拡張は将来のタスクとする
- Claude APIのモデル世代交代・料金改定により、既定モデルの再評価が定期的に必要になるリスク — モデルIDを設定値として外部化し、コード変更なしに追従できるようにする
- 満足度フィードバックのスナップショット方式は`meal_slots`との参照整合性（FK）を持たないため、アプリケーション層でのデータ整合性維持が必要になるリスク — フィードバック記録時点で献立プランから料理名・食材IDを正しく取得する処理をMenuPlanServiceとFeedbackServiceの連携としてテストで担保する

### Decision: 外食代替提案の生成方式（Claude API生成 vs 決定論的選定）
- **Context**: `results-dashboard`のUIモックアップで示された「外食代替提案」機能を、レシピ詳細と同様にClaude APIで都度生成するか、あらかじめ用意した参照データから決定論的に選定するかを判断する必要がある
- **Alternatives Considered**:
  1. レシピ詳細・補助副菜提案と同じくClaude APIで都度生成する — 柔軟性は高いが、実在の外食チェーンのメニュー名・カロリーはLLMの学習データに依存し不正確になりやすく、栄養価検証の対象にもならないため数値の信頼性を担保できない
  2. あらかじめキュレーションした静的な外食メニュー参照データ（メニュー名・カロリー・代替メニュー名・カロリー・たんぱく質増分）から、対象食事枠のエネルギー量に最も近いものを決定論的に選定する
- **Selected Approach**: 2を採用する
- **Rationale**: 本specの中核方針（栄養価数値はLLMの自由生成に委ねず決定論的に担保する）と一貫させるため。外食メニューの実際のカロリーは店舗・時期によって変動しうるが、少なくとも参照データとして明示された数値は検証可能であり、LLMが都度生成する未検証の数値よりも信頼性が高い
- **Trade-offs**: 参照データに収載されていない外食シーンには対応できない。v1のスコープとして数十件規模に限定し、収載範囲の拡張は将来のタスクとする

### Decision: 検証済み栄養価への微量栄養素9項目の追加（追記）
- **Context**: `results-dashboard`のモックアップは微量栄養素（ビタミンA/D/B1/B2/C、カルシウム、鉄、食物繊維、食塩相当量）の「充足率」を表示するが、これを算出するための実績値（実際に計画した献立がどれだけの微量栄養素を含むか）を提供するコンポーネントがどのspecにも存在しないことが判明した。`NutritionVerificationService`はエネルギー・PFCの4項目のみを検証しており、`food_items`テーブル自体には9項目分のデータ（`per100g`）が既に存在するにもかかわらず、検証ロジックのスコープがそこに追いついていなかった
- **Alternatives Considered**:
  1. `results-dashboard`側で独自に微量栄養素を計算する — roadmap.mdの「results-dashboardは計算ロジックを持たない」という境界方針に反する
  2. `menu-generation`の`NutritionVerificationService`を拡張し、9項目すべてを`verifyDish`/`verifyDay`で合算する — 既存の`FoodItemNutrition.per100g`のデータをそのまま使え、他spec・他コンポーネントへの影響が最小
- **Selected Approach**: 2を採用する。`VerifiedNutritionValues`型を新設し、`MealSlot.nutrition`・`DayMenu.dayNutrition`をこの型に拡張する
- **Rationale**: 微量栄養素データは既に`food_items`に存在しており、検証ロジックを追加するだけで済む。エネルギー・PFCと同じ「食品ID×分量から実際の値を算出する」というドメインロジックの自然な拡張であり、新たな依存関係やドメイン概念を持ち込まない
- **Trade-offs**: `per100g`の微量栄養素フィールドは食品によって`null`（未収載）でありうる。合算時に`null`を0として扱う設計としたため、微量栄養素データが未収載の食材を含む料理・週は、実際より充足率が低く表示される可能性がある（安全側＝過小評価に倒す設計だが、ユーザーが「本当は足りているのに不足と表示される」ケースが生じうることは許容する）
- **Follow-up**: `results-dashboard`側は、この実績値と`nutrition-engine`の目標値の比（実績÷目標）を自前で算出して表示する形に変更が必要（本amendmentのスコープ外、`results-dashboard`側の担当範囲）

### Decision: レシピ詳細・追加副菜提案の材料一覧への食材名解決の追加（追記）
- **Context**: `results-dashboard`のtask 4.2（レシピ詳細モーダル）実装中に、要件6.2「材料一覧（食材名と分量）」を満たせない設計上のギャップが判明した。`IngredientSelection`（`MealSlot.ingredients`・`SupplementarySuggestion.ingredients`のいずれにも使われる）は`foodId`のみを持ち、人が読める食材名を持たない。`ShoppingListItem`は既に同じ問題を`name`フィールドの追加で解決済み（Requirement 14.3）だが、レシピ詳細（Requirement 8/9）には同等の解決が適用されていなかった。この問題はコード調査（`server/src/menu-generation/menu-plan.repository.ts`の`readIngredients`が`food_id`/`quantity`/`unit_code`のみを選択、`recipe-detail.service.ts`が食材名解決を一切行わない）で実装レベルでも確認済み。ユーザーには「menu-generation仕様を再オープンして修正」「材料一覧を省略してtask 4.2を進める」「foodIdをそのまま表示してtask 4.2を進める」の3案を提示し、「再オープンして修正」が選択された
- **Alternatives Considered**:
  1. `MealSlot.ingredients`/`IngredientSelection`スキーマ自体に`name`を追加する — Claudeのtool呼び出し入力スキーマ（要件3）と永続化・API応答の両方を兼ねる型であるため、Claudeの生成対象ではない`name`を混在させると「tool入力＝APIレスポンス」という現在の1対1対応が崩れ、`meal_ingredients`テーブルへの影響やこの型を参照する既存の全テスト（menu-generation本体・週間献立生成フロー等）に広範な改修が必要になる
  2. `RecipeDetail`（新設フィールド`ingredients`）と`SupplementarySuggestion.ingredients`の型のみを`ResolvedIngredient`（`IngredientSelection`+`name`）に変更し、`RecipeDetailService`が返却時に`FoodCompositionRepository`で都度名前解決する。永続化層（`RecipeDetailRepository`の`recipe_details`/`supplementary_suggestions`/`supplementary_ingredients`）は`IngredientSelection`のまま変更しない
- **Selected Approach**: 2を採用する。`ShoppingListService`が`ShoppingListItem.name`を解決する既存パターン（`FoodCompositionRepository`から都度解決、永続化しない）と同一の設計判断であり、影響範囲を`RecipeDetailService`とその周辺のテストのみに限定できる
- **Rationale**: `MealSlot.ingredients`/`IngredientSelection`はrequirement 3（食品ID制約によるtool呼び出し入力スキーマ）とrequirement 1/4（週間献立の確定済み食材の永続化・検証）の両方で使われる中核型であり、まだ結果画面に表示されていない（`results-dashboard`側でこの型を直接消費するコードは現時点で存在しない）ことを確認済みだが、変更すればmenu-generation本体の広範なテスト改修が必要になり、新規マイグレーションも要する。一方`RecipeDetail`/`SupplementarySuggestion`は`results-dashboard`のtask 4.2がまだ実装されておらず最初の消費者であるため、ここでの型変更は既存の表示ロジックを一切壊さない。DBスキーマも変更不要（名前解決は`food_items`との結合のみで完結し、既存テーブルに新規カラムを追加しない）
- **Trade-offs**: `RecipeDetailRepository`の永続化層（`PersistedRecipeDetail`）と公開型（`RecipeDetail`）が別の型になり、両者の対応関係を`RecipeDetailService`のコメントで明示する必要がある。将来`MealSlot.ingredients`自体の食材名表示が必要になった場合（例: 週間献立カード上で材料まで見せたくなった場合）は、選択肢1の再検討が必要になる
- **Follow-up**: `results-dashboard`のtask 4.2（RecipeDetailModal）は、新設された`RecipeDetail.ingredients`（`ResolvedIngredient[]`）をそのまま「材料一覧（食材名と分量）」として表示すればよく、`foodId`を自前で解決する必要はない

## References
- Anthropic Claude API 利用ガイド（`claude-api` スキル: モデル一覧・料金表・Strict Tool Use仕様・プロンプトキャッシュ仕様、2026年6月時点キャッシュ情報） — モデル選定・tool制約設計の一次情報
- `.kiro/specs/user-profile/design.md` / `research.md` — 技術スタック・アーキテクチャパターン・エラーハンドリング方針の踏襲元
- `.kiro/specs/nutrition-engine/design.md` / `research.md` — Gatewayポートパターン・栄養目標値レスポンス形式の踏襲元
- `.kiro/steering/roadmap.md` — MEXT八訂を一次データソースとする制約、シングルユーザー運用の前提
- `.kiro/specs/menu-generation/brief.md` — 本spec固有のスコープ・制約
