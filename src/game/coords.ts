// 交点の座標 ↔ 一次元インデックスの相互変換。純粋関数のみ（テスト可能）。
import type { BoardSizeDef } from "./boardDef";
import { RULES } from "./boardDef";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 交点の総数 */
export function pointCount(def: BoardSizeDef): number {
  return def.lines * def.lines;
}

/** (x, y) → cells 配列のインデックス */
export function indexOf(def: BoardSizeDef, x: number, y: number): number {
  return y * def.lines + x;
}

/** インデックス → (x, y) */
export function fromIndex(def: BoardSizeDef, i: number): Point {
  return { x: i % def.lines, y: Math.floor(i / def.lines) };
}

/** 盤内か */
export function inBounds(def: BoardSizeDef, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < def.lines && y < def.lines;
}

/** ムーブ可能な隣接点（チェビシェフ距離 1 ＝ 隣接8マス、ルール③） */
export function moveTargets(def: BoardSizeDef, x: number, y: number): Point[] {
  const r = RULES.moveRangeChebyshev;
  const out: Point[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(def, nx, ny)) out.push({ x: nx, y: ny });
    }
  }
  return out;
}
