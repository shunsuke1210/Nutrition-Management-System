// ビルド後処理: `src/db/migrations/*.sql` を `dist/db/migrations/` へコピーする。
// tscはTypeScriptファイルのみをコンパイルし、.sqlファイルはdistへ出力されないため、
// マイグレーションランナー（dist/db/migrate.js）が実行時に見つけられるよう
// ここで明示的にコピーする。`npm run build -w server` の一部として実行される。
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(scriptDir, "..");
const sourceDir = path.join(packageRoot, "src", "db", "migrations");
const destinationDir = path.join(packageRoot, "dist", "db", "migrations");

if (!existsSync(sourceDir)) {
  throw new Error(`Migrations source directory not found: ${sourceDir}`);
}

mkdirSync(destinationDir, { recursive: true });
cpSync(sourceDir, destinationDir, { recursive: true });
