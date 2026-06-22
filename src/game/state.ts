// 実行時状態 GameState。プレーンなオブジェクトで完全シリアライズ可能にする
// （game profile 規律6）。描画層（src/render）はこの state を読むだけで、
// 任意局面から起動・再開できる。
import type { BoardSizeId } from "./boardDef";
import { BOARD_SIZES } from "./boardDef";
import { pointCount } from "./coords";
import { isLegalCellValue } from "./stones";

/** 1.5手の権利ストック（ルール②）。0 または 1.5。 */
export interface MoveRights {
  black: number;
  white: number;
}

export interface GameState {
  /** スキーマ版。将来のマイグレーション用 */
  readonly version: 1;
  boardSizeId: BoardSizeId;
  /** 各交点のセル値 {-1,-0.5,0,0.5,1}。length = pointCount(def) */
  cells: number[];
  /** 手数（同時プロットを1ターンと数える、ルール①） */
  turnCount: number;
  /** 連続配置禁止の残クールダウン（点ごと、0=置ける）。ルール③・コウ相当 */
  cooldown: number[];
  /** 星取得で得た1.5手の権利（ルール②） */
  moveRights: MoveRights;
}

/** 初期状態を作る。デフォルトは試作向けの9路盤。 */
export function createInitialState(boardSizeId: BoardSizeId = "9"): GameState {
  const def = BOARD_SIZES[boardSizeId];
  const n = pointCount(def);
  return {
    version: 1,
    boardSizeId,
    cells: new Array<number>(n).fill(0),
    turnCount: 0,
    cooldown: new Array<number>(n).fill(0),
    moveRights: { black: 0, white: 0 },
  };
}

/**
 * 外部から渡された状態を検証して受け入れる（game profile 規律6）。
 * 任意局面からの起動・再開・デバッグの入口。壊れた state は早期に弾く。
 */
export function applyState(state: GameState): GameState {
  if (state.version !== 1) {
    throw new Error(`未知の GameState version: ${(state as { version: unknown }).version}`);
  }
  const def = BOARD_SIZES[state.boardSizeId];
  if (!def) throw new Error(`未知の boardSizeId: ${state.boardSizeId}`);
  const n = pointCount(def);
  if (state.cells.length !== n) {
    throw new Error(`cells 長 ${state.cells.length} が盤サイズ ${n} と不一致`);
  }
  if (state.cooldown.length !== n) {
    throw new Error(`cooldown 長 ${state.cooldown.length} が盤サイズ ${n} と不一致`);
  }
  for (const v of state.cells) {
    if (!isLegalCellValue(v)) throw new Error(`不正なセル値: ${v}`);
  }
  // クローンして返す（呼び出し側の参照と切り離す）
  return {
    version: 1,
    boardSizeId: state.boardSizeId,
    cells: state.cells.slice(),
    turnCount: state.turnCount,
    cooldown: state.cooldown.slice(),
    moveRights: { ...state.moveRights },
  };
}

/** applyState の別名（呼び出し側の語彙に合わせる） */
export const initWithState = applyState;

/** JSON 文字列へ完全シリアライズ */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** JSON 文字列から復元（検証つき） */
export function deserialize(json: string): GameState {
  return applyState(JSON.parse(json) as GameState);
}
