import type { FastifyInstance } from "fastify";
import type { ProfileInput } from "@nutrition/shared";
import type { ProfileService } from "./profile.service.js";

/**
 * `/api/profile` のHTTPハンドリングを担う ProfileController
 * （design.md: Components and Interfaces > ProfileController、
 * System Flows > プロフィール保存フロー、API Contract > Profile）。
 *
 * - ControllerはHTTPの関心事のみを扱い、業務ルール（必須項目・レンジ検証・条件付き必須）は
 *   `ProfileService`（Service層）に閉じ込める（design.md: Architecture Integration > 境界順守）。
 * - `PUT /api/profile` の入力は生のJSONとしてそのまま `profileService.saveProfile` に渡す。
 *   Zodによる検証は `ProfileInputSchema` を通じてService層が行うため、Controllerは
 *   リクエストボディを `ProfileInput` として素通しするのみで再検証しない。
 * - `saveProfile` が `{ ok: false }` を返した場合は `ValidationError` を `throw` し、
 *   `app.ts` の共通エラーハンドラ（`setErrorHandler`）にHTTP 400への変換を委ねる
 *   （`server/src/app.test.ts` が示す「Controllerはエラー値をthrowする」という規約に合わせる）。
 * - 認証・認可のチェックは一切行わない（Req 12.1, 12.2, 12.3）。
 *
 * `buildApp()`（`server/src/app.ts`）自体はまだこのルートを登録しない
 * （task 6.1 の責務）ため、呼び出し側が明示的にこの関数を呼んで登録する必要がある。
 */
export function registerProfileRoutes(app: FastifyInstance, profileService: ProfileService): void {
  app.get("/api/profile", () => {
    return profileService.getProfile();
  });

  app.put("/api/profile", (request) => {
    const input = request.body as ProfileInput;
    const result = profileService.saveProfile(input);

    if (!result.ok) {
      throw result.error;
    }

    return result.value;
  });
}
