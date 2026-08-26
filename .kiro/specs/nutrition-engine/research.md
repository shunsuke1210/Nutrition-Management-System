# Research & Design Decisions

## Summary
- **Feature**: `nutrition-engine`
- **Discovery Scope**: New Feature（greenfield。ただし技術スタック・アーキテクチャパターンは起点specである `user-profile` で確定済みのため、本specはそれを再利用する。新規に確定が必要なのは、本spec固有のドメインロジック（活動係数の導出式、BMR/TDEE/PFC/微量栄養素の計算式、ダイエットモードの逆算式、安全ガードレールの閾値）である）
- **Key Findings**:
  - 技術スタック・レイヤードアーキテクチャ・エラーハンドリング（`Result<T,E>`判別共用体）・テスト戦略は `user-profile` の `design.md` / `research.md` で確定済みであり、本specはこれをそのまま踏襲する（再選定は行わない）
  - 本specは自身の永続化ストアを持たない（ステートレスな計算エンジン）。`user-profile` が保持するプロフィール・日次ログを都度読み取り、決定論的な計算式で目標値を算出してAPIで返す
  - user-profileとは同一Node.jsプロセス・同一monorepo（`server`パッケージ）内で完結するため、HTTP経由の自己呼び出しではなくプロセス内の関数呼び出し（TypeScriptモジュールインポート）で連携する。ただし依存の混入を防ぐため、狭いポートインターフェース（Gateway）を介して連携する
  - BMR式（Mifflin-St Jeor / Katch-McArdle）、活動係数の構成要素、安全な減量ペース・最低摂取カロリーの目安は、いずれも公的機関・主要な計算式提供元で広く引用されている値が存在し、本specではそれらの標準値を採用する

## Research Log

