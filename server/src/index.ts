/**
 * `@nutrition/server` エントリポイント。
 *
 * SQLiteコネクションの確立・起動時マイグレーションの適用・Fastifyアプリの起動を行う。
 * `resolvePort` / `resolveDbPath` / `startServer` は環境変数マップを明示的な引数として
 * 受け取れるようにしており、テストが `process.env` を汚染せずに検証できるようにしている
 * （本番実行時はデフォルト引数 `process.env` が使われる）。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp, registerRoutes } from "./app.js";
import { closeConnection, getConnection } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { createProfileRepository } from "./profile/profile.repository.js";
import { createProfileService } from "./profile/profile.service.js";
import { createDailyLogRepository } from "./daily-log/daily-log.repository.js";
import { createDailyLogService } from "./daily-log/daily-log.service.js";
import { createProfileGateway } from "./nutrition/profile.gateway.js";
import { createDailyLogGateway } from "./nutrition/daily-log.gateway.js";
import { createNutritionService } from "./nutrition/nutrition.service.js";
import { registerStaticFrontend } from "./static-frontend.js";
import { createFoodCompositionRepository } from "./menu-generation/food-composition.repository.js";
import { createUnitConversionService } from "./menu-generation/unit-conversion.service.js";
import { createMenuPlanRepository } from "./menu-generation/menu-plan.repository.js";
import { createRecipeDetailRepository } from "./menu-generation/recipe-detail.repository.js";
import { createFeedbackRepository } from "./menu-generation/feedback.repository.js";
import { createNutritionVerificationService } from "./menu-generation/nutrition-verification.service.js";
// task 17.5（menu-generation NO-GO是正、非AIモードへの切り替え）以降、以下の2つの
// import（`ClaudeMenuClient`/`ClaudeMenuGenerator`）は`startServer`内で現在使用していない
// （下記`menuGenerator`構築部のコメント参照）。`@anthropic-ai/sdk`をベースにしたClaude版
// `MenuGenerator`実装自体は将来の切替を容易にするため削除せず残しており、それに伴い
// このimport自体も残置している。
import { createClaudeMenuClient } from "./menu-generation/claude-menu.client.js";
import { createClaudeMenuGenerator } from "./menu-generation/claude-menu.generator.js";
import { createRuleBasedMenuGenerator } from "./menu-generation/rule-based-menu.generator.js";
// menu-generationは`nutrition/profile.gateway.ts`/`nutrition/nutrition.gateway.ts`とは別モジュールの
// 独自Gateway実装を持つ（同名エクスポートだが別ファイル・別用途）ため、上記のnutrition用importと
// 衝突しないようエイリアスする。
import { createProfileGateway as createMenuProfileGateway } from "./menu-generation/profile.gateway.js";
import { createNutritionGateway as createMenuNutritionGateway } from "./menu-generation/nutrition.gateway.js";
import { createPlannedCalorieGateway } from "./menu-generation/planned-calorie.gateway.js";
import { createFeedbackService } from "./menu-generation/feedback.service.js";
import { createMenuPlanService } from "./menu-generation/menu-plan.service.js";
import { createRecipeDetailService } from "./menu-generation/recipe-detail.service.js";
import { createShoppingListService } from "./menu-generation/shopping-list.service.js";
import { createEatingOutSuggestionService } from "./menu-generation/eating-out-suggestion.service.js";

const DEFAULT_PORT = 3000;

/**
 * このモジュール（ビルド後は `server/dist/index.js`、開発時は `tsx` 経由で
 * `server/src/index.ts` を直接実行）から見た `web/dist` への相対パス。
 * `server/dist/index.js` と `server/src/index.ts` はいずれもリポジトリルートから
 * 同じ深さ（`server/<1階層>/index.*`）にあるため、開発・本番のどちらでも
 * `../../web/dist` は同じ結果（`<repoRoot>/web/dist`）を指す。
 */
function defaultWebDistPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(moduleDir, "..", "..", "web", "dist");
}

/**
 * `PORT` 環境変数からリッスンポートを解決する。
 * 未設定・空文字・整数として解釈できない値・範囲外（0-65535外）の場合は既定値3000を使う。
 * `0` は有効な指定として扱う（OSに空きポートを割り当てさせる用途）。
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT;
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : DEFAULT_PORT;
}

/**
 * `NUTRITION_DB_PATH` 環境変数からSQLiteファイルのパスを解決する。
 * 未設定の場合は `<cwd>/data/nutrition.db` を使う。
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.NUTRITION_DB_PATH ?? path.join(process.cwd(), "data", "nutrition.db");
}

/**
 * ビルド済みフロントエンド（`web/dist`）の配信元ディレクトリを解決する。
 * `NUTRITION_WEB_DIST_PATH` 環境変数が設定されていればそれを使う（テストが一時ディレクトリを
 * 指し示せるようにするため。`resolveDbPath`/`NUTRITION_DB_PATH` と同じ方針）。未設定の場合は
 * このモジュールの位置から `web/dist` を解決する（`defaultWebDistPath` 参照）。
 */
