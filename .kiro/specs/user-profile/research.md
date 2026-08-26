# Research & Design Decisions Template

## Summary
- **Feature**: `user-profile`
- **Discovery Scope**: New Feature（greenfield。プロジェクト内に既存コードは一切存在せず、本specがロードマップ上の起点となるため、ここで採用する技術スタックは以降の nutrition-engine / menu-generation / results-dashboard の前提にもなる）
- **Key Findings**:
  - シングルユーザー・ローカル完結の個人利用アプリであり、大規模なスケーラビリティや同時実行制御は不要。複雑な分散構成やORMの抽象化はオーバーエンジニアリングになる。
  - 2026年時点で greenfield な小規模TypeScript REST APIには Fastify が推奨される（型推論・組み込みバリデーション・パフォーマンスの観点）。Express は既存資産がある場合の選択肢。
  - SQLiteドライバは `better-sqlite3`（同期API・実績豊富）と `node:sqlite`（Node.js組み込み・Node 22.5+で利用可・2026時点でRelease Candidate）の二択。本プロジェクトは長期運用実績とAPIの枯れ具合を優先し `better-sqlite3` を採用する。
  - 入力検証は Zod v4 系がTypeScriptエコシステムの事実上の標準であり、フロント・バックエンド双方の型とランタイム検証を1つのスキーマ定義から得られる。

## Research Log

