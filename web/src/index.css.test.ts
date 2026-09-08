/**
 * results-dashboard spec task 9.3（レスポンシブ表示のE2E確認）用の構造的検証テスト。
 *
 * tasks.md task 9.3のコメント参照: このリポジトリにはPlaywright/Cypress等、ブラウザ幅を実際に
 * 変えてレンダリング結果を検証できる自動化ツールが存在せず、また `vite.config.ts` の
 * `test.environment: "jsdom"` はCSSレイアウトを実際に計算・描画しない（要素の`offsetWidth`等は
 * 常に0を返す）。そのため本テストは、要件17.3/17.4を満たすために必要なCSSの記述が
 * `web/src/index.css`（task 7.3）のソーステキスト上に実在すること、およびそれが実際に
 * `main.tsx` からimportされ生きた依存として配線されていることを、文字列レベルで構造的に
 * 確認するに留まる。実際のブラウザにおけるレイアウト崩れの有無・横スクロール切替の視覚的な
 * 確認は本テストの対象外であり、task 7.3の完了条件として `npm run dev -w web` でデスクトップ幅・
 * スマートフォン幅（~375px）の両方が目視確認済みであることを前提とする（本テストではそれを
 * 再証明しない・していない）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `new URL("./x", import.meta.url)` は書かない: Viteはこの構文パターンを静的に検出して
// アセットURLインポートへ変換してしまい（dev server上のURL文字列に化ける）、Node実行時の
// 実ファイルパスとして機能しなくなる。`fileURLToPath` + `path.join` で迂回する。
const currentDir = dirname(fileURLToPath(import.meta.url));
const cssPath = join(currentDir, "index.css");
const mainPath = join(currentDir, "main.tsx");

const css = readFileSync(cssPath, "utf-8");
const mainSource = readFileSync(mainPath, "utf-8");

/**
 * 指定したセレクタ単体の宣言ブロックの中身を返す（セレクタ直後に空白以外のトークンを
 * 挟まず `{` が続く箇所のみを対象とする）。`.day-col` に対して子孫セレクタ
 * `.day-col .day-head`、`.week-scroll` に対して修飾セレクタ `.week-scroll-actions` を
 * 誤って拾わないようにするための最小限のガード（本格的なCSSパーサは導入しない）。
 */
function extractRuleBlock(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w.-])${escaped}\\s*\\{([^}]*)\\}`);
  const match = pattern.exec(source);
  if (!match) {
    throw new Error(`index.css: standalone rule not found for selector "${selector}"`);
  }
  return match[1] ?? "";
}

describe("index.css (task 7.3) が実際にアプリへ配線されていること", () => {
  it("main.tsx が ./index.css をimportしている", () => {
    // 将来この行が誤って削除される回帰を検知するための最小限の配線確認。
    expect(mainSource).toMatch(/import\s+["']\.\/index\.css["']\s*;/);
  });
});

describe("要件17.4: 画面幅が1週間分の曜日カードを一列に収められない場合の横スクロール", () => {
  it(".week-scroll に overflow-x: auto|scroll が定義されている", () => {
    const block = extractRuleBlock(css, ".week-scroll");
    expect(block).toMatch(/overflow-x\s*:\s*(auto|scroll)\s*;/);
  });

  it(".day-col に固定幅（flex-basis または width/min-width）が定義されている", () => {
    const block = extractRuleBlock(css, ".day-col");
    const hasFixedFlexBasis = /flex\s*:\s*[\d.]+\s+[\d.]+\s+[\d.]+(px|rem|em)\s*;/.test(block);
    const hasFixedWidth = /\bwidth\s*:\s*[\d.]+(px|rem|em)\s*;/.test(block);
    const hasMinWidth = /\bmin-width\s*:\s*[\d.]+(px|rem|em)\s*;/.test(block);
    expect(hasFixedFlexBasis || hasFixedWidth || hasMinWidth).toBe(true);
  });
});

describe("要件17.3: デスクトップ幅とスマートフォン幅の両方で読み取り可能なレイアウト", () => {
  it("画面幅に応じたレイアウト調整のための @media (max-width) ルールが最低1つ存在する", () => {
    // 全メディアクエリを網羅的に検証するのではなく、「レスポンシブ調整が全く存在しない」
    // という退行を検知できれば足りる。
    const mediaMaxWidthRules = css.match(/@media\s*\([^)]*max-width[^)]*\)/g) ?? [];
    expect(mediaMaxWidthRules.length).toBeGreaterThanOrEqual(1);
  });
});