export function resolveWebDistPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.NUTRITION_WEB_DIST_PATH ?? defaultWebDistPath();
}

/**
 * `ANTHROPIC_API_KEY` 環境変数の設定有無を確認する。
 *
 * task 1.5（menu-generation spec、Claude API連携の基盤設定）で追加した当初は、実際にClaude API
 * を呼び出す`ClaudeMenuGenerator`を`menuGenerator`として使用していたため、未設定
 * （`undefined`または空文字）の場合は起動ログへ`console.warn`で警告を出していた
 * （「このキーを設定するまで献立生成機能は利用できない」という趣旨）。
 *
 * task 17.5（menu-generation NO-GO是正2回目、非AIモードへの切り替え）で、`startServer`が構築する
 * `menuGenerator`をAIを一切使わない`RuleBasedMenuGenerator`（下記`startServer`内のコメント参照）
 * へ切り替えた。これにより`ANTHROPIC_API_KEY`の設定有無はこのアプリの献立生成機能の可否に
 * 一切影響しなくなった（設定してもしなくても`RuleBasedMenuGenerator`は同じように動く）ため、
 * 以前と同じ文言の「警告」を出し続けるのは不適切（本来気にする必要のない運用者に不要な不安を
 * 与える）と判断し、未設定時のみ`console.warn`ではなく`console.info`で
 * 「非AIモードのため設定不要」という趣旨の情報メッセージへ変更した。設定されている場合
 * （それ自体は無害かつ現状無関係なため）は何も出力しない。
 *
 * `resolvePort` / `resolveDbPath` / `resolveWebDistPath`と同様、この関数自体が例外を投げることは
 * ない。`@anthropic-ai/sdk`への依存自体（`package.json`）や`ClaudeMenuClient`/
 * `ClaudeMenuGenerator`の実装は、将来Claude版へ切り替える可能性を考慮して削除していない
 * （`startServer`内「Claude版 MenuGenerator」コメント参照）。
 */
export function checkAnthropicApiKeyConfigured(env: NodeJS.ProcessEnv = process.env): void {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    console.info(
      "[menu-generation] 本アプリは非AIモード（RuleBasedMenuGenerator）で動作するため、" +
        "ANTHROPIC_API_KEY の設定は不要です。",
    );
  }
}

/**
 * 共有SQLiteコネクション（`db/connection.ts` の `getConnection` シングルトン）を確立して
 * マイグレーションを適用し、共通エラーハンドラ設定済みのFastifyアプリを起動する。
 *
 * アプリが `close()` されたとき（テストの後片付け・プロセス終了時のグレースフルシャットダウン）に
 * 共有コネクションも確実に閉じるよう、`onClose` フックで `closeConnection()` を呼び出す。
 * これによりファイルハンドルが残留せず、後続の `startServer` 呼び出しが別のDBパスで
 * 新しいコネクションを確立できる。
 *
 * 呼び出し元（テスト含む）が起動後のアプリを `close()` できるよう、
 * リッスン中の `FastifyInstance` を返す。
 *
 * task 6.1 で `ProfileController` / `DailyLogController` の配線を追加した:
 * `buildApp()` はroute-agnosticのままにし（`app.ts` のコメント参照）、共有DBコネクションから
 * Repository→Serviceのチェーンをここで構築して `registerRoutes()`（`app.ts`）に渡す。
 * task 4.2 で `NutritionController` の配線を追加した: 新たに `ProfileRepository`/
 * `DailyLogRepository`/`ProfileService`/`DailyLogService` を構築するのではなく、直上で
 * 構築済みの `profileService`/`dailyLogService` インスタンスをそのまま `createProfileGateway`/
 * `createDailyLogGateway`（`nutrition/profile.gateway.ts` / `nutrition/daily-log.gateway.ts`）に
 * 渡して `ProfileGateway`/`DailyLogGateway` を得て、`createNutritionService`
 * （`nutrition/nutrition.service.ts`）で `NutritionService` を組み立て、`registerRoutes()`
 * に渡す（design.md File Structure Plan「`app.ts`: nutrition ルートの登録を追加」）。
 * 同一のDBコネクション・同一のService/Repositoryインスタンスを共有するため、プロフィール/
 * 日次ログAPIと栄養計算APIが同じデータを参照することが保証される。
 * 続けて `registerStaticFrontend()`（`static-frontend.ts`）でビルド済みフロントエンド
 * （`web/dist`）を静的配信する。`web/dist` が存在しない開発コンテキストでは
 * `registerStaticFrontend` が静かに何も登録しないため、API専用サーバーとして問題なく動作する
 * （ローカル開発では `npm run dev:web` のVite開発サーバーが `web/vite.config.ts` の
 * `server.proxy` 経由でこのAPIサーバーへ `/api` をプロキシする想定）。
 */
