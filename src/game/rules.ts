// 合法手判定・cooldown 遷移・ターン確定の純粋関数。Three.js / DOM 非依存。
// 単一責務: 「その手が置けるか」「置いた結果どうなるか」を副作用なしで返す。
// 足し算の核（stones.applyPlacement/classify/resolveAdd）は必ず経由し、迂回しない。
//
// import してよいのは boardDef / coords / stones / state の型・関数のみ。
import type { BoardSizeDef } from "./boardDef";
import { RULES } from "./boardDef";
import type { Point } from "./coords";
import { indexOf, inBounds, fromIndex } from "./coords";
import type { Player, PlaceKind, Resolution, Phenomenon, CellValue } from "./stones";
import { applyPlacement, classifySimultaneous, delta } from "./stones";
import type { GameState } from "./state";

/** 着手を拒否する理由（UI フィードバック用）。置けるなら null。 */
export type Rejection = "out-of-bounds" | "occupied" | "cooldown";

/** commitPlacement の戻り値。判別可能 union。 */
export type CommitResult =
  | { ok: true; state: GameState; resolution: Resolution }
  | { ok: false; reason: Rejection };

/** その交点が空きか（石が無いか）。 */
export function isEmpty(cells: readonly number[], i: number): boolean {
  return cells[i] === 0;
}

/** その交点が cooldown 中か（連続配置禁止・コウ相当）。 */
export function isOnCooldown(state: GameState, i: number): boolean {
  return state.cooldown[i] > 0;
}

/** (x, y) に着手できるか。盤内 かつ 空き かつ cooldown 0。 */
export function canPlaceAt(def: BoardSizeDef, state: GameState, x: number, y: number): boolean {
  if (!inBounds(def, x, y)) return false;
  const i = indexOf(def, x, y);
  return isEmpty(state.cells, i) && !isOnCooldown(state, i);
}

/**
 * 置けない理由を返す（置けるなら null）。判定順: 盤外 → 占有 → cooldown。
 * canPlaceAt の真偽と常に整合する（どちらも同じ 3 条件を見る）。
 */
export function placementRejection(
  def: BoardSizeDef,
  state: GameState,
  x: number,
  y: number,
): Rejection | null {
  if (!inBounds(def, x, y)) return "out-of-bounds";
  const i = indexOf(def, x, y);
  if (!isEmpty(state.cells, i)) return "occupied";
  if (isOnCooldown(state, i)) return "cooldown";
  return null;
}

/** 現局面で置ける全交点を列挙する。 */
export function legalPlacements(def: BoardSizeDef, state: GameState): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < state.cells.length; i++) {
    if (isEmpty(state.cells, i) && !isOnCooldown(state, i)) {
      out.push(fromIndex(def, i));
    }
  }
  return out;
}

/**
 * cooldown を1ターン分進める（各要素を max(0, v-1)）。純粋・新配列を返す。
 * 入力配列は変更しない。
 */
export function tickCooldowns(cooldown: readonly number[]): number[] {
  return cooldown.map((v) => Math.max(0, v - 1));
}

/**
 * 1手を確定する（純粋）。元 state は変更しない。
 *
 * 単一着手 primitive。同時プロット制（ルール①）の live フローは resolveSimultaneous。
 * これは1者・1点の確定に使う下位関数として温存する（テストあり）。
 *
 * cooldown モデル（不変条件・厳守）:
 *   押印値 = RULES.koCooldownTurns(=1)。
 *   tick（全点デクリメント）を先に行い、その後で触れた点へ押印する。
 *   これにより「今置いた点」が同ターンの tick で即 0 に減ることはない。
 *   結果、placed 点は次ターンの検証時 cooldown>0 で不可 → その手の tick で 0 →
 *   2ターン後にようやく置ける。design.md「直前ターンに触れた点は次ターン置けない
 *   （2ターン後に解放）」と一致する。
 */
export function commitPlacement(
  def: BoardSizeDef,
  state: GameState,
  x: number,
  y: number,
  player: Player,
  kind: PlaceKind,
): CommitResult {
  // 1. 合法手判定。非合法なら足し算の核を呼ばずに拒否する。
  const reason = placementRejection(def, state, x, y);
  if (reason !== null) return { ok: false, reason };

  // 2. 足し算の核を経由して盤面を更新（クローンが返る・元 cells は不変）。
  const { cells, resolution } = applyPlacement(def, state.cells, x, y, player, kind);

  // 3. 全点の cooldown を1つ進める（先に tick）。
  const cooldown = tickCooldowns(state.cooldown);
  // 4. tick の後で、今触れた点に押印する（同ターンで即デクリメントされないため）。
  cooldown[indexOf(def, x, y)] = RULES.koCooldownTurns;

  // 5. 新しい state を組んで返す（スプレッドで元を保持・純粋）。
  //    moveRights はネストしたオブジェクトなのでスプレッドだけだと元 state と
  //    参照共有になる。ルール②（1.5手・#5）が moveRights を書き換えた瞬間に
  //    過去局面まで遡って壊れる（純粋性・undo 破綻）ため、ここで明示的にコピーする。
  return {
    ok: true,
    state: {
      ...state,
      cells,
      cooldown,
      moveRights: { ...state.moveRights },
      turnCount: state.turnCount + 1,
    },
    resolution,
  };
}

