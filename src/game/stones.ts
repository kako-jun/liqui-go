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

// 現象の命名（notes 準拠）。表示・ログ・実況のためのラベル。
export type Phenomenon =
  | "place" // 空きに1石
  | "pour" // 空きに0.5（ポア）
  | "solidify" // 自分の0.5 + 自分の0.5 → 1石に確定（ソリディファイ）
  | "break" // 0.5 同士の相殺 → 消滅（ブレイク）
  | "overpour" // 相手の0.5の上から流し込んで色を奪う（オーバーポア） ※下記 TODO
  | "capture" // 相手の1石に1石 → 両消滅
  | "reduce" // 相手の1石にポア → 相手の0.5へ削る
  | "intercept" // 相手の1石に自分の0.5が着地（ムーブ迎撃）→ 相手の0.5へ
  | "none";

export interface Resolution {
  readonly after: CellValue;
  readonly phenomenon: Phenomenon;
}

/**
 * (before, デルタ) から結果値と現象名を求める。
 *
 * TODO(design): notes「石の計算ルール」表に矛盾がある。
 *   - 「自分の0.5に相手の0.5 → 0.5-0.5=0 ブレイク（消滅）」
 *   - 「相手の0.5にポアする → -0.5+1=0.5 オーバーポア（色変わり）」
 *   同じ "0.5 vs 0.5" の操作なのに、片方は消滅・片方は色を奪う。後者はデルタが +1
 *   （＝1石ぶん）になっており、ポア(0.5)ではなく「1石で上書き」を指している可能性が高い。
 *   ここでは「デルタの大きさ」で機械的に分岐する（オーバーポアはデルタ |1| のときだけ成立）。
 *   ポア(|0.5|)が相手の0.5に当たったら break として扱う。正式ルールは kako-jun の決定待ち。
 */
export function classify(before: CellValue, d: number): Resolution {
  const after = resolveAdd(before, d);
  const placing: Player = d > 0 ? "black" : "white";
  const beforeSign = Math.sign(before);
  const placingSign = Math.sign(d);
  const isStone = Math.abs(d) === 1;
  const isPour = Math.abs(d) === 0.5;

  // 空きへの着手
  if (before === 0) {
    return { after, phenomenon: isStone ? "place" : "pour" };
  }

  // 同色
  if (beforeSign === placingSign) {
    // 自分の0.5 + 自分の0.5 → 1石
    if (isPour && Math.abs(before) === 0.5) return { after, phenomenon: "solidify" };
    // それ以外の同色加算は本来禁手（自分の1石の上など）。resolveAdd が弾く。
    return { after, phenomenon: "none" };
  }

  // 異色（相手の石の上）
  if (Math.abs(before) === 1) {
    // 相手の1石
    if (isStone) return { after, phenomenon: "capture" }; // 1石で相打ち → 0
    return { after, phenomenon: "reduce" }; // ポアで削る → 相手の0.5
  } else {
    // 相手の0.5
    if (isStone) return { after, phenomenon: "overpour" }; // 1石ぶんで色を奪う（要確認）
    return { after, phenomenon: "break" }; // 0.5 同士 → 消滅
  }

  // placing は将来 intercept 等の分岐で使う（現状は未使用警告回避のため参照）。
  void placing;
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
