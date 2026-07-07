// 実行時状態 GameState。プレーンなオブジェクトで完全シリアライズ可能にする
// （game profile 規律6）。描画層（src/render）はこの state を読むだけで、
// 任意局面から起動・再開できる。
import type { BoardSizeId } from "./boardDef";
import { BOARD_SIZES, RULES } from "./boardDef";
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
  // 値域不変条件（UI 非依存の GameState 不変条件）。deserialize/applyState を通る全経路
  // （untrusted JSON 含む）でここが締める。内部生成（createInitialState・presets・rules の
  // resolve 出力）は全て正当値なので誤 throw しない。
  // turnCount: 非負整数（同時プロットを1と数える手数）。
  if (!Number.isInteger(state.turnCount) || state.turnCount < 0) {
    throw new Error(`不正な turnCount: ${state.turnCount}`);
  }
  // cooldown: 各点の残クールダウンは非負整数（上限は設けない＝エンジンの正当値を弾かない）。
  for (const v of state.cooldown) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`不正な cooldown 値: ${v}`);
  }
  // moveRights: 各色 0（未取得）か RULES.maxMoveRight（1.5手の権利）のいずれか（ルール②）。
  const okRight = (r: number): boolean => r === 0 || r === RULES.maxMoveRight;
  if (!okRight(state.moveRights.black) || !okRight(state.moveRights.white)) {
    throw new Error(
      `不正な moveRights: black=${state.moveRights.black}, white=${state.moveRights.white}`,
    );
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

/**
 * 局面エディタ（自由配置）用の純粋ヘルパ。cells[index] を value に塗った検証済みクローンを返す。
 * 内部で applyState を通すので、不正な value（5値以外）や cells 長ズレは throw で弾く。
 * turnCount / cooldown / moveRights は据え置き（塗りでは触らない＝自由配置は占有・cooldown・
 * 権利を無視する）。game 層の純粋関数（Three/DOM 非依存）なのでテスト可能。配線層 main.ts の
 * 編集モードがセルクリックごとにこれを呼び、返った state を renderState で描き直す。
 */
export function paintCell(state: GameState, index: number, value: number): GameState {
  const def = BOARD_SIZES[state.boardSizeId];
  if (!def) throw new Error(`未知の boardSizeId: ${state.boardSizeId}`);
  const n = pointCount(def);
  if (!Number.isInteger(index) || index < 0 || index >= n) {
    throw new RangeError(`paintCell: index ${index} が範囲外 (0..${n - 1})`);
  }
  const cells = state.cells.slice();
  cells[index] = value;
  // applyState が value の妥当性（isLegalCellValue）と全体整合を検証しつつクローンを返す。
  return applyState({
    version: 1,
    boardSizeId: state.boardSizeId,
    cells,
    turnCount: state.turnCount,
    cooldown: state.cooldown,
    moveRights: state.moveRights,
  });
}

/** JSON 文字列へ完全シリアライズ */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** JSON 文字列から復元（検証つき） */
export function deserialize(json: string): GameState {
  return applyState(JSON.parse(json) as GameState);
}
