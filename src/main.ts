// エントリ（配線層）。state と描画層と HUD を繋ぐだけ。
// ゲームロジックは src/game、描画は src/render。ここは両者の配線と UI 生成のみ。
//
// ルール①同時プロット制＋ルール②1.5手（星パックマン）＋ルール③ムーブ。
// 先手後手なし。黒→白の順に「位置を伏せて」プロットし、白確定で両手を同時公開して
// resolveSimultaneous（足し算の核）で解決する。
// ルール②: 星・天元へ着地した手番は 1.5 手の権利を獲得（上限1.5・上書き・取られても消えない）。
//   権利1.5を持つ手番は、そのラウンドで通常の1手＋追加ポア0.5（extra）を1つ打てる。
//   フェーズ機械: black-main →(黒1.5なら) black-extra → white-main →(白1.5なら) white-extra → resolve。
// ルール③ ムーブ: 自分の 0.5 をクリック→隣接8マスの移動先を選ぶ（0.5のみ・1石不可）。
//   同時ムーブが同一着点なら tris（3点空く）、相互なら swap（0.5 入替）。
import { BOARD_SIZES, RULES } from "./game/boardDef";
import { indexOf } from "./game/coords";
import { computeTerritory } from "./game/territory";
import { createInitialState } from "./game/state";
import type { MoveRights } from "./game/state";
import { placementRejection, resolveSimultaneous, moveRejection, extraRejection } from "./game/rules";
import type { PlaceKind, Phenomenon, Player } from "./game/stones";
import type { PlotRejection, PlotInput, Plot, ExtraInput, ResolveEvent } from "./game/rules";
import { BoardScene } from "./render/boardScene";

const def = BOARD_SIZES["9"];
let state = createInitialState("9"); // 空盤（再代入で局面を進める）

// ラウンド状態（ルール①②③）。黒 main →(黒extra)→ 白 main →(白extra)→ resolve。
// extra は「1.5手の権利を持つ手番だけが打てる追加ポア0.5」の着地点（ルール②）。
type Phase = "black-main" | "black-extra" | "white-main" | "white-extra";
let phase: Phase = "black-main";
let blackPlot: PlotInput = null;
let whitePlot: PlotInput = null;
let blackExtra: ExtraInput = null;
let whiteExtra: ExtraInput = null;
let currentKind: PlaceKind = "stone"; // 石/ポア。両者共通の入力補助（HUD トグル）。
// ルール③ 現手番のムーブ元選択（自分の 0.5 をクリックして選び、次クリックで移動先）。
let pendingMoveFrom: { x: number; y: number } | null = null;

/** 現在プロット中の手番（main/extra いずれも同じ手番）。 */
function currentPlayer(): Player {
  return phase === "black-main" || phase === "black-extra" ? "black" : "white";
}

/** いま追加ポア（extra）を選ぶフェーズか。 */
function isExtraPhase(): boolean {
  return phase === "black-extra" || phase === "white-extra";
}

/** その手番が 1.5 手の権利を持つ（extra を打てる）か。開始 state 基準。 */
function hasMoveRight(player: Player): boolean {
  return state.moveRights[player] === RULES.maxMoveRight;
}

const container = document.getElementById("app");
if (!container) throw new Error("#app が無い");

const scene = new BoardScene(container, def);

/**
 * state を描画へ反映する。石を「柵」（柱＋同色壁）として setState で描き直し、
 * 一色の柵で囲い切った地を computeTerritory で検出して水（setTerritory）を溜める。
 * state が変わるたびに必ずこの1関数で両方描き直す（片方の更新漏れを防ぐ）。
 * territory は純粋・軽量なので毎手 full recompute でよい（差分・キャッシュは持たない）。
 * （標高＝不安定な地の盛り上がり・流れ出るアニメは次の増分。この段は囲い切った地＝低い池のみ。）
 */
function renderState(): void {
  scene.setState(state);
  const t = computeTerritory(def, state.cells);
  scene.setTerritory(t.territory, t.instability);
}

renderState();
// 合法性 probe（緑/赤ホバー）。既定は place 判定（main の空点着手・extra の追加ポア共通）。
// ムーブ元選択中は「そこからの合法着地か」に差し替える。
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
    <div class="hud-row" id="hud-rights"></div>
    <div class="hud-row" id="hud-events"></div>
    <div class="hud-row" id="hud-reject"></div>
  </div>
