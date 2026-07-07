// 取得済みの地（territory）の純粋計算。Three.js / DOM を一切 import しない（render 非依存）。
//
// 世界観（design.md）: 石＝柵（境界線）。一色の柵で「囲い切った」空領域＝その色の取得済みの地
// （＝水が溜まる）。囲いが一色でない（両色に接する）・囲いが無い（石に一つも接しない＝空盤や
// 盤端だけに面する）＝中立（水が流れ出て乾く）。盤端は壁扱い（領域の境界だが色は持たない）。
//
// これは囲碁の「地」判定と同じ: 空点を直交連結でフラッドフィルし、その領域に直交隣接する石の
// 色が一色ならその色の地。足し算モデル（旧 heightmap の効きの影響場＝誤モデル #5）は使わない。
import type { BoardSizeDef } from "./boardDef";
import { RULES } from "./boardDef";
import { pointCount, fromIndex, indexOf, inBounds } from "./coords";

/** 直交4近傍（フラッドフィルと隣接石の走査に使う）。 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 盤面 cells から取得済みの地と、その地の不安定さを算出する（純粋・非破壊・決定論）。
 *
 * territory[i]:
 * - 石セル（cells[i]≠0）: 0（柵の上に水は乗らない）。
 * - 空点: それを含む直交連結の空領域が接する石の色が…
 *   ・全て黒（+）→ +1（黒の地）／全て白（−）→ −1（白の地）
 *   ・両色に接する、または石に一つも接しない（盤端だけに面する・空盤含む）→ 0（中立＝乾く）
 *
 * instability[i] ∈ [0,1]:
 * - 取得済みの地（territory≠0）: その領域を囲う石のうち 0.5 石（|v|=0.5＝柔らかい柵）が占める割合。
 *   全部1石（硬い柵）→ 0（確定＝安定＝海抜0の凪の池）。0.5石が混ざるほど→1（今にも流れ出す高い地）。
 *   同じ石が複数の空点から接しても石は1個として数える（領域に隣接する“石の集合”に対する割合）。
 * - 非territory・石セル: 0。
 *
 * 石の値は絶対値でなく符号だけを見る（1石も0.5石も同色の壁として囲いに寄与する）。
 */
export function computeTerritory(
  def: BoardSizeDef,
  cells: number[],
): { territory: number[]; instability: number[] } {
  const n = pointCount(def);
  const territory = new Array<number>(n).fill(0);
  const instability = new Array<number>(n).fill(0);
  const visited = new Array<boolean>(n).fill(false);

  for (let start = 0; start < n; start++) {
    // 石セルと訪問済みは飛ばす。空点だけが領域の起点になる。
    if (visited[start] || cells[start] !== 0) continue;

    // 空領域を集めつつ、接する石の色と「囲う石の集合」を集計する（DFS。順序に依存しない）。
    const region: number[] = [];
    let touchesBlack = false;
    let touchesWhite = false;
    const wallStones = new Set<number>(); // 領域に直交隣接する石の index（重複は Set で1個に）
    const stack: number[] = [start];
    visited[start] = true;

    while (stack.length > 0) {
      const cur = stack.pop()!;
      region.push(cur);
      const { x, y } = fromIndex(def, cur);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(def, nx, ny)) continue; // 盤端＝壁（色を持たない・領域の境界）
        const ni = indexOf(def, nx, ny);
        const nv = cells[ni];
        if (nv === 0) {
          // 隣も空点なら領域に取り込む（空点だけ訪問管理する）。
          if (!visited[ni]) {
            visited[ni] = true;
            stack.push(ni);
          }
        } else {
          wallStones.add(ni); // 領域を囲う石として記録（不安定さの母数）
          if (nv > 0) touchesBlack = true; // 黒（+1 / +0.5）の柵に接する
          else touchesWhite = true; // 白（−1 / −0.5）の柵に接する
        }
      }
    }

    // 一色の柵だけに囲われていればその色の地。両色 or 無接触は中立（0 のまま）。
    let owner = 0;
    if (touchesBlack && !touchesWhite) owner = 1;
    else if (touchesWhite && !touchesBlack) owner = -1;
    if (owner !== 0) {
      // 囲う石のうち 0.5 石が占める割合＝不安定さ（領域単位で1値・全セルに配る）。
      let half = 0;
      for (const si of wallStones) {
        if (Math.abs(cells[si]) === 0.5) half++;
      }
      const inst = wallStones.size > 0 ? half / wallStones.size : 0;
      for (const idx of region) {
        territory[idx] = owner;
        instability[idx] = inst;
      }
    }
  }

  return { territory, instability };
}

/**
 * 取得済みの地の体積をスコア（m³）として集計する（純粋・非破壊・決定論）。
 * design.md「デジタルならではの解決」: 水量(m³)＝取得済みの地＝スコア・1マス=1m³。
 * computeTerritory の territory を数え、各色のセル数 × RULES.cellCubicMeters を返す。
 */
export function computeScore(def: BoardSizeDef, cells: number[]): { black: number; white: number } {
  const { territory } = computeTerritory(def, cells);
  let blackCells = 0;
  let whiteCells = 0;
  for (const t of territory) {
    if (t === 1) blackCells++;
    else if (t === -1) whiteCells++;
  }
  return {
    black: blackCells * RULES.cellCubicMeters,
    white: whiteCells * RULES.cellCubicMeters,
  };
}
