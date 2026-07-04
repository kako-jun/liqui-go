// 石の計算ルール = すべて足し算。これが本作の核。純粋関数のみ。
//
// 値モデル: 各交点は数値ひとつで表す。黒をプラス、白をマイナス。
//   +1   = 黒の1石（固まった構造物）
//   +0.5 = 黒の0.5石（まだ固まっていないセメント＝ポア済み）
//    0   = 空き
//   -0.5 = 白の0.5石
//   -1   = 白の1石
// 合法な着手のもとでは、結果は必ずこの5値に収まる。

import type { BoardSizeDef } from "./boardDef";
import { indexOf } from "./coords";

export type Player = "black" | "white";

/** 合法なセル値の集合 */
export const LEGAL_CELL_VALUES = [-1, -0.5, 0, 0.5, 1] as const;
export type CellValue = (typeof LEGAL_CELL_VALUES)[number];

export function isLegalCellValue(v: number): v is CellValue {
  return (LEGAL_CELL_VALUES as readonly number[]).includes(v);
}

/** 着手の種類 */
export type PlaceKind = "stone" | "pour"; // 1石を置く / 0.5石を流し込む（ポア）

/** プレイヤー × 着手種類 → 加算デルタ。黒+ / 白-、1石=1.0 / ポア=0.5 */
export function delta(player: Player, kind: PlaceKind): number {
  const magnitude = kind === "stone" ? 1 : 0.5;
  return player === "black" ? magnitude : -magnitude;
}

/**
 * 足し算の本体。current にデルタを足して結果セル値を返す。
 * 合法値域 [-1, 1] を超えたら設計エラー（その着手は禁手のはずなので、
 * 呼び出し側の合法手判定が漏れている）。
 */
export function resolveAdd(current: CellValue, d: number): CellValue {
  const next = current + d;
  if (!isLegalCellValue(next)) {
    throw new RangeError(
      `illegal add: ${current} + ${d} = ${next} (合法値域 {-1,-0.5,0,0.5,1} を外れた。禁手のはず)`,
    );
  }
  return next;
}

// 現象の命名（design.md 準拠）。表示・ログ・実況のためのラベル。
export type Phenomenon =
  | "place" // 空きに1石
  | "pour" // 空きに0.5（ポア）
  | "solidify" // 自分の0.5 + 自分の0.5 → 1石に確定（ソリディファイ）。ムーブ経由
  | "cancel" // 0.5 同士がぶつかって両方消える相殺（キャンセル）
  | "capture" // 1石 vs 1石 → 両消滅。同時着手経由
  | "reduce"; // 自分の1石が相手の0.5に削られて自分の0.5になる（1のまま残らない）

export interface Resolution {
  readonly after: CellValue;
  readonly phenomenon: Phenomenon;
}

/**
 * セル値 before に、ある着手/ムーブのデルタ d が重なったときの結果と現象名。
 *
 * ルールモデル（重要）: 石が触れ合う経路は2つだけ。
 *   ① 同時着手 — 両者が同じ「空き点」を同じターンに奪い合う（デルタが足し合わさる）
 *   ② ムーブ   — 0.5 が隣へ乗り込む（1石は動けない）
 * 既にある石へ直接「置きにいく」ことは無い。よって「相手の0.5の上に1石を置く」
 * （旧オーバーポア＝色奪い）は原理的に起こらず、ここでは例外として弾く。
 * 0.5 が相手の0.5とぶつかれば必ず相殺（cancel）。1石が0.5とぶつかれば必ず削れて
 * 0.5 になり、1石のまま残ることはない（reduce）。
 */
export function classify(before: CellValue, d: number): Resolution {
  const after = resolveAdd(before, d);
  const sameColor = Math.sign(before) === Math.sign(d);
  const isStone = Math.abs(d) === 1;

  // 空きへの着手
  if (before === 0) {
    return { after, phenomenon: isStone ? "place" : "pour" };
  }

  // 同色が重なる（自分の0.5に自分の0.5がムーブで乗る）→ ソリディファイ。
  // 自分の1石への重ねは禁手で、resolveAdd が先に弾く。
  if (sameColor) {
    return { after, phenomenon: "solidify" };
  }

  // 異色の衝突。
  if (Math.abs(before) === 1) {
    // 自分の1石に、相手の 1石（同時着手）→ 相打ち / 相手の 0.5 → 削れて自分の0.5
    return { after, phenomenon: isStone ? "capture" : "reduce" };
  }
  // 相手の0.5との衝突。
  if (isStone) {
    // 0.5 の上に 1石 は起こり得ない（1は動けず、同時着手は空き点限定）。
    throw new RangeError(
      `0.5(${before}) に 1石(${d}) は衝突しない（1は動けない・同時着手は空き点のみ）`,
    );
  }
  return { after, phenomenon: "cancel" }; // 0.5 同士 → 相殺
}

/**
 * 同点同時着手（ルール①）の解決。空きセルに黒(+)・白(-)の両デルタを同時加算する。
 * dBlack>0（+1 か +0.5）, dWhite<0（-1 か -0.5）を前提。足し算核: after = 0 + dBlack + dWhite。
 *
 * classify(before,d) は「単一デルタが既存セルに乗る」前提のため、黒ポア(0.5)＋白石(-1)
 * を「0.5 の上に 1 石」と誤判定して throw する。同時着手は空きセルへの両デルタ同時加算
 * という別経路なので、判定を混ぜず専用にここで解く。値域検証は resolveAdd に委ねる。
 */
export function classifySimultaneous(dBlack: number, dWhite: number): Resolution {
  if (!(dBlack > 0 && dWhite < 0)) {
    throw new RangeError(
      `classifySimultaneous は dBlack>0 かつ dWhite<0 を前提とする（黒+ / 白-）。received dBlack=${dBlack}, dWhite=${dWhite}`,
    );
  }
  // 足し算の核を経由して合法値域を検証（空き 0 に両デルタを同時加算）。
  const after = resolveAdd(0, dBlack + dWhite);
  const bothStone = Math.abs(dBlack) === 1 && Math.abs(dWhite) === 1;
  const bothPour = Math.abs(dBlack) === 0.5 && Math.abs(dWhite) === 0.5;
  let phenomenon: Phenomenon;
  if (bothStone) {
    phenomenon = "capture"; // 1石 vs 1石 → 相討ち（after 0）
  } else if (bothPour) {
    phenomenon = "cancel"; // 0.5 vs 0.5 → 相殺（after 0）
  } else {
    phenomenon = "reduce"; // 片方 stone・片方 pour → ±0.5 が残る
  }
  return { after, phenomenon };
}

/**
 * 盤面 cells のクローンに1手を適用する（純粋）。state は変更しない。
 * 合法手判定（コウ・連続配置禁止など）は呼び出し側の責務。ここは足し算だけ。
 */
export function applyPlacement(
  def: BoardSizeDef,
  cells: readonly number[],
  x: number,
  y: number,
  player: Player,
  kind: PlaceKind,
): { cells: number[]; resolution: Resolution } {
  const i = indexOf(def, x, y);
  const before = cells[i];
  if (!isLegalCellValue(before)) {
    throw new RangeError(`cell ${i} に不正値 ${before}`);
  }
  const resolution = classify(before, delta(player, kind));
  const next = cells.slice();
  next[i] = resolution.after;
  return { cells: next, resolution };
}
