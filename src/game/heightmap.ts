// 確定度スコアリング → heightmap（純粋・render 非依存）。Three.js / DOM を一切 import しない。
//
// 液体地形の土台（#5）。盤上の石が作る「影響場（influence field）」から、
// 各交点の派生量を算出する。核となる約束: **高さ＝係争度（未確定さ）**。
//   - 決着した地（片色が支配し、かつ石の効きが強い）＝ 海抜0の静かな池（height≈0）
//   - 係争中（拮抗、または石が遠くて未確定）＝ 盛り上がって波立つ（height≈1）
//
// 影響場は各石からの指数減衰カーネル w = exp(-dist / LAMBDA) を黒白別に積む。
//   dominance = |pos - neg| / total   … 片色支配=1 / 拮抗=0（どちらの色が優勢かの確からしさ）
//   presence  = 1 - exp(-total / T0)   … 効きの総量。石から遠い点=0（そもそも誰の効きも届かない）
//   settled   = dominance * presence   … 「片色が」かつ「しっかり」効いている度合い＝確定度
//   height    = 1 - settled            … 確定度の裏返し＝係争度
//
// 純粋関数のみ。Math.random / Date / 時刻・乱数・副作用なし。入力 cells は読むだけで変更しない。
// 同じ cells なら常に同じ結果。9/13/19 路のどれでも NaN/Infinity を出さない（total=0 をガード）。
import type { BoardSizeDef } from "./boardDef";
import { pointCount, fromIndex } from "./coords";

/**
 * 影響の減衰長（交点間隔=1 を単位長とする）。盤サイズ非依存の素の値。
 * dist=LAMBDA で寄与が 1/e（≈0.37）に減る。値を上げるほど遠くの石まで効く。
 */
const LAMBDA = 2.5;

/**
 * presence の基準効き量。total=T0 で presence=1-1/e（≈0.63）になる。
 * 1石=mag1 のとき自点（dist=0, w=1）で total=1 → presence≈0.63 になる基準（T0=1.0）。
 * 0.5石なら自点 total=0.5 で presence≈0.39 と下がる（total は mag に線形）。
 */
const T0 = 1.0;

export interface HeightField {
  /** def.lines をそのまま（下流が盤サイズを引き回さずに済むよう同梱） */
  lines: number;
  /** 各点 [-1,1]: +黒 / -白（水の着色用）。length = pointCount(def) */
  ownership: number[];
  /** 各点 [0,1]: 0=凪の確定地 / 1=荒れる係争地。length = pointCount(def) */
  height: number[];
  /** 各点 total（デバッグ／強度用）。length = pointCount(def) */
  pressure: number[];
}

/**
 * 盤面 cells から確定度 heightmap を算出する純粋関数。
 * 各交点について、盤上の全石からの指数減衰寄与を黒白別に積み、
 * dominance × presence で確定度 settled を出し、height = 1 - settled とする。
 *
 * 前提: `cells.length === pointCount(def)`（GameState が保証する）。
 * 前提外の短い配列を渡すと `cells[j]` が undefined になり `Math.abs(undefined)=NaN`
 * が全派生量へ伝播する。緩さ優先で防御コードは足さない（前提明記のみ）。
 */
export function computeHeightField(def: BoardSizeDef, cells: number[]): HeightField {
  const n = pointCount(def);

  const ownership = new Array<number>(n).fill(0);
  const height = new Array<number>(n).fill(0);
  const pressure = new Array<number>(n).fill(0);

  // 盤上の石だけを事前抽出（空点を毎回走査しないため）。
  const stones: { sx: number; sy: number; mag: number; sign: number }[] = [];
  for (let j = 0; j < n; j++) {
    const v = cells[j];
    if (v === 0) continue;
    const s = fromIndex(def, j);
    stones.push({ sx: s.x, sy: s.y, mag: Math.abs(v), sign: v > 0 ? 1 : -1 });
  }

  for (let i = 0; i < n; i++) {
    const p = fromIndex(def, i);
    let pos = 0; // 黒（+）からの寄与総和
    let neg = 0; // 白（−）からの寄与総和

    for (const st of stones) {
      // 石自身（j===i）は dist=0, w=1 で強い源になる。除外しない。
      const dist = Math.hypot(p.x - st.sx, p.y - st.sy);
      const w = Math.exp(-dist / LAMBDA);
      if (st.sign > 0) pos += st.mag * w;
      else neg += st.mag * w;
    }

    const total = pos + neg;
    // total=0 のガード（石が無い盤・全空点）。ゼロ除算で NaN を出さない。
    const dominance = total > 0 ? Math.abs(pos - neg) / total : 0;
    const presence = 1 - Math.exp(-total / T0);
    const settled = dominance * presence;

    height[i] = 1 - settled; // [0,1]
    ownership[i] = total > 0 ? (pos - neg) / total : 0; // [-1,1]
    pressure[i] = total;
  }

  return { lines: def.lines, ownership, height, pressure };
}
