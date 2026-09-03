import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { NotFoundError, ValidationError } from "./shared/result.js";
import { registerProfileRoutes } from "./profile/profile.routes.js";
import type { ProfileService } from "./profile/profile.service.js";
import { registerDailyLogRoutes } from "./daily-log/daily-log.routes.js";
import type { DailyLogService } from "./daily-log/daily-log.service.js";
import { registerNutritionRoutes } from "./nutrition/nutrition.routes.js";
import type { NutritionService } from "./nutrition/nutrition.service.js";
import { registerMenuPlanRoutes } from "./menu-generation/menu-plan.routes.js";
import type { MenuPlanService } from "./menu-generation/menu-plan.service.js";

function isValidationError(error: unknown): error is ValidationError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "validation"
  );
}

function isNotFoundError(error: unknown): error is NotFoundError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "not_found"
  );
}

/**
 * Fastifyアプリを構築するブートストラップ関数。
 *
 * - このタスク（1.4）の時点ではプロフィール/日次ログのルートはまだ存在しなかったため、
 *   `buildApp()` 自体は今もルートを一切登録しない（route-agnostic）。これは意図的な設計判断:
 *   `buildApp()` を単体でテスト可能に保つ（`app.test.ts` がルート依存を一切構築せずに
 *   共通エラーハンドラのみを検証できる）ため、task 6.1 でルート登録が可能になった後も
 *   `buildApp()` のシグネチャ・挙動は変更していない。
 * - ルート登録は本ファイルが公開する `registerRoutes()`（下記）が担う。呼び出し側
 *   （`index.ts`）は `buildApp()` で得た `FastifyInstance` に対し `registerRoutes(app, deps)`
 *   を呼び出すことでプロフィール/日次ログの両ルートを登録する。これにより
 *   `server/src/app.ts` が design.md の File Structure Plan が言う
 *   「Fastifyアプリのブートストラップ・ルート登録」の両方を担うファイルであるという位置づけを
 *   保ちつつ、`buildApp()` 自体は route-agnostic のままにしている。
 *   （もちろん Fastify標準の `app.register()` / `app.get()` 等を呼び出せばこれ以外の
 *   ルートモジュールも自由に追加登録できる。）
 * - `Result<T,E>` の `ValidationError` / `NotFoundError` をHTTPレスポンスへ変換する共通エラー
 *   ハンドラを設定する。Service層はこれらのエラー値を `Result` の `error` として返し、Controller層
 *   （task 2.3, 3.3）はそれを `throw` することでこのハンドラに変換を委ねる。
 *   - `ValidationError` → 400 + フィールド別エラー
 *   - `NotFoundError` → 404 + メッセージ
 *   - それ以外（インフラ障害等の予期しない例外）→ ログに詳細を記録した上で、詳細を漏らさない 500
 */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.setErrorHandler<ValidationError | NotFoundError | Error>((error, request, reply) => {
    if (isValidationError(error)) {
      reply.code(400).send({ type: "validation", fieldErrors: error.fieldErrors });
      return;
    }

    if (isNotFoundError(error)) {
      reply.code(404).send({ type: "not_found", message: error.message });
      return;
    }

    request.log.error(error);
    reply.code(500).send({ type: "internal", message: "Internal Server Error" });
  });

  return app;
}

/**
 * `registerRoutes()` が必要とするService依存（task 6.1で `profileService` /
 * `dailyLogService` が構築され、task 4.2で `nutritionService` が追加された。いずれも
 * `index.ts` から渡される）。
 *
 * `menuPlanService`（task 9.3で追加）は他の3フィールドと異なり任意（optional）とする:
 * `MenuPlanService`（`createMenuPlanService`）自身が要求する8つの依存
 * （`ProfileGateway`/`NutritionGateway`/`PlannedCalorieGateway`/`FeedbackService`/
 * `ClaudeMenuClient`/`NutritionVerificationService`/`MenuPlanRepository`）を実際のDB接続・
 * Claude APIクライアントで組み立てて `index.ts` の `startServer()` に配線する作業は、
 * design.mdのタスク分割上この task 9.3（`MenuPlanController` の境界）には含まれず、
 * `index.ts` 自体もこのタスクの変更対象外である（tasks.mdはこの配線を担う専用タスクを
 * まだ切り出していない）。必須（required）フィールドにすると `index.ts` の既存の
 * `registerRoutes(app, { profileService, dailyLogService, nutritionService })` 呼び出しが
 * 型エラーになり、`npm run build -w server` を壊してしまう。
 *
 * **これは既存3フィールド導入時の前例からの意図的な離脱であり、その繰り返しではない**:
 * `profileService`/`dailyLogService`（task 6.1）/`nutritionService`（task 4.2）はいずれも、
 * `AppRouteDependencies` への追加と `index.ts` での実配線が同一タスク・同一コミットで
 * 行われており、optionalな“後で配線する”フィールドとして導入された前例はない
 * （`git log`で各コミットを確認すれば分かる）。今回optionalにしたのは、tasks.mdが
 * `MenuPlanService` の8依存を `index.ts` に組み立てて配線する専用タスクをまだ割り当てて
 * いないという、このspec固有のタスク分割上の空白に対応するためであり、過去の規約に
 * 倣ったものではない。`menuPlanService` を実際に配線するタスクが `index.ts` にこのフィールドを
 * 渡すようになった時点で、このoptional指定を（他の3フィールドに揃えてrequiredへ戻すか、
 * そのまま残すか）見直すこと。
 */
export interface AppRouteDependencies {
  profileService: ProfileService;
  dailyLogService: DailyLogService;
  nutritionService: NutritionService;
  menuPlanService?: MenuPlanService;
}

/**
 * `ProfileController`（`registerProfileRoutes`, task 2.3）、`DailyLogController`
 * （`registerDailyLogRoutes`, task 3.3）、`NutritionController`
 * （`registerNutritionRoutes`, task 4.1）を `app` に登録する（design.md: Architecture の
 * `ProfileController`/`DailyLogController`/`NutritionController` が Fastify アプリに登録される図、
 * および File Structure Plan の `app.ts` = 「Fastifyアプリのブートストラップ・ルート登録」、
 * Modified Files: 「`nutrition.routes.ts` のルート登録を追加する（`profile.routes.ts` /
 * `daily-log.routes.ts` の登録と並列に追加するのみで、既存のプロフィール・日次ログの
 * ルーティングには変更を加えない）」）。
 *
 * 3つのルートモジュールはいずれも `buildApp()` の共通エラーハンドラ（`ValidationError` → 400,
 * `NotFoundError` → 404）を前提に実装されている（`profile.routes.ts` / `daily-log.routes.ts` /
 * `nutrition.routes.ts` のコメント参照）ため、本関数は `buildApp()` で構築済みのアプリに対して
 * 呼び出すことを想定する。`profile/**` / `daily-log/**` / `nutrition/**` の内部実装には
 * 一切触れず、それぞれの `register*Routes` を呼び出すだけの薄い配線層である
 * （既存の `registerProfileRoutes` / `registerDailyLogRoutes` の呼び出しは変更していない）。
 */
export function registerRoutes(app: FastifyInstance, deps: AppRouteDependencies): void {
  registerProfileRoutes(app, deps.profileService);
  registerDailyLogRoutes(app, deps.dailyLogService);
  registerNutritionRoutes(app, deps.nutritionService);
  if (deps.menuPlanService) {
    registerMenuPlanRoutes(app, deps.menuPlanService);
  }
}
