// 定番局面プリセット（純粋・Three.js / DOM 非依存）。
//
// 白黒を手で1つずつ置く手間なく、定番局面を1クリックで盤に載せるための canned GameState。
// GameState は完全シリアライズ可能（規律6・state.ts の applyState）なので、プリセット＝
// createInitialState("9") を土台に cells を埋めた GameState を返す純粋関数にするだけでよい。
// 返す state は必ず applyState を通る（cells は {-1,-0.5,0,0.5,1}・長さ81・cooldown 長81）。
//
// 値モデル（stones.ts）: 黒=プラス / 白=マイナス。1石=±1（硬い実線の柵）、0.5石=±0.5
// （半透明で揺らぐ壊れやすい柵）。territory.ts が「一色の柵で囲い切った空領域」を各色の地
// （水）として検出し、囲う柵に 0.5 が混ざるほど instability（不安定＝高く揺れる水）が上がる。
import { createInitialState } from "./state";
import type { GameState } from "./state";
import { BOARD_SIZES } from "./boardDef";
import { indexOf } from "./coords";

const D9 = BOARD_SIZES["9"];

/** 名前付きの定番局面。state() は呼ぶたびに新しい GameState を作る（呼び出し側が書き換えても不変）。 */
export interface Preset {
  readonly name: string;
  readonly state: () => GameState;
}

/**
 * (x, y, value) の並びから 9路 state を組む小道具。
 * turnCount は中盤らしい値を渡す。cooldown は全0・moveRights は {0,0}（createInitialState 既定）。
 */
function build9(
  turnCount: number,
  stones: ReadonlyArray<readonly [number, number, number]>,
): GameState {
  const s = createInitialState("9");
  for (const [x, y, v] of stones) {
    s.cells[indexOf(D9, x, y)] = v;
  }
  s.turnCount = turnCount;
  return s;
}

/**
 * 「自然な中盤」（スクショ用・最重要）。実戦っぽい9路中盤。
 * - 左上の角を黒1石の柵で囲い切った黒地の池（4マス・全1石＝instability 0＝海抜0の凪の池）。
 * - 右下の角を白1石の柵で囲い切った白地の池（4マス・instability 0）。
 * - 右上の角を黒0.5石2つで囲った不安定な小さな水たまり（1マス・instability 1＝高く揺れる水）。
 * - 中央は黒（上）と白（下）の柵が向かい合う係争地帯。両色に接するので中立＝乾く（水が残らない）。
 * computeScore: 黒 5m³（左上4＋右上1）／白 4m³。両色が地を持ち、破線/半透明の不安定水も見える。
 */
function naturalMidgame(): GameState {
  return build9(24, [
    // 左上: 黒1石の柵で角(0,0)(1,0)(0,1)(1,1)を囲い切る（安定した黒地の池）。
    [2, 0, 1],
    [2, 1, 1],
    [0, 2, 1],
    [1, 2, 1],
    // 右上: 黒0.5石2つで角(8,0)を囲う（不安定＝高く揺れる黒の水たまり）。
    [7, 0, 0.5],
    [8, 1, 0.5],
    // 右下: 白1石の柵で角(7,7)(8,7)(7,8)(8,8)を囲い切る（安定した白地の池）。
    [6, 7, -1],
    [6, 8, -1],
    [7, 6, -1],
    [8, 6, -1],
    // 中央: 黒（上）と白（下）が向かい合う係争の前線（実線の柵・両色接触で中立＝乾く）。
    [3, 3, 1],
    [4, 3, 1],
    [5, 4, 1],
    [3, 5, -1],
    [4, 5, -1],
    [5, 5, -1],
  ]);
}

/**
 * 「不安定デモ」。天元(4,4)を黒0.5石4つで囲った局面。
 * 囲った1マスは instability 1（＝高く揺れる・今にも流れ出す不安定な黒の水）。
 * 外周は遠くの白1石(0,8)で黒白両接＝中立化し、中央の高い水たまり1マスだけを際立たせる。
 */
function instabilityDemo(): GameState {
  return build9(8, [
    // 天元(4,4)を黒0.5石の十字で囲う（柔らかい柵＝instability 1）。
    [3, 4, 0.5],
    [5, 4, 0.5],
    [4, 3, 0.5],
    [4, 5, 0.5],
    // 外周を中立化する遠くの白1石（外周が黒地に染まるのを防ぎ、中央1マスだけ水を溜める）。
    [0, 8, -1],
  ]);
}

/**
 * 「大きな黒地」。中央の 3×3（9マス）を黒1石の柵の輪で囲い切った局面。
 * 大きめの黒い池（9m³）が海抜0で溜まる（全1石＝instability 0＝確定・安定）。
 * 外周は遠くの白1石(0,0)で中立化し、白地は 0m³（黒だけが地を持つ）。
 */
function bigBlackTerritory(): GameState {
  return build9(20, [
    // 内部 3×3 {x∈3..5, y∈3..5} を黒1石の輪で完全包囲（上下左右の外側直交隣接すべて）。
    [3, 2, 1],
    [4, 2, 1],
    [5, 2, 1],
    [3, 6, 1],
    [4, 6, 1],
    [5, 6, 1],
    [2, 3, 1],
    [2, 4, 1],
    [2, 5, 1],
    [6, 3, 1],
    [6, 4, 1],
    [6, 5, 1],
    // 外周を中立化する遠くの白1石（外周が黒地に染まるのを防ぐ）。
    [0, 0, -1],
  ]);
}

/** 定番局面の一覧（HUD の「局面」ボタン行がこれを描く）。 */
export const PRESETS: ReadonlyArray<Preset> = [
  { name: "自然な中盤", state: naturalMidgame },
  { name: "不安定デモ", state: instabilityDemo },
  { name: "大きな黒地", state: bigBlackTerritory },
];
