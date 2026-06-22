// 定義データ（不変）。実行時状態（state.ts）とは別物として設計する。
// ここに置くのは「盤面の仕様」と「ルール定数」だけ。対局中に変わる値は一切持たない。

export type BoardSizeId = "9" | "13" | "19";

export interface BoardSizeDef {
  /** サイズ識別子 */
  readonly id: BoardSizeId;
  /** 一辺の線の数（＝交点は lines × lines） */
  readonly lines: number;
  /** 星・天元の座標（0-indexed）。1.5手の権利ポイント（ルール②） */
  readonly starPoints: ReadonlyArray<readonly [number, number]>;
}

export const BOARD_SIZES: Readonly<Record<BoardSizeId, BoardSizeDef>> = {
  "9": {
    id: "9",
    lines: 9,
    starPoints: [
      [2, 2],
      [6, 2],
      [4, 4], // 天元
      [2, 6],
      [6, 6],
    ],
  },
  "13": {
    id: "13",
    lines: 13,
    starPoints: [
      [3, 3],
      [9, 3],
      [6, 6], // 天元
      [3, 9],
      [9, 9],
    ],
  },
  "19": {
    id: "19",
    lines: 19,
    starPoints: [
      [3, 3],
      [9, 3],
      [15, 3],
      [3, 9],
      [9, 9], // 天元
      [15, 9],
      [3, 15],
      [9, 15],
      [15, 15],
    ],
  },
};

// ルール定数（不変）。マジックナンバーをコードに散らさず、ここを唯一の出どころにする。
export const RULES = {
  /** ムーブの移動範囲（チェビシェフ距離）。隣接8マスのみ（ルール③） */
  moveRangeChebyshev: 1,
  /** 連続配置禁止（コウ相当）。直前ターンに触れた点は次ターン置けない＝2ターン後に解放 */
  koCooldownTurns: 1,
  /** 1.5手の上限（ルール②）。2.0にはならない */
  maxMoveRight: 1.5,
  /** スコア単位。1マス = 1m³ */
  cellCubicMeters: 1,
} as const;
