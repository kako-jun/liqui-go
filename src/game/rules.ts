// 合法手判定・cooldown 遷移・ターン確定の純粋関数。Three.js / DOM 非依存。
// 単一責務: 「その手が置けるか」「置いた結果どうなるか」を副作用なしで返す。
// 足し算の核（stones.applyPlacement/classify/resolveAdd）は必ず経由し、迂回しない。
//
// import してよいのは boardDef / coords / stones / state の型・関数のみ。
import type { BoardSizeDef } from "./boardDef";
import { RULES } from "./boardDef";
import type { Point } from "./coords";
import { indexOf, inBounds, fromIndex, moveTargets } from "./coords";
import type { Player, PlaceKind, Resolution, Phenomenon, CellValue } from "./stones";
import {
  applyPlacement,
  classify,
  classifySimultaneous,
  delta,
  isLegalCellValue,
  resolveAdd,
} from "./stones";
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

// プロットは判別可能 union。空点への着手（place）と、0.5 の移動（move・ルール③）の2種。
/** 空点への着手プロット（1石 or ポア）。 */
export interface PlacePlot {
  readonly type: "place";
  readonly x: number;
  readonly y: number;
  readonly placeKind: PlaceKind;
}

/** 0.5 の移動プロット（ルール③ ムーブ）。from の 0.5 を to へ動かす。 */
export interface MovePlot {
  readonly type: "move";
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

/** プロットされた1手。 */
export type Plot = PlacePlot | MovePlot;

/** プロット入力。null = パス。 */
export type PlotInput = Plot | null;

/** プロット（place / move 共通）を拒否する理由。ムーブ固有の理由を Rejection に足す。 */
export type PlotRejection = Rejection | "not-your-half" | "not-adjacent" | "illegal-landing";

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
  | { ok: false; which: Player; reason: PlotRejection };

/**
 * ムーブ（ルール③）の拒否理由を返す（合法なら null）。純粋・state 不変。
 *
 * 判定順（前段が満たされる前提で次を見る）:
 *   盤外（from/to どちらか）→ from が自分の 0.5 でない → to が隣接8マス外 →
 *   to が cooldown 中 → 着地結果が合法値域外（自分の1石に乗る＝1.5 等）。
 * すべて通れば null。
 *
 * 「0.5 のみムーブ可・1石は動けない」は from セルが自分の 0.5（±0.5）である検査で担保する。
 */
export function moveRejection(
  def: BoardSizeDef,
  state: GameState,
  m: MovePlot,
  player: Player,
): PlotRejection | null {
  if (!inBounds(def, m.fromX, m.fromY) || !inBounds(def, m.toX, m.toY)) return "out-of-bounds";
  const iFrom = indexOf(def, m.fromX, m.fromY);
  const half = player === "black" ? 0.5 : -0.5; // 自分の 0.5 の符号
  // 自分の 0.5 からのみ動かせる（空 / 1石 / 相手石 / 相手0.5 は不可）。
  if (state.cells[iFrom] !== half) return "not-your-half";
  // to は from のチェビシェフ1（隣接8マス）。自己（from 自身）は moveTargets に含まれない。
  const adjacent = moveTargets(def, m.fromX, m.fromY).some((p) => p.x === m.toX && p.y === m.toY);
  if (!adjacent) return "not-adjacent";
  const iTo = indexOf(def, m.toX, m.toY);
  if (isOnCooldown(state, iTo)) return "cooldown"; // 着地点は直前ターン触れた点不可
  // 着地結果が合法値域を外れる（自分の1石へ乗る＝±1.5 等）→ 禁手。
  if (!isLegalCellValue(state.cells[iTo] + half)) return "illegal-landing";
  return null;
}

/** プロット種別に応じた検証を振り分ける（place=placementRejection / move=moveRejection）。 */
function plotRejection(
  def: BoardSizeDef,
  state: GameState,
  plot: Plot,
  player: Player,
): PlotRejection | null {
  if (plot.type === "place") return placementRejection(def, state, plot.x, plot.y);
  return moveRejection(def, state, plot, player);
}

/**
 * 同時プロット制（ルール①＋③）を1ラウンド解決する（純粋・元 state 不変）。
 *
 * 検証は両者とも同一の開始 state に対して独立に行う。place / move を問わず、
 * 盤面は「加算デルタ寄与モデル」で解く: 各プロットが関与セルへ寄せるデルタを
 * Map に足し合わせ、開始 state のクローンへまとめて resolveAdd するだけ。
 *   - place: 着点 to へ delta(player, placeKind)。
 *   - move : from へ -h、to へ +h（h=自分の0.5。0.5 を from から抜き to へ移す）。
 * この単純な足し算から、同時2ムーブの tris（同一着点でデルタ相殺→3点空く）と
 * swap（相互着点でデルタが交差→0.5 入替）が自然に創発する。特殊分岐は不要で、
 * events のラベル付けだけ tris/swap/同点place を優先判定する（盤面は常にデルタ和で正）。
 *
 * cooldown は commitPlacement と同じく tick→押印の順。contrib の全キー（move の
 * from/to 両方・place の to・相殺で 0 になった点も）へ押印して相殺ループを防ぐ。
 */
export function resolveSimultaneous(
  def: BoardSizeDef,
  state: GameState,
  blackPlot: PlotInput,
  whitePlot: PlotInput,
): SimResult {
  // 1. 検証（両者とも開始 state 基準）。黒を先に見て、拒否理由が返れば which 付きで失敗。
  if (blackPlot !== null) {
    const reason = plotRejection(def, state, blackPlot, "black");
    if (reason !== null) return { ok: false, which: "black", reason };
  }
  if (whitePlot !== null) {
    const reason = plotRejection(def, state, whitePlot, "white");
    if (reason !== null) return { ok: false, which: "white", reason };
  }

  // 2. 寄与構築。関与セル index → 累積デルタ。
  const contrib = new Map<number, number>();
  const add = (i: number, d: number): void => {
    contrib.set(i, (contrib.get(i) ?? 0) + d);
  };
  const plots: ReadonlyArray<readonly [Player, PlotInput]> = [
    ["black", blackPlot],
    ["white", whitePlot],
  ];
  for (const [player, plot] of plots) {
    if (plot === null) continue;
    if (plot.type === "place") {
      add(indexOf(def, plot.x, plot.y), delta(player, plot.placeKind));
    } else {
      const h = player === "black" ? 0.5 : -0.5; // 動かす 0.5 の符号
      add(indexOf(def, plot.fromX, plot.fromY), -h); // from から 0.5 を抜く
      add(indexOf(def, plot.toX, plot.toY), h); // to へ 0.5 を足す
    }
  }

  // 3. 適用。開始 cells のクローンへ、寄与デルタをまとめて足す（元 state.cells は不変）。
  const cells = state.cells.slice();
  try {
    for (const [i, d] of contrib) {
      cells[i] = resolveAdd(cells[i] as CellValue, d);
    }
  } catch {
    // 個別合法なら合算も合法のはず。万一値域を外れたら安全側に倒して拒否する。
    return { ok: false, which: "black", reason: "illegal-landing" };
  }

  // 4. cooldown: 先に全点 tick、その後で contrib の全キーへ押印（同ターンで即減らない）。
  //    from/to・place の to・相殺で 0 に戻った点も押印して相殺ループを防ぐ。
  const cooldown = tickCooldowns(state.cooldown);
  for (const i of contrib.keys()) {
    cooldown[i] = RULES.koCooldownTurns;
  }

  // 5. events（HUD 用ラベル）。盤面は常に cells（デルタ和）で正。
  const events = buildEvents(def, state, cells, blackPlot, whitePlot);

  // 6. 新 state を返す（moveRights 明示コピー・turnCount+1・純粋）。両 pass なら
  //    contrib 空 → cells 不変・events 空・cooldown は tick のみ・turnCount+1。
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

/**
 * 解決後の盤面 finalCells を根拠に、HUD 用の現象ラベルを組む（純粋・盤面は変えない）。
 *
 * ラベルは以下の優先で付ける（盤面自体はデルタ和で常に正）:
 *   - 両者ムーブ かつ 同一着点 → tris（着点1件。after は 0 のはず）。
 *   - 両者ムーブ かつ 相互着点（互いの元へ）→ swap（両着点2件）。
 *   - それ以外の両者ムーブ → 各 move につき moveEvent。
 *   - 両者 place かつ同点（ルール①）→ classifySimultaneous で1件。
 *   - それ以外 → 非 null 各 plot につき place=placeEvent / move=moveEvent。
 * 注: 特殊（tris/swap/同点place）以外で両プロットが同一セルに重なる稀ケースは
 *     per-plot ラベルが近似になり得るが、盤面（デルタ和）は常に正なので可とする。
 */
function buildEvents(
  def: BoardSizeDef,
  state: GameState,
  finalCells: readonly number[],
  blackPlot: PlotInput,
  whitePlot: PlotInput,
): ResolveEvent[] {
  const events: ResolveEvent[] = [];

  if (blackPlot?.type === "move" && whitePlot?.type === "move") {
    const b = blackPlot;
    const w = whitePlot;
    const bTo = indexOf(def, b.toX, b.toY);
    const wTo = indexOf(def, w.toX, w.toY);
    // tris: 同一着点にぶつかり、両移動元と着点が空く。
    if (b.toX === w.toX && b.toY === w.toY) {
      events.push({ x: b.toX, y: b.toY, phenomenon: "tris", after: finalCells[bTo] as CellValue });
      return events;
    }
    // swap: 互いの移動元へ乗り込む（0.5 入替）。
    if (b.fromX === w.toX && b.fromY === w.toY && w.fromX === b.toX && w.fromY === b.toY) {
      events.push({ x: b.toX, y: b.toY, phenomenon: "swap", after: finalCells[bTo] as CellValue });
      events.push({ x: w.toX, y: w.toY, phenomenon: "swap", after: finalCells[wTo] as CellValue });
      return events;
    }
    // それ以外の両者ムーブ → 各 move を独立にラベル付け。
    events.push(moveEvent(def, state, finalCells, b, "black"));
    events.push(moveEvent(def, state, finalCells, w, "white"));
    return events;
  }

  // 両者 place かつ同点（ルール①の同点衝突）。
  if (
    blackPlot?.type === "place" &&
    whitePlot?.type === "place" &&
    blackPlot.x === whitePlot.x &&
    blackPlot.y === whitePlot.y
  ) {
    const i = indexOf(def, blackPlot.x, blackPlot.y);
    const res = classifySimultaneous(
      delta("black", blackPlot.placeKind),
      delta("white", whitePlot.placeKind),
    );
    events.push({
      x: blackPlot.x,
      y: blackPlot.y,
      phenomenon: res.phenomenon,
      after: finalCells[i] as CellValue,
    });
    return events;
  }

  // それ以外（別点 / 片方 pass / place と move の混在）。非 null 各 plot を独立にラベル付け。
  for (const [player, plot] of [
    ["black", blackPlot],
    ["white", whitePlot],
  ] as const) {
    if (plot === null) continue;
    if (plot.type === "place") events.push(placeEvent(def, state, finalCells, plot, player));
    else events.push(moveEvent(def, state, finalCells, plot, player));
  }
  return events;
}

/** place のラベル（空点なので place/pour）。after は解決後の最終値。 */
function placeEvent(
  def: BoardSizeDef,
  state: GameState,
  finalCells: readonly number[],
  plot: PlacePlot,
  player: Player,
): ResolveEvent {
  const i = indexOf(def, plot.x, plot.y);
  const { phenomenon } = classify(state.cells[i] as CellValue, delta(player, plot.placeKind));
  return { x: plot.x, y: plot.y, phenomenon, after: finalCells[i] as CellValue };
}

/**
 * move のラベル。着地点の開始値 before で分類する:
 *   before 0 → move（着地のみ）/ 非0 → classify(before, ±0.5)（solidify/cancel/reduce）。
 * classify(before, ±0.5) は isStone=false のため throw しない（合法着地前提）。
 * after は解決後の最終値。
 */
function moveEvent(
  def: BoardSizeDef,
  state: GameState,
  finalCells: readonly number[],
  plot: MovePlot,
  player: Player,
): ResolveEvent {
  const iTo = indexOf(def, plot.toX, plot.toY);
  const before = state.cells[iTo] as CellValue;
  const h = player === "black" ? 0.5 : -0.5;
  const phenomenon: Phenomenon = before === 0 ? "move" : classify(before, h).phenomenon;
  return { x: plot.toX, y: plot.toY, phenomenon, after: finalCells[iTo] as CellValue };
}