### SQLiteドライバの選定
- **Context**: シングルユーザー・ローカル完結のプロフィール/日次ログを永続化する手段が必要。認証・複数ユーザー対応は不要なため、フル機能のRDBMSサーバーは過剰。
- **Sources Consulted**: [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3), [SQLite Driver Benchmark: better-sqlite3, node:sqlite, libSQL, Turso](https://sqg.dev/blog/sqlite-driver-benchmark/), [Node.js Built-in SQLite (node:sqlite): 2026 Production Guide](https://www.hirenodejs.com/blog/nodejs-builtin-sqlite-node-sqlite-2026)
- **Findings**:
  - `better-sqlite3`（2026年8月時点 最新 v13系）は同期API・`.transaction()`ラッパーを持ち、CLIやローカル組み込みアプリに適する。
  - `node:sqlite` はNode.js 22.5+に組み込み済みでインストール不要だが、2026年時点でもRelease Candidate扱いであり、本番運用にはまだ枯れきっていない。
- **Implications**: 本specでは `better-sqlite3` を採用し、ファイルベースのSQLiteデータベース1本にプロフィール（シングルトン）と日次ログ（時系列）を保持する。

### バックエンドWebフレームワークの選定
- **Context**: プロフィールCRUD・日次ログCRUD・推移データ取得のREST APIをホストするフレームワークが必要。
- **Sources Consulted**: [Top Node.js Frameworks 2026: NestJS vs Fastify vs Express](https://ortemtech.com/blog/top-nodejs-frameworks-2026/), [Express vs Fastify: Node.js Framework Choice 2026](https://www.pkgpulse.com/guides/express-vs-fastify-2026)
- **Findings**: greenfieldなTypeScript小規模APIには2026年時点でFastify（v5系）がパフォーマンス・型推論・組み込みバリデーション統合の観点で推奨される。Expressは既存資産がある場合の選択肢。NestJSはDIコンテナ等の重量級構成で、単一ユーザー規模の本アプリには過剰。
- **Implications**: Fastify + TypeScriptを採用し、Zodスキーマをルートのバリデーションに直結させる。

### 入力検証ライブラリの選定
- **Context**: プロフィール・日次ログの多数の数値レンジ／必須条件（req 1.2, 1.3, 2.3, 2.4, 4.5, 4.10, 5.3, 6.4, 8.5, 9.4, 10.5 等）をフロント・バックエンド双方で一貫して検証する必要がある。
- **Sources Consulted**: [zod npm](https://www.npmjs.com/package/zod), [Zod v4 release notes](https://zod.dev/v4)
- **Findings**: Zod v4系（2026年8月時点 最新 4.4.x）がTypeScriptエコシステムの事実上の標準。スキーマから型を推論でき、フロントとバックエンドで同一スキーマを共有できる。
- **Implications**: `shared`パッケージにZodスキーマを定義し、バックエンドのリクエストバリデーションとフロントエンドのクライアントサイド事前検証の両方に再利用する。

### フロントエンド構成の選定
- **Context**: mockup.html はプレーンなHTML/CSSで実装されているが、実装時は動的な行追加/削除（運動量テーブル）、chip入力（NG食材/好み食材）、トグルで表示切替する条件付きフィールド（ダイエットモード）、日次ログの部分保存など、状態を持つUIが多い。後続の results-dashboard はグラフ描画・モーダル等のリッチな対話性を必要とする。
- **Findings**: 個人開発規模のSPAではコンポーネント指向フレームワークの方が状態管理・再利用性で有利。Viteは開発体験・ビルド速度の面で標準的な選択。
- **Implications**: React + TypeScript + Vite を採用し、mockup.html のセクション構造（基本情報／身体情報／生活習慣／運動習慣／食の好み／食事制限設定／ダイエットモード／今日の記録）をそのままコンポーネント境界に対応させる。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| レイヤードアーキテクチャ（Route → Service → Repository） | ルーティング／業務ロジック／永続化を層で分離 | 単純で理解しやすく、単一ユーザー規模の複雑度に見合う。層ごとに責務が明確でテストしやすい | 大規模化した場合は層内の肥大化リスク | 本specの規模（2集約: Profile / DailyLog）には十分 |
| ヘキサゴナル（ポート＆アダプタ） | ドメイン中心にポートを定義しアダプタで外部結合 | 外部依存の差し替えが容易 | 単一ユーザー・単一DBの本アプリには抽象化過多 | 却下: 現状のI/O先はSQLite1つのみで抽象化の恩恵が薄い |
| CQRS/イベントソーシング | コマンドとクエリを分離しイベント履歴で状態を再構築 | 監査ログ・履歴分析に強い | 実装・運用コストが高く、単一ユーザーの個人アプリには過剰 | 却下: 日次ログの時系列保存は通常のテーブル追記で十分に表現できる |

**選定**: レイヤードアーキテクチャ（Route → Service → Repository）を採用する。

## Design Decisions

### Decision: 永続化ストアとドライバ
- **Context**: シングルユーザー・ローカル完結のデータストアが必要
- **Alternatives Considered**:
  1. PostgreSQL/MySQL等のサーバー型RDBMS — 別プロセス運用が必要でオーバースペック
  2. `node:sqlite`（組み込み） — インストール不要だが2026年時点でRC、安定運用の実績が浅い
  3. JSONファイル直書き — トランザクション・型安全性・クエリ機能に欠ける
- **Selected Approach**: `better-sqlite3` を用いたファイルベースSQLite
- **Rationale**: 同期APIでコードが単純化でき、トランザクション機構が組み込まれ、実績も豊富。シングルユーザーのため同時書き込み競合の心配がない
- **Trade-offs**: 将来複数ユーザー対応する場合はスキーマ・アクセス層の見直しが必要（本specのスコープ外、ロードマップのOut将来拡張に整合）
- **Follow-up**: マイグレーションはアプリ起動時に番号付きSQLファイルを順次適用する方式とし、専用ORMは導入しない

### Decision: プロフィール集約内の一覧データ（運動量テーブル・NG食材・好み食材）の保存形態
- **Context**: 運動量テーブル（複数行・5項目）、NG食材一覧、好み食材一覧はいずれもプロフィールと同時に一括保存されるユーザー入力である
- **Alternatives Considered**:
  1. プロフィール行にJSON列として埋め込む — 保存/読出しはシンプルだが、行単位の型付けとバリデーションがアプリ層に依存する
  2. 専用の子テーブル（`profile_id`外部キー）に正規化する — 各行が型付きカラムを持ち、DB層で構造を保証できる
- **Selected Approach**: 専用の子テーブルに正規化する（`exercise_routine_entries`, `ng_ingredients`, `preferred_ingredients`）
- **Rationale**: 運動量テーブルは場面・内容・頻度・時間・強度という5つの型付きフィールドを持ち、リレーショナルなテーブル定義の方が制約（頻度・時間が正の数であること等）を表現しやすい。NG食材/好み食材も同様の理由で正規化する
- **Trade-offs**: JSON列に比べテーブル数がやや増えるが、プロフィール取得時に子テーブルをまとめて結合すればAPI応答としては単一のプロフィールオブジェクトに変換できるため、利用側の複雑さは増えない

### Decision: 摂取カロリー実績のハイブリッド解決ロジック
- **Context**: 摂取カロリー実績は menu-generation の計画kcal（既定値）と利用者の手動上書き値の二重管理が必要（req 9.1-9.5）
- **Alternatives Considered**:
  1. 手動上書きがあれば計画値を削除してしまう — 元の計画値を失い、上書きを取り消せなくなる
  2. 計画値と手動上書き値を別カラムで保持し、参照時に手動上書き値を優先する — 両方の値を保持したまま解決できる
- **Selected Approach**: `planned_kcal`（menu-generationからの受信値）と `manual_override_kcal`（利用者による上書き値）を別カラムで保持し、実効値は `manual_override_kcal ?? planned_kcal ?? null` として解決する
- **Rationale**: 上書きの取り消し（手動値のクリア）や、計画値のみの更新（上書きを壊さない）の両方を安全に扱える
- **Trade-offs**: カラムが2つに増えるが、要件の可逆性を素直に満たせる

## Risks & Mitigations
- 将来のマルチユーザー化でスキーマ全体（`profile_id`の意味論、テーブル設計）に影響が及ぶ可能性 — 現時点ではシングルトン運用とし、将来対応はロードマップの将来拡張として明示的にスコープ外とする
- nutrition-engine / menu-generation がまだ実装されていないため、`planned_kcal`受信APIと運動習慣データの読み出しAPIの実際の呼び出し形は本spec単独では検証できない — 契約（スキーマ・エンドポイント）をdesign.mdに明記し、依存specの設計時に整合を取る
- `better-sqlite3`はネイティブアドオンのため、Node.jsバージョンアップ時に再ビルドが必要になる場合がある — package.jsonでNode.jsバージョンを固定し、CIでビルド確認を行う運用を実装フェーズで検討する

## References
- [better-sqlite3 - npm](https://www.npmjs.com/package/better-sqlite3) — ドライバ選定の一次情報
- [SQLite Driver Benchmark: better-sqlite3, node:sqlite, libSQL, Turso](https://sqg.dev/blog/sqlite-driver-benchmark/) — ドライバ比較
- [Node.js Built-in SQLite (node:sqlite): 2026 Production Guide](https://www.hirenodejs.com/blog/nodejs-builtin-sqlite-node-sqlite-2026) — node:sqliteの成熟度
- [Express vs Fastify: Node.js Framework Choice 2026](https://www.pkgpulse.com/guides/express-vs-fastify-2026) — バックエンドフレームワーク比較
- [zod - npm](https://www.npmjs.com/package/zod) — バリデーションライブラリの最新版確認