### BMR計算式の係数
- **Context**: 要件2（BMR算出）でMifflin-St Jeor式・Katch-McArdle式の採用がbriefで確定済みだが、正確な係数と「性別:回答しない」の扱いはdesignで確定する必要がある
- **Sources Consulted**: [Mifflin St. Jeor Calculator - Inch Calculator](https://www.inchcalculator.com/mifflin-st-jeor-calculator/), [Mifflin-St Jeor Equation - Medscape/QxMD](https://reference.medscape.com/calculator/846/mifflin-st-jeor-equation), [Katch-McArdle Calculator - Omnicalculator](https://www.omnicalculator.com/health/bmr-katch-mcardle), [GQNS Mifflin St. Jeor Equation（性別回答なしの平均オフセット）](https://genquestnutrition.com/ree.htm)
- **Findings**:
  - Mifflin-St Jeor: 男性 `10×体重kg + 6.25×身長cm − 5×年齢 + 5`、女性 `10×体重kg + 6.25×身長cm − 5×年齢 − 161`
  - Katch-McArdle: `370 + 21.6 × 除脂肪体重kg`（除脂肪体重 = 体重 ×（1 − 体脂肪率））。性別に依存しない単一式
  - 「回答しない」の場合、男女オフセット（+5 / −161）の平均値 −78 を用いる方式が消費者向けフィットネス計算機で一般的に採用されている
- **Implications**: 体脂肪率が登録されている場合は常にKatch-McArdle式（性別に依存しないためこの分岐が最も単純）、登録されていない場合はMifflin-St Jeor式を用い、性別が「回答しない」の場合はオフセット−78を採用する

### 活動係数の構成要素とMET値
- **Context**: 活動係数はユーザーの直接選択ではなく、user-profileが保持する運動習慣詳細（お仕事中の活動度・通勤手段・平均歩数・場面別週間運動量）から導出する必要があり、brief は「職業活動度をベース係数とし、週間運動量の合計から補正を加える方法」を例示し、具体式をdesignで確定するよう求めている
- **Sources Consulted**: [Harris-Benedict Calculator - Inch Calculator](https://www.inchcalculator.com/harris-benedict-calculator/), [TDEE Activity Level Guide - FitnessVolt](https://fitnessvolt.com/tdee-calculator/activity-level-guide/), [FAO Human Energy Requirements Ch.5（PAL区分）](https://www.fao.org/4/y5686e/y5686e07.htm), [CDC Measuring Physical Activity Intensity（MET区分）](https://www.cdc.gov/physical-activity-basics/measuring/index.html), [How Do You Calculate Calories Burned During Exercise? - MedicineNet（MET→kcal換算式）](https://www.medicinenet.com/how_to_calculate_calories_burned_during_exercise/article.htm)
- **Findings**:
  - 古典的なHarris-Benedict/Mifflin活動係数の段階（座位1.2 / 軽い活動1.375 / 中程度1.55 / 活発1.725 / 非常に活発1.9）が広く引用されている
  - MET（運動強度の代謝当量）ベースでの消費カロリー換算式が確立している: `kcal/分 = MET × 3.5 × 体重kg ÷ 200`
  - CDCのMET強度区分: 軽い運動 ≤3.0 MET、中程度 3.0-5.9 MET、激しい運動 ≥6.0 MET
  - より詳細なTDEE計算では、職業活動度ベースのPALを基礎とし、構造化された運動量（MET×時間）から追加の消費カロリーを積み上げる手法が実務で使われている
- **Implications**: 職業活動度を活動係数のベース値（座位/混合/活動的の3区分）とし、通勤手段・平均歩数を小さな加算補正、週間運動量（場面別の頻度・時間・強度）をMET換算した週間消費カロリーから「BMRに対する比率」として活動係数に加算する方式を採用する。この方式はkcalベースで一貫しており、恣意的なルックアップテーブルよりも説明可能性が高い

### 安全な減量ペースと最低摂取カロリー
- **Context**: ダイエット安全ガードレールの閾値（最低摂取カロリー基準・最大減量ペース）はbriefで「性別ごとの最低摂取カロリー基準」「週体重の0.5〜1%以内」を例示しつつdesignで確定するよう求めている
- **Sources Consulted**: [CDC Steps for Losing Weight](https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html), [Harvard Health - realistic rate of weight loss](https://www.health.harvard.edu/weight-loss/what-does-a-healthy-realistic-rate-of-weight-loss-look-like-and-why-does-it-matter), [NHS Inform - Tips for losing weight safely](https://www.nhsinform.scot/healthy-living/weight-loss/tips-for-losing-weight-safely/), [NIDDK Body Weight Planner](https://www.niddk.nih.gov/bwp), [Mayo Clinic Calorie calculator](https://www.mayoclinic.org/healthy-lifestyle/weight-loss/in-depth/calorie-calculator/itt-20402304)
- **Findings**:
  - 主要な保健機関で一貫して引用される安全な減量ペースは「週0.5〜1kg（週1〜2ポンド）」という絶対値表現が最も一般的だが、体格に応じてスケールする「体重の1%/週以内」という相対値表現も併用される
  - 最低摂取カロリーの目安として「女性1200kcal/日、男性1500kcal/日」が消費者向けに広く引用されるが、簡略化された目安であることが明記されている。より臨床的な出典では女性1200-1500kcal、男性1500-1800kcalという幅も見られる
  - NIDDKの Body Weight Planner は1000kcal/日を絶対的な下限として扱う
- **Implications**: briefが明示的に例示した「体重の0.5〜1%/週」という相対値表現を採用し、上限として1%/週を最大安全減量ペースとする（個人の体格に比例してスケールするため、シングルユーザー向けの単純な計算式に適する）。最低摂取カロリーは広く引用される「女性1200kcal、男性1500kcal」を採用し、性別「回答しない」の場合は安全側（より高い方＝より多くの摂取を要求する方）である1500kcalを採用する

### 体重推移分析・ゴールETA・停滞検知・運動併用シミュレーションのパラメータ（追記: results-dashboardのspec作成時に判明した機能の受け入れ）
- **Context**: `results-dashboard` のspec作成時、そのUIモックアップ（`mockup.html`）が体重推移予測・目標到達見込み・停滞期アドバイス・運動併用シミュレーションの表示を要求しているにもかかわらず、これらを算出するコンポーネントがどのspecにも存在しないことが判明した。`results-dashboard` はroadmap.mdのBoundary Strategyにより表示専用の責務に限定される（各種計算・生成ロジックを持たない）ため、`results-dashboard` の設計者は一時的に自spec内（`DietInsightsService`）にこれらを実装しつつ、`results-dashboard` のresearch.mdに「本decisionはフラグ付き決定であり、将来nutrition-engine側に移管したくなった場合、同spec内のDietInsightsServiceのインターフェースはそのままnutrition-engine側の同名メソッドに移植可能な形にしておく」という申し送りを残していた。本追記は、この申し送りを受けてユーザーが「BMR/TDEE/目標カロリー逆算/ガードレールと同じ体重<->カロリー変換・MET換算の土台を再利用する自然な拡張である」と判断し、これらの機能をnutrition-engine側に正式に移管した際の設計判断を記録する
- **Sources Consulted**: `.kiro/specs/results-dashboard/design.md`（`DietInsightsService`のComponents and Interfaces全体）、`.kiro/specs/results-dashboard/research.md`（「停滞期アドバイス・体重推移予測・運動併用シミュレーションの実装主体」Decision）、`.kiro/specs/user-profile/design.md`（`DailyLogService.getLogsInRange`）
- **Findings**:
  - `results-dashboard` 側の設計時点で既に、長期ウィンドウ56日・短期ウィンドウ14日・最小記録点数2件・最小期間14日・停滞判定閾値30%・運動シナリオ（週3回・30分・中強度、MET4.5）というパラメータが検討・採用されていた
  - 長期56日（8週間）は、体重の日々のノイズ（測定誤差・体内水分変動・食事のタイミング等）を平均化しつつ「直近のペース」と呼べる程度に新しいデータに限定するための実務的なバランス点である。短すぎると外れ値の影響を受けやすく、長すぎるとダイエット開始当初の異なるペースを引きずってしまう
  - 短期14日（2週間）は、多くの一般向けダイエット指南（停滞期に関する記述）で「2週間体重が動かない」を停滞の目安として言及する頻度が高く、利用者にとって直感的に理解しやすい期間である
  - 最小記録点数2件・最小期間14日は、線形回帰が意味を持つための必要最小限の条件（2点未満では傾きが定義できず、期間が短すぎると日々の変動が支配的になり週単位のペースとして信頼できない）
  - 停滞判定の閾値30%は、測定誤差による通常の変動幅を明確に超える「はっきりとした鈍化」を検出しつつ、閾値を厳しくしすぎて（例えば50%等）順調なペースの範囲内の揺らぎまで停滞と誤判定しないバランス点として採用された
  - 運動シナリオ「週3回・30分・中強度」は、WHO/CDC等が一般的に推奨する「週150分の中強度運動」を3回に分割した目安であり、シングルユーザーが現実的に検討しうる典型的な追加運動量として選ばれている
- **Implications**: これらのパラメータは`results-dashboard`側の検討時点で既に十分な理由付けがなされており、算出主体をnutrition-engineに変更するにあたって数値・閾値を変更する理由はない。本specでは同一の値をそのまま採用し、`constants.ts`に集約する（`WEIGHT_TREND_LONG_WINDOW_DAYS = 56`, `WEIGHT_TREND_SHORT_WINDOW_DAYS = 14`, `WEIGHT_TREND_MIN_DATA_POINTS = 2`, `WEIGHT_TREND_MIN_SPAN_DAYS = 14`, `WEIGHT_PROJECTION_HORIZON_WEEKS = 4`, `PLATEAU_PACE_RATIO_THRESHOLD = 0.30`, `EXERCISE_SIMULATION_SCENARIO = { frequencyPerWeek: 3, durationMinutes: 30, intensity: "moderate" }`）。エネルギー収支換算定数（`ENERGY_DENSITY_KCAL_PER_KG`）とMET値（`moderate: 4.5`）は、本spec内に既存の`DietModeCalculator` / `ActivityCoefficientCalculator`が保持する値をそのまま参照し、独自の再定義は行わない（`results-dashboard`側の設計では同一定数を独立に保持せざるを得なかったが、算出主体がnutrition-engine内に一本化されたことで、この重複は解消される）

### エネルギー収支の換算定数
- **Context**: ダイエットモードの目標カロリー逆算には、体重変化量をカロリー収支に変換する定数が必要
- **Sources Consulted**: [Energy Content of Weight Loss - PMC3810417（Wishnofsky則とNIH Hallモデルによる批判）](https://pmc.ncbi.nlm.nih.gov/articles/PMC3810417/)
- **Findings**: 古典的なWishnofsky則（体脂肪1kgあたり約7700kcal、1lbあたり約3500kcal）が最も広く使われる静的換算定数である。実際のエネルギー収支は減量の進行に伴い非線形に変化する（NIHのHallモデル等）ことが指摘されているが、決定論的な計算式を要件とする本spec（要件13.1, 13.2）にはv1として静的定数が適する
- **Implications**: 体重1kgあたり7700kcalの静的定数を採用し、将来的な動的モデルへの置き換えは本spec範囲外の改善余地として`Risks & Mitigations`に記録する

### PFC（三大栄養素）バランスの基準比率
- **Context**: 通常モードのベースPFC比率、および食事制限設定（タイプ×強度）による調整幅の基準が必要
- **Sources Consulted**: [厚生労働省 日本人の食事摂取基準（2025年版）策定検討会報告書](https://www.mhlw.go.jp/stf/newpage_44138.html), [日本人の食事摂取基準2020年版 改定のポイント - J-STAGE](https://www.jstage.jst.go.jp/article/cookeryscience/53/2/53_153/_pdf), [Best Macronutrient Ratio for Weight Loss - Healthline](https://www.healthline.com/nutrition/best-macronutrient-ratio)
- **Findings**:
  - 「日本人の食事摂取基準」のエネルギー産生栄養素バランス（成人）は、たんぱく質13-20%E・脂質20-30%E・炭水化物50-65%Eの範囲を目標量としている
  - 食事制限アプローチ別の一般的な調整方向: 糖質制限は炭水化物比率を10-30%E程度まで下げ、たんぱく質・脂質を引き上げる。高たんぱくはたんぱく質比率を25-50%E程度まで引き上げる。脂質制限は脂質比率を10-20%E程度まで下げ、炭水化物で補う
- **Implications**: ベース比率をP15%/F25%/C60%（食事摂取基準の範囲内の代表値）とし、食事制限タイプ×強度の3段階（ゆるやか/標準/しっかり）で炭水化物・脂質・たんぱく質比率を段階的に調整するテーブルを設計する（詳細は design.md の PFC調整テーブルを参照）。「カロリー制限のみ」はPFC比率を調整せずベース比率を維持する（名称通りカロリー総量のみを制約する方針のため）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| レイヤードアーキテクチャ（Route → Service → 計算モジュール群） | user-profileと同一パターンを踏襲し、計算ロジックを独立した純粋関数モジュール群として分離 | 一貫性（user-profileと同じ設計言語）、各計算式が単体テストしやすい、他specとの認知負荷が低い | 計算モジュールが増えるとService層の呼び出しが線形に増える | 本specの規模（BMR/活動係数/PFC/微量栄養素/ダイエット逆算/ガードレールの6計算領域）に対して十分。user-profileとの一貫性を優先し採用 |
| ルールエンジン/戦略パターンによる汎用化 | 各食事制限タイプ×強度の組み合わせを汎用ルールエンジンで表現 | 将来的にルール追加が容易 | 現在の組み合わせ数（4タイプ×3強度）は静的なテーブルで十分表現でき、ルールエンジンは抽象化過多 | 却下: `design-synthesis`のSimplificationレンズに基づき、静的な調整テーブル+単純な関数で十分と判断 |
| HTTP経由でuser-profileを呼び出す疎結合サービス分割 | nutrition-engineを別プロセス/別デプロイ単位として扱い、user-profileのHTTP APIを都度呼び出す | プロセスの独立デプロイが可能 | シングルユーザー・単一プロセス運用が前提（roadmap制約）であり、自己ホストへのHTTP往復はレイテンシと複雑さを増やすだけ | 却下: 同一monorepo・同一Fastifyプロセス内のプロセス内関数呼び出し（Gateway経由）を採用 |

**選定**: レイヤードアーキテクチャ（Route → Service → 計算モジュール群）+ プロセス内Gateway連携を採用する。

## Design Decisions

### Decision: user-profileとの連携方式（プロセス内呼び出し vs HTTP）
- **Context**: nutrition-engineはuser-profileが保持するプロフィール・日次ログを読み取る必要がある。両specは同一monorepoの`server`パッケージ上で単一プロセスとして動作する前提（user-profileのresearch.mdより）
- **Alternatives Considered**:
  1. nutrition-engineのServiceから自分自身のHTTP API（`GET /api/profile`等）にHTTPリクエストを発行する — プロセス境界を明示的に扱えるが、単一プロセス内での自己ループバック通信は不要な複雑さとレイテンシを生む
  2. ProfileService/DailyLogServiceを直接importして呼び出す — 最短経路だが、nutrition-engineがuser-profileの内部実装（Repository構造等）に暗黙的に依存するリスクがある
  3. 狭いポートインターフェース（Gateway）を定義し、その実装がProfileService/DailyLogServiceの必要最小限のメソッドのみをラップする — 依存を明示的な契約に限定できる
- **Selected Approach**: 3の狭いGatewayインターフェース方式を採用する（`ProfileGateway`, `DailyLogGateway`）
- **Rationale**: 単一プロセス内なのでHTTP往復は不要（1を却下）。一方でnutrition-engineがuser-profileの内部実装詳細（Repository層等）に直接依存すると、user-profile側の内部リファクタリングがnutrition-engineに波及するリスクがある。Gatewayが依存を「ProfileService.getProfile()」「DailyLogService.getLog(date)」という公開Service Interfaceの呼び出しのみに限定し、契約面を明示する
- **Trade-offs**: 薄いラッパー層が1つ増えるが、テスト時にGatewayをモック化でき、user-profile側の変更影響範囲を局所化できる
- **Follow-up**: 将来nutrition-engineが別プロセス・別デプロイ単位に分離される場合、Gateway実装をHTTPクライアントに差し替えるだけで済むようインターフェースをプロセス透過的に設計する

### Decision: 活動係数の算出式
- **Context**: briefが明示的にdesignフェーズでの確定を求めている項目
- **Alternatives Considered**:
  1. 職業活動度の3区分のみで固定係数を割り当てる（通勤手段・歩数・週間運動量を考慮しない） — 単純だがbriefの要求（運動習慣の詳細情報を反映）を満たさない
  2. 職業活動度をベースPAL、通勤手段・歩数を小さな加算補正、週間運動量をMETベースの消費カロリー換算からBMR比の加算補正として合成する — 各要素の寄与がkcalベースで説明可能
  3. 全要素をMETベースの完全なNEAT+EAT積み上げ式で再構成する（職業活動度もMET換算） — より厳密だが、職業活動度・通勤手段は「時間×MET」の形で定量化する元データがuser-profileに存在しない（区分選択のみ）ため過剰設計
- **Selected Approach**: 2の合成方式を採用する
  ```
  ActivityCoefficient = clamp(
    BaseCoefficient(jobActivityLevel)
      + CommuteAdjustment(commuteMethod)
      + StepAdjustment(averageDailySteps)
      + ExerciseAdjustment(exerciseRoutine, weightKg, BMR),
    1.20, 1.90
  )
  ```
  詳細な係数表は design.md の Components and Interfaces を参照
- **Rationale**: 職業活動度・通勤手段・歩数は区分/カウントデータのみのため標準的なPAL段階＋小刻みな加算という単純な方式が適する一方、週間運動量は頻度・時間・強度という定量データが揃っているため、MET換算による消費カロリーベースの加算（ExerciseAdjustment = 週間運動消費kcal ÷ 7 ÷ BMR）にすることで、恣意的な係数ではなく単位が一貫した（kcal / kcal = 無次元比率）補正になる
- **Trade-offs**: 完全なMET積み上げ式（案3）ほどの精度はないが、user-profileが提供するデータの粒度に見合っている。将来user-profileが職業活動度をより定量的なデータ（実測時間等）に拡張した場合は本式の再検討が必要
- **Follow-up**: 係数表（BaseCoefficient, CommuteAdjustment, StepAdjustment, MET値）はいずれも根拠となる公的資料の中央値・代表値を採用しており、実運用のフィードバックに応じて調整可能な設定値として実装する（ハードコードではなく名前付き定数として集約する）

### Decision: 微量栄養素目標値の基準データ
- **Context**: 通常モードで主要な微量栄養素の目標値を算出する必要がある（要件6）
- **Alternatives Considered**:
  1. 個々の栄養素についてBMR・体重等から独自の計算式を組み立てる — 医学的根拠が本spec独自の考案になってしまい信頼性に欠ける
  2. 公的な食事摂取基準（性別×年齢区分ごとの推奨量/目安量）を静的な参照テーブルとして実装し、ルックアップする — 権威ある一次情報をそのまま利用でき、決定論的かつ検証可能
- **Selected Approach**: 2の静的参照テーブル方式を採用する。データソースは「日本人の食事摂取基準」（厚生労働省）とし、対象栄養素はビタミンA・ビタミンD・ビタミンB1・ビタミンB2・ビタミンC・カルシウム・鉄・食物繊維・食塩相当量（上限）の9項目、区分は性別（男性/女性/回答しない）×年齢区分（18-29 / 30-49 / 50-64 / 65-74 / 75以上）とする
- **Rationale**: 決定論的な計算式を要件とする本specにおいて、独自の推定式より公的基準のルックアップの方が信頼性・説明可能性が高い。roadmapが食品成分DBについても「日本食品標準成分表」という公的一次データソースの使用を定めており、栄養素基準についても公的情報源を用いる方針と整合する
- **Trade-offs**: 参照テーブルの実データ（数値そのもの）は本spec設計時点では未転記であり、実装タスクとして公的資料から正確に転記する作業が必要（design.mdでは参照テーブルの構造とデータソースのみを定義し、具体的な数値は実装時に一次資料から転記する）
- **Follow-up**: 「回答しない」区分の基準値は、男性・女性の基準値のうち大きい方（より多くの摂取を推奨する方）を採用し、過小な目標設定を避ける

### Decision: ダイエットモードのガードレール抵触時の挙動
- **Context**: 要件10・11は、ガードレール抵触時に警告と修正提案を返すことを求めるが、算出済みの数値をどう扱うかが未確定
- **Alternatives Considered**:
  1. ガードレール抵触時、算出値を安全な値に自動的にクランプして返す — 利用者の意思決定を奪う
  2. 算出値はそのまま返しつつ、警告フラグと修正提案（期間延長案・目標体重緩和案）を付加情報として返す — 利用者が最終判断を行える
- **Selected Approach**: 2を採用する
- **Rationale**: 本アプリはシングルユーザーの意思決定支援ツールであり、危険な設定を検知して警告することが目的であって、利用者の入力を無断で書き換えることは要件11.3の意図（値を利用者の同意なく変更しない）に反する
- **Trade-offs**: 利用者が警告を無視して危険な値のまま突き進むことは可能だが、これはresults-dashboardでの警告表示（downstream）と運用上のUXで補う範囲であり、本specの責務外とする

### Decision: 体重推移分析・ゴールETA・停滞検知・運動併用シミュレーションの算出主体（追記）
- **Context**: `results-dashboard` のspec作成時、そのモックアップが要求するこれら4機能の算出主体が存在しないことが判明し、`results-dashboard` は一時的に自spec内に実装しつつ「フラグ付き決定」として本spec（`nutrition-engine`）への将来的な移管を申し送っていた（roadmap.mdは`results-dashboard`を表示専用の責務に限定しており、時系列トレンド分析のような導出処理を含めることは本来の境界と整合しない）
- **Alternatives Considered**:
  1. `results-dashboard` 側の実装（`DietInsightsService`）を維持する — roadmap.mdの「results-dashboardは表示専用」という境界方針に反したままになる。また体重<->カロリー換算定数（7700kcal/kg）を`nutrition-engine`と`results-dashboard`の両方で独立に保持する重複が残る
  2. `nutrition-engine` に移管する（本specが既に保持するBMR/TDEE/ダイエットモード逆算/ガードレール判定と同じ「体重・カロリードメインの決定論的計算」という性質を共有するため、自然な拡張として受け入れる） — `results-dashboard` の申し送り通りの対応であり、既存の`ENERGY_DENSITY_KCAL_PER_KG`・MET換算式をそのまま再利用でき重複を解消できる
- **Selected Approach**: 2を採用する。新規コンポーネント `DietInsightsCalculator` を追加し、新規エンドポイント `GET /api/nutrition/diet-insights` で提供する
- **Rationale**: 本specは既に「体重とカロリーの決定論的な相互変換」（`DietModeCalculator`のエネルギー収支換算、`GuardrailEvaluator`の減量ペース判定）を所有しており、体重ログの時系列トレンド分析・ゴールETA・停滞検知・運動併用シミュレーションはいずれもこの同じドメインの自然な拡張である。`results-dashboard`側に留めた場合に生じる定数の二重管理（Revalidation Triggers参照）も、算出主体を一本化することで解消される
- **Trade-offs**: 既に承認済みの本specを再オープンする（タスク実行前に想定されていなかった追加スコープ）が、`results-dashboard`側が最初から「フラグ付き決定」として移管を前提に設計していたため、インターフェース（体重ログ・目標体重・目標期間を入力とし、傾向・予測・停滞・シミュレーション結果を出力する）はほぼそのまま踏襲でき、移行コストは小さい
- **Follow-up**: `results-dashboard`の`design.md` / `tasks.md`が引き続き自spec内実装（`DietInsightsService`, `GET /api/dashboard/diet-insights`）を前提とした記述を残している場合、`results-dashboard`側を本spec（`GET /api/nutrition/diet-insights`）を呼び出す薄いクライアントに置き換えるフォローアップが別途必要になる（本amendmentのスコープ外、`results-dashboard`側の担当範囲）

### Decision: 喫煙・飲酒習慣の微量栄養素目標への反映方法（追記）
- **Context**: user-profileが収集する`smokingHabit`（吸わない/吸う）・`alcoholHabit`（しない/たまに/よく飲む）は、収集されているにもかかわらずどの計算にも使われていなかった。利用者から「本数・量の差は計算に影響しないのか」という指摘を受け、反映方針を検討した
- **Alternatives Considered**:
  1. 本数・量（1日の喫煙本数、週あたりの飲酒量等）を入力させ、量に比例した調整を行う — 喫煙本数・飲酒量と微量栄養素必要量の用量反応関係は、消費者向けアプリで責任を持って定量化できるほど確立されていない。入力負荷も増える
  2. 頻度区分（吸う/吸わない、しない/たまに/よく飲む）のみを入力とし、該当する場合に固定量を加算する — 「喫煙者はビタミンC必要量が増す」「慢性飲酒はビタミンB1（チアミン）欠乏のリスクを高める」という、比較的確立された定性的知見を、確立していない定量関係に踏み込まずに反映できる
- **Selected Approach**: 2を採用する。`smokingHabit === "smoker"`（UI表示「吸う」）でビタミンC目標に固定加算、`alcoholHabit === "frequent"`（UI表示「よく飲む」）でビタミンB1目標に固定加算する。「occasional」（たまに）は喫煙のような閾値的な健康影響の根拠が弱いため加算対象外とする
- **Rationale**: 微量栄養素目標は元々「目安」として算出されるものであり、精度の限界を偽らない範囲で、既存の参考文献（食事摂取基準等）と整合する定性的な調整に留めることが、ユーザーの実際の指摘（本数の違いが計算に活きていない）に対する誠実な対応になる
- **Trade-offs**: 本数・量の違いはなお計算に反映されない。将来的に用量反応関係の確立した知見が得られた場合、または飲酒による摂取カロリーそのものを日次ログで計上する機能を追加する場合は、本Decisionを再検討する
- **加算量の一次資料確認**: `SMOKING_VITAMIN_C_ADDITION_MG`・`HEAVY_DRINKING_VITAMIN_B1_ADDITION_MG`の具体的な数値は、微量栄養素参照テーブル（`micronutrient-reference.data.ts`）と同様、実装時に「日本人の食事摂取基準」等の一次資料を確認のうえ確定する（本research.mdでは値を断定しない）

## Risks & Mitigations
- 活動係数・PFC調整テーブル・ガードレール閾値はいずれも公的資料の代表値・中央値を採用した設計判断であり、医学的な個別最適化ではない — 本アプリはシングルユーザーの意思決定支援ツールであり診断・治療目的ではないことを前提とする。数値の妥当性はresults-dashboardでの表示時に「目安」であることを明示する運用が望ましい（本specのスコープ外の申し送り事項）
- 微量栄養素の参照テーブルの実データは設計時点で未転記であり、実装時の転記ミスがそのまま誤った目標値につながるリスクがある — 実装タスクで一次資料（厚生労働省公表資料）のURLと転記元テーブルを明記し、レビュー時に数値を照合する
- エネルギー収支換算定数（7700kcal/kg）は静的な近似値であり、長期間・大幅な減量では実際の収支と乖離しうる — v1の意図的な簡略化として明記し、将来的な動的モデル（NIH Hallモデル等）への置き換えは本spec範囲外の拡張候補とする
- user-profileの運動習慣データのスキーマ（`exercise_routine_entries`の列構成）が変更されると活動係数算出ロジックに影響する — user-profileのresearch.mdに記載された「Revalidation Triggers」と対になる形で、本specのdesign.mdにも同様の再検証トリガーを明記する
- `DietInsightsCalculator`の線形回帰は外れ値（測定誤差の大きい体重記録）に敏感である — 記録点数が少ない場合は傾向線・予測・停滞判定・運動併用シミュレーションを算出せずデータ不足として提示するフォールバック（要件14.5, 15.4, 16.5, 17.5）により、過度な誤解を避ける
- 本amendmentの時点で`results-dashboard`のdesign.md/tasks.mdは自spec内実装（`DietInsightsService`, `GET /api/dashboard/diet-insights`）を前提とした記述のままであり、本specへの移管に伴うresults-dashboard側の追従作業（本specのエンドポイントを呼び出す薄いクライアントへの置き換え）が別途必要になる — 本specのスコープ外のフォローアップ事項として明記する（Design Decisions参照）

## References
- [Mifflin St. Jeor Calculator - Inch Calculator](https://www.inchcalculator.com/mifflin-st-jeor-calculator/)
- [Mifflin-St Jeor Equation - Medscape/QxMD](https://reference.medscape.com/calculator/846/mifflin-st-jeor-equation)
- [Katch-McArdle Calculator - Omnicalculator](https://www.omnicalculator.com/health/bmr-katch-mcardle)
- [GQNS Mifflin St. Jeor Equation（性別回答なしのオフセット）](https://genquestnutrition.com/ree.htm)
- [Harris-Benedict Calculator - Inch Calculator](https://www.inchcalculator.com/harris-benedict-calculator/)
- [TDEE Activity Level Guide - FitnessVolt](https://fitnessvolt.com/tdee-calculator/activity-level-guide/)
- [FAO Human Energy Requirements Ch.5（PAL区分）](https://www.fao.org/4/y5686e/y5686e07.htm)
- [CDC Measuring Physical Activity Intensity（MET区分）](https://www.cdc.gov/physical-activity-basics/measuring/index.html)
- [How Do You Calculate Calories Burned During Exercise? - MedicineNet](https://www.medicinenet.com/how_to_calculate_calories_burned_during_exercise/article.htm)
- [CDC Steps for Losing Weight](https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html)
- [Harvard Health - realistic rate of weight loss](https://www.health.harvard.edu/weight-loss/what-does-a-healthy-realistic-rate-of-weight-loss-look-like-and-why-does-it-matter)
- [NHS Inform - Tips for losing weight safely](https://www.nhsinform.scot/healthy-living/weight-loss/tips-for-losing-weight-safely/)
- [NIDDK Body Weight Planner](https://www.niddk.nih.gov/bwp)
- [Mayo Clinic Calorie calculator](https://www.mayoclinic.org/healthy-lifestyle/weight-loss/in-depth/calorie-calculator/itt-20402304)
- [Energy Content of Weight Loss - PMC3810417](https://pmc.ncbi.nlm.nih.gov/articles/PMC3810417/)
- [厚生労働省 日本人の食事摂取基準（2025年版）策定検討会報告書](https://www.mhlw.go.jp/stf/newpage_44138.html)
- [日本人の食事摂取基準2020年版 改定のポイント - J-STAGE](https://www.jstage.jst.go.jp/article/cookeryscience/53/2/53_153/_pdf)
- [Best Macronutrient Ratio for Weight Loss - Healthline](https://www.healthline.com/nutrition/best-macronutrient-ratio)