// ── 同時プロット制（ルール①） ───────────────────────────────────────────
// 先手後手なし。両者の手を伏せて同時公開し、足し算で解決する。

/** プロットされた1手（着手点と種類）。 */
export interface Plot {
  readonly x: number;
  readonly y: number;
  readonly kind: PlaceKind;
}

/** プロット入力。null = パス。 */
export type PlotInput = Plot | null;

/** 解決で起きた現象1件（表示・実況用）。 */
export interface ResolveEvent {
  readonly x: number;
  readonly y: number;
  readonly phenomenon: Phenomenon;
  readonly after: CellValue;
}

/** resolveSimultaneous の戻り値。判別可能 union。 */
export type SimResult =
  | { ok: true; state: GameState; events: ResolveEvent[] }
  | { ok: false; which: Player; reason: Rejection };

/**
 * 同時プロット制（ルール①）を1ラウンド解決する（純粋・元 state 不変）。
 *
 * 検証は両者とも同一の開始 state に対して独立に行う。両者が同じ空き点を狙うのは
 * 合法（＝同点衝突）。占有・cooldown・盤外は各自不可。
 *
 * 解決の分岐:
 *   - 両者非 null かつ同点 → 空きへ黒白の両デルタを同時加算（classifySimultaneous）。
 *   - それ以外（別点、または片方 pass）→ 各 plot を順に applyPlacement（別点＝相互作用なし）。
 *
 * cooldown は commitPlacement と同じく tick→押印の順。touched（相殺で 0 になった点も
 * 含む）に押印して相殺ループを防ぐ（design①）。同点は1回だけ押印する。
 */
export function resolveSimultaneous(
  def: BoardSizeDef,
  state: GameState,
  blackPlot: PlotInput,
  whitePlot: PlotInput,
): SimResult {
  // 1. 検証（両者とも開始 state 基準）。非 null のみ判定し、拒否理由が返れば which 付きで失敗。
  if (blackPlot !== null) {
    const reason = placementRejection(def, state, blackPlot.x, blackPlot.y);
    if (reason !== null) return { ok: false, which: "black", reason };
  }
  if (whitePlot !== null) {
    const reason = placementRejection(def, state, whitePlot.x, whitePlot.y);
    if (reason !== null) return { ok: false, which: "white", reason };
  }

  // 2. 作業用クローン（元 state.cells は不変）。
  let cells = state.cells.slice();
  const events: ResolveEvent[] = [];
  const touched: number[] = [];

  // 3. 分岐。
  const samePoint =
    blackPlot !== null &&
    whitePlot !== null &&
    blackPlot.x === whitePlot.x &&
    blackPlot.y === whitePlot.y;

  if (samePoint) {
    // 同点衝突。足し算の核 classifySimultaneous を経由（空きへ黒白デルタを同時加算）。
    const i = indexOf(def, blackPlot.x, blackPlot.y);
    const dB = delta("black", blackPlot.kind);
    const dW = delta("white", whitePlot.kind);
    const res = classifySimultaneous(dB, dW);
    cells[i] = res.after;
    events.push({ x: blackPlot.x, y: blackPlot.y, phenomenon: res.phenomenon, after: res.after });
    touched.push(i); // 同点は1回だけ押印
  } else {
    // 別点、または片方 pass。非 null の各 plot を順に確定（別点なので相互作用なし＝空きへ place/pour）。
    const plots: ReadonlyArray<readonly [Player, PlotInput]> = [
      ["black", blackPlot],
      ["white", whitePlot],
    ];
    for (const [player, plot] of plots) {
      if (plot === null) continue;
      const r = applyPlacement(def, cells, plot.x, plot.y, player, plot.kind);
      cells = r.cells;
      events.push({
        x: plot.x,
        y: plot.y,
        phenomenon: r.resolution.phenomenon,
        after: r.resolution.after,
      });
      touched.push(indexOf(def, plot.x, plot.y));
    }
  }

  // 4. cooldown: 先に全点 tick、その後で touched へ押印（同ターンで即デクリメントされない）。
  //    相殺（after 0）で空きに戻った点も押印して相殺ループを防ぐ。
  const cooldown = tickCooldowns(state.cooldown);
  for (const i of touched) {
    cooldown[i] = RULES.koCooldownTurns;
  }

  // 5. 新 state を返す（moveRights 明示コピー・turnCount+1・純粋）。両 pass なら
  //    cells 不変・events 空・cooldown は tick のみ・turnCount+1。
  return {
    ok: true,
    state: {
      ...state,
      cells,
      cooldown,
      moveRights: { ...state.moveRights },
      turnCount: state.turnCount + 1,
    },
    events,
  };
}
