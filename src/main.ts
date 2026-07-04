// エントリ（配線層）。state と描画層と HUD を繋ぐだけ。
// ゲームロジックは src/game、描画は src/render。ここは両者の配線と UI 生成のみ。
//
// ルール①同時プロット制。#1 の暫定ホットシート（1クリック=1着手・手番反転）を置換。
// 先手後手なし。黒→白の順に「位置を伏せて」プロットし、白確定で両手を同時公開して
// resolveSimultaneous（足し算の核）で解決する。
import { BOARD_SIZES } from "./game/boardDef";
import { createInitialState } from "./game/state";
import { placementRejection, resolveSimultaneous } from "./game/rules";
import type { PlaceKind, Phenomenon } from "./game/stones";
import type { Rejection, PlotInput, ResolveEvent } from "./game/rules";
import { BoardScene } from "./render/boardScene";

const def = BOARD_SIZES["9"];
let state = createInitialState("9"); // 空盤（再代入で局面を進める）

// ラウンド状態（ルール①）。黒→白の順にプロットし、白が確定した瞬間に resolve。
type Phase = "black-plot" | "white-plot";
let phase: Phase = "black-plot";
let blackPlot: PlotInput = null;
let whitePlot: PlotInput = null;
let currentKind: PlaceKind = "stone"; // 石/ポア。両者共通の入力補助（HUD トグル）。

const container = document.getElementById("app");
if (!container) throw new Error("#app が無い");

const scene = new BoardScene(container, def);
scene.setState(state);
// 合法性の判定は game に委ねる。開始 state 基準（両者とも同じ空きを狙えるのは仕様＝同点衝突）。
scene.setLegalityProbe((x, y) => placementRejection(def, state, x, y) === null);

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
  phaseEl.textContent = phase === "black-plot" ? "● 黒がプロット中" : "○ 白がプロット中";
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
  }, 1200);
}

// 現象名の日本語ラベル（HUD の resolve 要約用）。
const PHENOMENON_TEXT: Record<Phenomenon, string> = {
  place: "着手",
  pour: "ポア",
  solidify: "ソリディファイ",
  cancel: "Cancel",
  capture: "相討ち(capture)",
  reduce: "削れ(reduce)",
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

// 現ラウンドを解決して次ラウンド（黒プロット）へ戻す。
function resolveRound(): void {
  const r = resolveSimultaneous(def, state, blackPlot, whitePlot);
  if (r.ok) {
    state = r.state;
    scene.setState(state); // ← この瞬間に両手が同時に盤へ乗る（伏せの解除）
    showEvents(r.events);
  } else {
    // 理論上起きない（プロット時に placementRejection===null 済み）が、来たら拒否表示。
    showReject(r.reason);
  }
  // ラウンドをリセット。
  blackPlot = null;
  whitePlot = null;
  phase = "black-plot";
  scene.setGhosts([]); // 伏せ表現: プロット中はゴーストを出さない
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
  if (phase === "black-plot") {
    blackPlot = null;
    phase = "white-plot";
    updateHud();
  } else {
    whitePlot = null;
    resolveRound();
  }
});

// ---- クリック着手（ルール①: 黒→白の順にプロット、白確定で即 resolve） ----
scene.onPointClick = (x, y) => {
  // 開始 state 基準で合法チェック（両者とも同じ空きを狙えるのは仕様）。
  const reason = placementRejection(def, state, x, y);
  if (reason !== null) {
    showReject(reason);
    return;
  }
  if (phase === "black-plot") {
    blackPlot = { x, y, kind: currentKind };
    phase = "white-plot";
    // 伏せる: 黒のゴーストは見せない（setGhosts([]) のまま）。位置を先に見せない最小表現。
    updateHud();
  } else {
    whitePlot = { x, y, kind: currentKind };
    resolveRound();
  }
};

updateHud();
scene.start();
