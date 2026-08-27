/**
 * MicronutrientCalculator の静的参照データ（性別×年齢区分ごとの微量栄養素基準値）。
 *
 * design.md（`.kiro/specs/nutrition-engine/design.md`）の `MicronutrientCalculator`
 * セクション（Requirements 6.1, 6.2）が要求する9項目・5年齢区分×2性別の参照テーブル。
 * research.md の Design Decisions（「微量栄養素目標値の基準データ」）は数値そのものを
 * 断定せず「実データは実装時に一次資料から転記する」と明記しているため、本ファイルの
 * 数値は実装時に一次資料へ直接あたって転記したものである。
 *
 * 出典: 厚生労働省「日本人の食事摂取基準（2020年版）」（策定検討会報告書）の
 * 「主な推奨量・目安量・目標量」早見表（成人・18歳以上の各年齢区分）。本specの
 * research.md は後継の「日本人の食事摂取基準（2025年版）」（2024年に策定検討会が
 * 報告書を取りまとめ）にも言及しているが、2025年版の早見表PDFはテキスト抽出できる
 * 形式で取得できなかったため、実装時点で数値をテキストとして確認できた2020年版を
 * 転記した（食塩相当量の目標量については、2025年版時点でも成人男性7.5g未満・
 * 女性6.5g未満のまま変更されていないことを複数の2025年版解説記事で確認済み）。
 * 2025年版の早見表を後日テキスト化できた場合は、本ファイルの数値を再照合すること
 * （Risks & Mitigationsに記載の「実装時の転記ミス」リスクと同様、将来の版改定時にも
 * 再照合が必要）。
 *
 * 転記元（2020年版の数値をテキストとして確認したソース、厚生労働省公表資料からの抜粋）:
 * - エネルギー・たんぱく質・脂質・炭水化物・食物繊維: 越谷市が公開する「日本人の食事摂取基準
 *   （2020年版）」抜粋表（食物繊維の目標量）
 *   https://www.city.koshigaya.saitama.jp/kurashi_shisei/fukushi/hokenjo/eiyou/koshigaya_shokujisesshukijun_files_eiyousonadomeyasu.pdf
 * - ビタミン類（ビタミンA・D・B1・B2・C）: 同上PDF 2ページ目「ビタミンの食事摂取基準」表
 * - ミネラル類（カルシウム・鉄）・食塩相当量: 同上PDF 3ページ目「ミネラルの食事摂取基準」表
 * - 食塩相当量が2025年版でも維持されていることの確認: 2025年版に関する複数の解説記事
 *   （成人男性7.5g未満・女性6.5g未満、CKD/高血圧の重症化予防目標である6.0g未満とは別）
 *
 * 転記時の設計判断（鉄）: 「日本人の食事摂取基準」の鉄の推奨量は、女性について
 * 「月経なし」「月経あり（過多月経以外）」「月経あり（過多月経）」の3区分に分かれるが、
 * `ProfileSnapshot`（`user-profile`）は月経の状態を保持しないため、本テーブルは
 * 全年齢区分を通じて最も広く適用可能な「月経なし」の値を女性の推奨量として採用する。
 * これは月経のある女性利用者にとっては実際の必要量を過小評価しうる制約であり、
 * 将来 `user-profile` が月経情報を収集するようになった場合は本テーブルの女性の鉄の値を
 * 再検討する必要がある（本ファイルのCONCERNSとして記録）。
 */
import type { MicronutrientTargets } from "@nutrition/shared";

/** MicronutrientCalculator が扱う5段階の年齢区分（design.md #MicronutrientCalculator, Requirement 6.2）。 */
export type MicronutrientAgeBand = "18-29" | "30-49" | "50-64" | "65-74" | "75+";

/** `MICRONUTRIENT_REFERENCE_TABLE` の走査・テスト用に年齢区分を若い順で列挙したもの。 */
export const MICRONUTRIENT_AGE_BANDS: readonly MicronutrientAgeBand[] = [
  "18-29",
  "30-49",
  "50-64",
  "65-74",
  "75+",
];

type ReferenceSex = "male" | "female";

/**
 * 性別×年齢区分ごとの微量栄養素基準値（喫煙・飲酒による調整前の生値）。
 * 出典・転記方針は本ファイル冒頭のコメントを参照。
 */
export const MICRONUTRIENT_REFERENCE_TABLE: Readonly<
  Record<ReferenceSex, Readonly<Record<MicronutrientAgeBand, MicronutrientTargets>>>
> = {
  male: {
    "18-29": {
      vitaminAUg: 850,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.4,
      vitaminB2Mg: 1.6,
      vitaminCMg: 100,
      calciumMg: 800,
      ironMg: 7.5,
      fiberG: 21,
      saltEquivalentUpperLimitG: 7.5,
    },
    "30-49": {
      vitaminAUg: 900,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.4,
      vitaminB2Mg: 1.6,
      vitaminCMg: 100,
      calciumMg: 750,
      ironMg: 7.5,
      fiberG: 21,
      saltEquivalentUpperLimitG: 7.5,
    },
    "50-64": {
      vitaminAUg: 900,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.3,
      vitaminB2Mg: 1.5,
      vitaminCMg: 100,
      calciumMg: 750,
      ironMg: 7.5,
      fiberG: 21,
      saltEquivalentUpperLimitG: 7.5,
    },
    "65-74": {
      vitaminAUg: 850,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.3,
      vitaminB2Mg: 1.5,
      vitaminCMg: 100,
      calciumMg: 750,
      ironMg: 7.5,
      fiberG: 20,
      saltEquivalentUpperLimitG: 7.5,
    },
    "75+": {
      vitaminAUg: 800,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.2,
      vitaminB2Mg: 1.3,
      vitaminCMg: 100,
      calciumMg: 700,
      ironMg: 7.0,
      fiberG: 20,
      saltEquivalentUpperLimitG: 7.5,
    },
  },
  female: {
    "18-29": {
      vitaminAUg: 650,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.1,
      vitaminB2Mg: 1.2,
      vitaminCMg: 100,
      calciumMg: 650,
      ironMg: 6.5, // 月経なしの推奨量（本ファイル冒頭コメント参照）
      fiberG: 18,
      saltEquivalentUpperLimitG: 6.5,
    },
    "30-49": {
      vitaminAUg: 700,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.1,
      vitaminB2Mg: 1.2,
      vitaminCMg: 100,
      calciumMg: 650,
      ironMg: 6.5, // 月経なしの推奨量
      fiberG: 18,
      saltEquivalentUpperLimitG: 6.5,
    },
    "50-64": {
      vitaminAUg: 700,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.1,
      vitaminB2Mg: 1.2,
      vitaminCMg: 100,
      calciumMg: 650,
      ironMg: 6.5, // 月経なしの推奨量
      fiberG: 18,
      saltEquivalentUpperLimitG: 6.5,
    },
    "65-74": {
      vitaminAUg: 700,
      vitaminDUg: 8.5,
      vitaminB1Mg: 1.1,
      vitaminB2Mg: 1.2,
      vitaminCMg: 100,
      calciumMg: 650,
      ironMg: 6.0,
      fiberG: 17,
      saltEquivalentUpperLimitG: 6.5,
    },
    "75+": {
      vitaminAUg: 650,
      vitaminDUg: 8.5,
      vitaminB1Mg: 0.9,
      vitaminB2Mg: 1.0,
      vitaminCMg: 100,
      calciumMg: 600,
      ironMg: 6.0,
      fiberG: 17,
      saltEquivalentUpperLimitG: 6.5,
    },
  },
};