`;

const phaseEl = document.getElementById("hud-phase")!;
const countEl = document.getElementById("hud-count")!;
const rightsEl = document.getElementById("hud-rights")!;
const eventsEl = document.getElementById("hud-events")!;
const rejectEl = document.getElementById("hud-reject")!;
const stoneBtn = document.getElementById("hud-stone") as HTMLButtonElement;
const pourBtn = document.getElementById("hud-pour") as HTMLButtonElement;
const passBtn = document.getElementById("hud-pass") as HTMLButtonElement;

/** 1.5手の権利を表示用に整形（1.5 なら "1.5"、無ければ "—"）。 */
function fmtRight(v: number): string {
  return v === RULES.maxMoveRight ? "1.5" : "—";
}

function updateHud(): void {
  let text: string;
  if (phase === "black-main") text = "● 黒がプロット中";
  else if (phase === "black-extra") text = "● 黒: 追加ポアを選べ（スキップ可）";
  else if (phase === "white-main") text = "○ 白がプロット中";
  else text = "○ 白: 追加ポアを選べ（スキップ可）";
  if (pendingMoveFrom) {
    text += `（移動元 (${pendingMoveFrom.x},${pendingMoveFrom.y}) → 移動先を選べ / もう一度押すと解除）`;
  }
  phaseEl.textContent = text;
  countEl.textContent = `手数: ${state.turnCount}`;
  rightsEl.textContent = `権利 黒:${fmtRight(state.moveRights.black)} 白:${fmtRight(state.moveRights.white)}`;
  stoneBtn.classList.toggle("active", currentKind === "stone");
  pourBtn.classList.toggle("active", currentKind === "pour");
  // extra フェーズでは石/ポアの別は無関係（追加ポアは常に0.5）。パスは「スキップ」表示に。
  passBtn.textContent = isExtraPhase() ? "スキップ" : "パス";
}

const REJECT_TEXT: Record<PlotRejection, string> = {
  occupied: "そこには石がある",
  cooldown: "連続配置禁止（cooldown中）",
  "out-of-bounds": "盤の外",
  "not-your-half": "自分の0.5だけ動かせる",
  "not-adjacent": "隣接8マスのみ",
  "illegal-landing": "着地の値が石の上限(±1)を超える",
  "no-move-right": "1.5手の権利がない",
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

/**
 * resolve 結果を HUD に要約する。現象イベントに加え、moveRights が前後で増えた手番があれば
 * 「チャージ（1.5手獲得）」を併記する（ルール②の星取得通知は前後比較で検知）。
 */
function showEvents(events: ResolveEvent[], before: MoveRights, after: MoveRights): void {
  const parts: string[] = [];
  if (events.length === 0) {
    parts.push("両者パス");
  } else {
    parts.push(events.map((e) => `(${e.x},${e.y}) ${PHENOMENON_TEXT[e.phenomenon]}`).join(" / "));
  }
  const charges: string[] = [];
  if (after.black > before.black) charges.push("● チャージ（1.5手獲得）");
  if (after.white > before.white) charges.push("○ チャージ（1.5手獲得）");
  eventsEl.textContent =
    "解決: " + parts.join(" / ") + (charges.length ? " ／ " + charges.join(" / ") : "");
}

// ムーブ元の選択を解除して place モードへ戻す（probe / マーカー / HUD を戻す）。
function clearMoveSelection(): void {
  pendingMoveFrom = null;
  scene.setMoveSource(null);
  scene.setLegalityProbe(placeProbe);
  updateHud();
  scene.refreshHover();
}

// 現フェーズの入力が確定した後に呼ぶ。フェーズ機械を1段進める。
//   black-main →(黒1.5なら) black-extra → white-main →(白1.5なら) white-extra → resolve。
function advanceTurn(): void {
  switch (phase) {
    case "black-main":
      phase = hasMoveRight("black") ? "black-extra" : "white-main";
      break;
    case "black-extra":
      phase = "white-main";
      break;
    case "white-main":
      if (hasMoveRight("white")) {
        phase = "white-extra";
      } else {
        resolveRound();
        return;
      }
      break;
    case "white-extra":
      resolveRound();
      return;
  }
  updateHud();
  scene.refreshHover();
}

// 現手番の main プロットを確定する。
function setPlot(player: Player, plot: PlotInput): void {
  if (player === "black") blackPlot = plot;
  else whitePlot = plot;
}

// 現手番の追加ポア（extra）を確定する（null=スキップ）。
function setExtra(player: Player, extra: ExtraInput): void {
  if (player === "black") blackExtra = extra;
  else whiteExtra = extra;
}

// 現ラウンドを解決して次ラウンド（黒 main）へ戻す。
function resolveRound(): void {
  const before = { ...state.moveRights }; // 星取得（チャージ）検知用に前値を控える
  const r = resolveSimultaneous(def, state, blackPlot, whitePlot, blackExtra, whiteExtra);
  if (r.ok) {
    state = r.state;
    renderState(); // ← この瞬間に両手＋追加ポアが同時に盤へ乗る（伏せの解除）
    showEvents(r.events, before, state.moveRights);
  } else {
    // 理論上起きない（プロット時に検証済み）が、来たら拒否表示。
    showReject(r.reason);
  }
  // ラウンドをリセット（プロット・追加ポア・ムーブ選択を必ず解除・probe/マーカーを place に戻す）。
  blackPlot = null;
  whitePlot = null;
  blackExtra = null;
  whiteExtra = null;
  phase = "black-main";
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

// ---- パス / スキップ ----
// main フェーズ: 現手番の plot を null にして次へ。extra フェーズ: 追加ポアをスキップ（null）。
passBtn.addEventListener("click", () => {
  // ムーブ元選択中でも、パスは選択を捨てて手番を進める。
  pendingMoveFrom = null;
  scene.setMoveSource(null);
  scene.setLegalityProbe(placeProbe);
  if (isExtraPhase()) {
    setExtra(currentPlayer(), null); // スキップ: 追加ポアを打たない
  } else {
    setPlot(currentPlayer(), null); // パス: 通常の手を打たない
  }
  advanceTurn();
});

// ---- クリック（ルール①同時プロット＋②追加ポア＋③ムーブ）----
scene.onPointClick = (x, y) => {
  const player = currentPlayer();

  // extra フェーズ: 追加ポア0.5 の着地点を選ぶ（空点のみ・ムーブ元選択は無い）。
  // 権利・着点の合法性に加え、同一手番の main と同点に重なって合算が超過する場合まで
  // extraRejection で入力時に弾く（resolve まで持ち越すとラウンド全破棄になるため即フィードバック）。
  if (isExtraPhase()) {
    const mainPlot = player === "black" ? blackPlot : whitePlot;
    const reason = extraRejection(def, state, player, mainPlot, { x, y });
    if (reason !== null) {
      showReject(reason);
      return;
    }
    setExtra(player, { x, y }); // 伏せる: resolve 時に main と同時公開。
    advanceTurn();
    return;
  }

  // 以下 main フェーズ（既存のルール①③入力）。
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