export async function startServer(env: NodeJS.ProcessEnv = process.env): Promise<FastifyInstance> {
  checkAnthropicApiKeyConfigured(env);

  const db = getConnection(resolveDbPath(env));
  runMigrations(db);

  const app = buildApp();
  app.addHook("onClose", async () => {
    closeConnection();
  });

  const profileService = createProfileService(createProfileRepository(db));
  const dailyLogService = createDailyLogService(createDailyLogRepository(db));

  const profileGateway = createProfileGateway(profileService);
  const dailyLogGateway = createDailyLogGateway(dailyLogService);
  const nutritionService = createNutritionService(profileGateway, dailyLogGateway);

  // task 15.1（menu-generation NO-GO是正 1回目）: menu-generationの5 Service
  // （MenuPlanService/ShoppingListService/RecipeDetailService/FeedbackService/
  // EatingOutSuggestionService）とその依存グラフをここで実際に構築し、下の registerRoutes() へ
  // 渡す。task 9.3/10.2/13.1/13.3/13.6 の時点ではこの配線を担当する専用タスクが
  // tasks.md上に存在しなかったため `AppRouteDependencies` の該当5フィールドはoptionalのまま
  // 据え置かれていた（`app.ts` のコメント参照）。ここでは`profileGateway`/`dailyLogGateway`とは
  // 別の、menu-generation自身のGateway実装（`menu-generation/profile.gateway.ts` /
  // `nutrition.gateway.ts` / `planned-calorie.gateway.ts`）に、直上で構築済みの
  // `profileService`/`nutritionService`/`dailyLogService` をそのまま渡して再利用する
  // （`profileService`/`dailyLogService`/`nutritionService`自体を作り直さない）。
  const foodCompositionRepository = createFoodCompositionRepository(db);
  const unitConversionService = createUnitConversionService(foodCompositionRepository);
  const menuPlanRepository = createMenuPlanRepository(db, unitConversionService);
  const recipeDetailRepository = createRecipeDetailRepository(db, unitConversionService);
  const feedbackRepository = createFeedbackRepository(db);
  const nutritionVerificationService = createNutritionVerificationService(
    foodCompositionRepository,
    unitConversionService,
  );
  // --- Claude版 MenuGenerator（現在未使用。将来Claude版へ切り替える場合はここのコメントを
  // 解除し、下の`createRuleBasedMenuGenerator`行を削除/コメントアウトする）---
  // 第2引数（Anthropic SDKクライアント）は省略し、`claude-menu.client.ts`のデフォルト引数
  // （`new Anthropic()`）に委ねる想定だった。`ANTHROPIC_API_KEY`未設定時の挙動は
  // `checkAnthropicApiKeyConfigured`（上記）が情報メッセージを出すのみで、例外にはしない。
  // const claudeMenuClient = createClaudeMenuClient(foodCompositionRepository);
  // const menuGenerator = createClaudeMenuGenerator(claudeMenuClient);

  // `MenuGenerator`（task 17.1）: `MenuPlanService`/`RecipeDetailService`は献立生成の内部実装
  // （プロンプト構築+Claude呼び出し、あるいはルールベース選定のいずれか）を知らず、この
  // `MenuGenerator`アダプタ経由でのみ献立生成を行う。
  // task 17.5（menu-generation NO-GO是正2回目）: `ANTHROPIC_API_KEY`を一切必要としないよう、
  // AIを使わない`RuleBasedMenuGenerator`（`rule-based-menu.generator.ts`）をデフォルト採用する。
  // `random`は省略し既定の`Math.random`に委ねる（決定論的な選定が必要なテストのみ`random`を
  // 注入する、`rule-based-menu.generator.ts`冒頭コメント「決定論的テスト容易性について」参照）。
  const menuGenerator = createRuleBasedMenuGenerator({ foodCompositionRepository });

  const menuProfileGateway = createMenuProfileGateway(profileService);
  const menuNutritionGateway = createMenuNutritionGateway(nutritionService);
  const plannedCalorieGateway = createPlannedCalorieGateway(dailyLogService);

  const feedbackService = createFeedbackService(feedbackRepository, menuPlanRepository);

  const menuPlanService = createMenuPlanService({
    profileGateway: menuProfileGateway,
    nutritionGateway: menuNutritionGateway,
    plannedCalorieGateway,
    feedbackService,
    menuGenerator,
    nutritionVerificationService,
    menuPlanRepository,
  });

  const recipeDetailService = createRecipeDetailService({
    menuPlanRepository,
    profileGateway: menuProfileGateway,
    menuGenerator,
    nutritionVerificationService,
    recipeDetailRepository,
    foodCompositionRepository,
  });

  const shoppingListService = createShoppingListService(
    menuPlanRepository,
    foodCompositionRepository,
    unitConversionService,
  );

  const eatingOutSuggestionService = createEatingOutSuggestionService(
    menuPlanRepository,
    menuProfileGateway,
  );

  registerRoutes(app, {
    profileService,
    dailyLogService,
    nutritionService,
    menuPlanService,
    shoppingListService,
    recipeDetailService,
    feedbackService,
    eatingOutSuggestionService,
  });
  registerStaticFrontend(app, resolveWebDistPath(env));

  await app.listen({ port: resolvePort(env), host: "0.0.0.0" });
  return app;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
