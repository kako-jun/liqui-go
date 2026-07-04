// エントリ（配線層）。state と描画層と HUD を繋ぐだけ。
// ゲームロジックは src/game、描画は src/render。ここは両者の配線と UI 生成のみ。
//
// ルール①同時プロット制＋ルール③ムーブ。#1 の暫定ホットシートを置換。
// 先手後手なし。黒→白の順に「位置を伏せて」プロットし、白確定で両手を同時公開して
// resolveSimultaneous（足し算の核）で解決する。
// ルール③ ムーブ: 自分の 0.5 をクリック→隣接8マスの移動先を選ぶ（0.5のみ・1石不可）。
// 同時ムーブが同一着点なら tris（3点空く）、相互なら swap（0.5 入替）。
import { BOARD_SIZES } from "./game/boardDef";
import { indexOf } from "./game/coords";
import { createInitialState } from "./game/state";
import { placementRejection, resolveSimultaneous, moveRejection } from "./game/rules";
import type { PlaceKind, Phenomenon, Player } from "./game/stones";
import type { PlotRejection, PlotInput, Plot, ResolveEvent } from "./game/rules";
import { BoardScene } from "./render/boardScene";

const def = BOARD_SIZES["9"];
let state = createInitialState("9"); // 空盤（再代入で局面を進める）

// ラウンド状態（ルール①）。黒→白の順にプロットし、白が確定した瞬間に resolve。
type Phase = "black-plot" | "white-plot";
let phase: Phase = "black-plot";
let blackPlot: PlotInput = null;
let whitePlot: PlotInput = null;
let currentKind: PlaceKind = "stone"; // 石/ポア。両者共通の入力補助（HUD トグル）。
// ルール③ 現手番のムーブ元選択（自分の 0.5 をクリックして選び、次クリックで移動先）。
let pendingMoveFrom: { x: number; y: number } | null = null;

/** 現在プロット中の手番。 */
function currentPlayer(): Player {
  return phase === "black-plot" ? "black" : "white";
}

const container = document.getElementById("app");
if (!container) throw new Error("#app が無い");

const scene = new BoardScene(container, def);
scene.setState(state);
// 合法性 probe（緑/赤ホバー）。既定は place 判定。ムーブ元選択中は「そこからの合法着地か」に差し替える。
// 開始 state 基準（両者とも同じ空きを狙えるのは仕様＝同点衝突）。
const placeProbe = (x: number, y: number): boolean => placementRejection(def, state, x, y) === null;
scene.setLegalityProbe(placeProbe);

// ---- HUD（配線層で DOM 生成。game/render に UI を混ぜない） ----
const hud = document.getElementById("hud");
if (!hud) throw new Error("#hud が無い");
// #hud 自体はクリックを盤に通す（pointer-events:none は index.html）。ボタンだけ auto。
hud.innerHTML = `
  <div id="hud-panel">
    <div class="hud-row"><span id="hud-phase"></span></div>
    <div class="hud-row">
      <button id="hud-stone" type="button">石</button>
      <button id="hud-pour" type="button">ポア</button>
      <button id="hud-pass" type="button">パス</button>
    </div>
    <div class="hud-row" id="hud-count"></div>
    <div class="hud-row" id="hud-events"></div>
    <div class="hud-row" id="hud-reject"></div>
  </div>
`;

const phaseEl = document.getElementById("hud-phase")!;
const countEl = document.getElementById("hud-count")!;
const eventsEl = document.getElementById("hud-events")!;
const rejectEl = document.getElementById("hud-reject")!;
const stoneBtn = document.getElementById("hud-stone") as HTMLButtonElement;
const pourBtn = document.getElementById("hud-pour") as HTMLButtonElement;
const passBtn = document.getElementById("hud-pass") as HTMLButtonElement;

function updateHud(): void {
  let text = phase === "black-plot" ? "● 黒がプロット中" : "○ 白がプロット中";
  if (pendingMoveFrom) {
    text += `（移動元 (${pendingMoveFrom.x},${pendingMoveFrom.y}) → 移動先を選べ / もう一度押すと解除）`;
  }
  phaseEl.textContent = text;
  countEl.textContent = `手数: ${state.turnCount}`;
  stoneBtn.classList.toggle("active", currentKind === "stone");
  pourBtn.classList.toggle("active", currentKind === "pour");
}

const REJECT_TEXT: Record<PlotRejection, string> = {
  occupied: "そこには石がある",
  cooldown: "連続配置禁止（cooldown中）",
  "out-of-bounds": "盤の外",
  "not-your-half": "自分の0.5だけ動かせる",
  "not-adjacent": "隣接8マスのみ",
  "illegal-landing": "自分の1石には乗れない",
};

let rejectTimer: number | undefined;
function showReject(reason: PlotRejection): void {
  rejectEl.textContent = REJECT_TEXT[reason];
  if (rejectTimer !== undefined) clearTimeout(rejectTimer);
  rejectTimer = window.setTimeout(() => {
    rejectEl.textContent = "";
  }, 1200);
}

