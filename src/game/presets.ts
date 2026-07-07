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
 * 「実戦の終盤（9路）」（スクショ用・最重要）。実在のプロ9路棋譜の終局図をそのまま写した自然な盤面。
 * 出典: 読売テレビ「ミニ碁」放送 武宮正樹(黒9p) vs 山田規三生(白8p)・2000-12-24・W+6.5
 * （AEB 9x9 Minigo アーカイブ 001224.sgf・全50手を打ち切った終局図）。
 * 手作りの人工的な局面でなく、実戦で地が確定した自然な終盤なので囲いが素直に閉じ、両色に水が溜まる:
 * - 黒地は左上の小池と右下の大池（計15マス＝黒15m³）。
 * - 白地は右上の池と左下の池（計16マス＝白16m³）。
 * - (3,2) は黒白の柵が両接する唯一のダメで中立＝乾く（水が残らない）。
 * 実戦は全て1石（硬い柵）なので水は全て確定（instability 0＝海抜0の凪の池）。
 * computeTerritory で検算済み（black 15 / white 16・両色>0）。
 */
function realGameEndgame(): GameState {
  return build9(50, [
    // 黒（+1）: 左上の小池を囲う石＋中央〜右下の大石群。
    [1, 0, 1], [2, 1, 1], [0, 2, 1], [1, 2, 1], [2, 2, 1], [7, 2, 1],
    [0, 3, 1], [2, 3, 1], [3, 3, 1], [4, 3, 1], [5, 3, 1], [6, 3, 1], [7, 3, 1], [8, 3, 1],
    [5, 4, 1], [4, 5, 1], [5, 5, 1], [6, 6, 1],
    [3, 7, 1], [5, 7, 1], [6, 7, 1], [3, 8, 1], [4, 8, 1], [5, 8, 1], [6, 8, 1],
    // 白（−1）: 右上の池を囲う石＋左辺〜左下の大石群。
    [2, 0, -1], [3, 0, -1], [3, 1, -1], [4, 1, -1], [7, 1, -1], [8, 1, -1],
    [4, 2, -1], [5, 2, -1], [6, 2, -1], [8, 2, -1],
    [1, 3, -1], [0, 4, -1], [1, 4, -1], [2, 4, -1], [3, 4, -1], [4, 4, -1],
    [3, 5, -1], [2, 6, -1], [3, 6, -1], [4, 6, -1], [5, 6, -1],
    [2, 7, -1], [4, 7, -1], [2, 8, -1],
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
  { name: "実戦の終盤（9路）", state: realGameEndgame },
  { name: "不安定デモ", state: instabilityDemo },
  { name: "大きな黒地", state: bigBlackTerritory },
];
