// エントリ（配線層）。state と描画層と HUD を繋ぐだけ。
// ゲームロジックは src/game、描画は src/render。ここは両者の配線と UI 生成のみ。
import { BOARD_SIZES } from "./game/boardDef";
import { createInitialState } from "./game/state";
import { canPlaceAt, commitPlacement } from "./game/rules";
import type { Player, PlaceKind } from "./game/stones";
import type { Rejection } from "./game/rules";
import { BoardScene } from "./render/boardScene";

const def = BOARD_SIZES["9"];
let state = createInitialState("9"); // 空盤（再代入で局面を進める）

// 暫定ホットシート: 着手成功ごとに手番を黒↔白で自動反転する。
// ルール①「同時プロット制」は Issue #2 でこのターンモデルごと差し替える。
let currentPlayer: Player = "black";
let currentKind: PlaceKind = "stone"; // 既定は 1 石。HUD のトグルで pour に切替。

const container = document.getElementById("app");
if (!container) throw new Error("#app が無い");

const scene = new BoardScene(container, def);
scene.setState(state);
// 合法性の判定は game に委ねる。BoardScene はこの probe で色を塗るだけ。
scene.setLegalityProbe((x, y) => canPlaceAt(def, state, x, y));

// ---- HUD（配線層で DOM 生成。game/render に UI を混ぜない） ----
const hud = document.getElementById("hud");
if (!hud) throw new Error("#hud が無い");
// #hud 自体はクリックを盤に通す（pointer-events:none は index.html で指定）。
// 操作するボタンだけ pointer-events:auto に戻してあるので、ここで auto にしない。
hud.innerHTML = `
  <div id="hud-panel">
    <div class="hud-row"><span id="hud-turn"></span></div>
    <div class="hud-row">
      <button id="hud-stone" type="button">石</button>
      <button id="hud-pour" type="button">ポア</button>
    </div>
    <div class="hud-row" id="hud-count"></div>
    <div class="hud-row" id="hud-reject"></div>
  </div>
`;

const turnEl = document.getElementById("hud-turn")!;
const countEl = document.getElementById("hud-count")!;
const rejectEl = document.getElementById("hud-reject")!;
const stoneBtn = document.getElementById("hud-stone") as HTMLButtonElement;
const pourBtn = document.getElementById("hud-pour") as HTMLButtonElement;

function updateHud(): void {
  turnEl.textContent = `手番: ${currentPlayer === "black" ? "● 黒" : "○ 白"}`;
  countEl.textContent = `手数: ${state.turnCount}`;
  stoneBtn.classList.toggle("active", currentKind === "stone");
  pourBtn.classList.toggle("active", currentKind === "pour");
}

const REJECT_TEXT: Record<Rejection, string> = {
  occupied: "そこには石がある",
  cooldown: "連続配置禁止（cooldown中）",
  "out-of-bounds": "盤の外",
};

let rejectTimer: number | undefined;
function showReject(reason: Rejection): void {
  rejectEl.textContent = REJECT_TEXT[reason];
  if (rejectTimer !== undefined) clearTimeout(rejectTimer);
  rejectTimer = window.setTimeout(() => {
    rejectEl.textContent = "";
  }, 900);
}

stoneBtn.addEventListener("click", () => {
  currentKind = "stone";
  updateHud();
});
pourBtn.addEventListener("click", () => {
  currentKind = "pour";
  updateHud();
});

// ---- クリック着手の配線 ----
scene.onPointClick = (x, y) => {
  const r = commitPlacement(def, state, x, y, currentPlayer, currentKind);
  if (r.ok) {
    state = r.state;
    scene.setState(state);
    currentPlayer = currentPlayer === "black" ? "white" : "black"; // 手番反転（暫定）
    updateHud();
    // 置いた点は occupied/cooldown になったので、マウスを動かさなくても
    // ホバー色（緑→赤）を即反映する。
    scene.refreshHover();
  } else {
    showReject(r.reason);
  }
};

updateHud();
scene.start();