// 現象名の日本語ラベル（HUD の resolve 要約用）。Record 網羅で追加漏れを型で防ぐ。
const PHENOMENON_TEXT: Record<Phenomenon, string> = {
  place: "着手",
  pour: "ポア",
  solidify: "ソリディファイ",
  cancel: "Cancel",
  capture: "相討ち(capture)",
  reduce: "削れ(reduce)",
  move: "移動",
  tris: "トリス",
  swap: "スワップ",
};

function showEvents(events: ResolveEvent[]): void {
  if (events.length === 0) {
    eventsEl.textContent = "解決: 両者パス";
    return;
  }
  eventsEl.textContent =
    "解決: " +
    events.map((e) => `(${e.x},${e.y}) ${PHENOMENON_TEXT[e.phenomenon]}`).join(" / ");
}

// ムーブ元の選択を解除して place モードへ戻す（probe / マーカー / HUD を戻す）。
function clearMoveSelection(): void {
  pendingMoveFrom = null;
  scene.setMoveSource(null);
  scene.setLegalityProbe(placeProbe);
  updateHud();
  scene.refreshHover();
}

// 現 phase のプロットが確定した後に呼ぶ。黒→白、白→resolve。
function advanceTurn(): void {
  if (phase === "black-plot") {
    phase = "white-plot";
    updateHud();
    scene.refreshHover();
  } else {
    resolveRound();
  }
}

// 現手番のプロットを確定する。
function setPlot(player: Player, plot: PlotInput): void {
  if (player === "black") blackPlot = plot;
  else whitePlot = plot;
}

// 現ラウンドを解決して次ラウンド（黒プロット）へ戻す。
function resolveRound(): void {
  const r = resolveSimultaneous(def, state, blackPlot, whitePlot);
  if (r.ok) {
    state = r.state;
    scene.setState(state); // ← この瞬間に両手が同時に盤へ乗る（伏せの解除）
    showEvents(r.events);
  } else {
    // 理論上起きない（プロット時に検証済み）が、来たら拒否表示。
    showReject(r.reason);
  }
  // ラウンドをリセット（ムーブ選択も必ず解除・probe/マーカーを place に戻す）。
  blackPlot = null;
  whitePlot = null;
  phase = "black-plot";
  pendingMoveFrom = null;
  scene.setMoveSource(null);
  scene.setLegalityProbe(placeProbe);
  updateHud();
  scene.refreshHover(); // 盤が変わったのでホバー色（緑/赤）を即再評価
}

// ---- 入力トグル ----
stoneBtn.addEventListener("click", () => {
  currentKind = "stone";
  updateHud();
});
pourBtn.addEventListener("click", () => {
  currentKind = "pour";
  updateHud();
});

// ---- パス（現 phase の plot を null にして次へ。white でパスなら resolve） ----
passBtn.addEventListener("click", () => {
  // ムーブ元選択中でも、パスは選択を捨てて手番を進める。
  pendingMoveFrom = null;
  scene.setMoveSource(null);
  scene.setLegalityProbe(placeProbe);
  setPlot(currentPlayer(), null);
  advanceTurn();
});

// ---- クリック（ルール①同時プロット＋ルール③ムーブ）。黒→白の順、白確定で resolve ----
scene.onPointClick = (x, y) => {
  const player = currentPlayer();

  if (pendingMoveFrom === null) {
    // 移動元未選択。自分の 0.5 なら移動元選択へ、空点なら place、それ以外は拒否。
    const myHalf = player === "black" ? 0.5 : -0.5;
    if (state.cells[indexOf(def, x, y)] === myHalf) {
      // ルール③ ムーブ元を選択。probe を「そこからの合法着地か」に差し替える。
      pendingMoveFrom = { x, y };
      scene.setMoveSource({ x, y });
      scene.setLegalityProbe(
        (tx, ty) =>
          moveRejection(def, state, { type: "move", fromX: x, fromY: y, toX: tx, toY: ty }, player) ===
          null,
      );
      updateHud();
      scene.refreshHover();
      return;
    }
    // 空点への place（合法なら確定→手番進行）。
    const reason = placementRejection(def, state, x, y);
    if (reason !== null) {
      showReject(reason);
      return;
    }
    const plot: Plot = { type: "place", x, y, placeKind: currentKind };
    setPlot(player, plot); // 伏せる: 盤には描かない。resolve 時に両手を同時公開。
    advanceTurn();
    return;
  }

  // 移動先選択中。
  if (x === pendingMoveFrom.x && y === pendingMoveFrom.y) {
    clearMoveSelection(); // 同じ点をもう一度 → 選択解除
    return;
  }
  const move: Plot = {
    type: "move",
    fromX: pendingMoveFrom.x,
    fromY: pendingMoveFrom.y,
    toX: x,
    toY: y,
  };
  const reason = moveRejection(def, state, move, player);
  if (reason !== null) {
    showReject(reason);
    clearMoveSelection(); // 不正な着地 → 選択を捨てて place モードへ戻す（スタック回避）
    return;
  }
  setPlot(player, move);
  clearMoveSelection(); // probe/マーカーを place に戻す
  advanceTurn();
};

updateHud();
scene.start();
