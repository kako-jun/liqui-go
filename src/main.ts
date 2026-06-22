// エントリ。state を作り、描画層に渡す。
// 現状はデモ局面（5つのセル値すべて）を可視化するだけの dev scaffold。
import { BOARD_SIZES } from "./game/boardDef";
import { indexOf } from "./game/coords";
import { createInitialState } from "./game/state";
import { BoardScene } from "./render/boardScene";

const def = BOARD_SIZES["9"];
const state = createInitialState("9");

// デモ局面: 全5状態（黒1石 / 黒0.5 / 白1石 / 白0.5 / 天元の黒）を並べて
// 描画が正しいか目視確認できるようにする。
const put = (x: number, y: number, v: number) => {
  state.cells[indexOf(def, x, y)] = v;
};
put(2, 2, 1); // 黒1石
put(6, 2, 0.5); // 黒0.5（ポア）
put(2, 6, -1); // 白1石
put(6, 6, -0.5); // 白0.5（ポア）
put(4, 4, 1); // 天元に黒1石
put(3, 3, -0.5); // 白0.5
put(5, 5, 0.5); // 黒0.5

const container = document.getElementById("app");
if (!container) throw new Error("#app が無い");

const scene = new BoardScene(container, def);
scene.setState(state);
scene.start();
