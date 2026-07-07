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
import { indexOf, pointCount } from "./game/coords";
import { computeTerritory } from "./game/territory";
import { createInitialState, applyState, paintCell, serialize, deserialize } from "./game/state";
import type { MoveRights, GameState } from "./game/state";
import { PRESETS } from "./game/presets";
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
// 局面エディタ（自由配置・Issue #17）。ON でフェーズ機械を止め、クリックがブラシ塗りになる。
// OFF で loadState 経由でラウンド機械を初手へ戻し、編集結果の cells のままプレイ再開する。
let editMode = false;
let currentBrush = 1; // 選択中ブラシ値 {1,0.5,-1,-0.5,0}。編集クリックでこの値をセルに塗る。

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

// 直近の renderState で算出した territory（水＝地）。スコア表示はこれを数え直すだけで
// computeTerritory を再実行しない（毎手の二重計算を避ける・N4）。renderState が唯一の更新点。
let currentTerritory: number[] = [];

/**
 * state を描画へ反映する。石を「柵」（柱＋同色壁）として setState で描き直し、
 * 一色の柵で囲い切った地を computeTerritory で検出して水（setTerritory）を溜める。
 * state が変わるたびに必ずこの1関数で両方描き直す（片方の更新漏れを防ぐ）。
 * territory は純粋・軽量なので毎手 full recompute でよい（差分・キャッシュは持たない）。
 * 算出した territory は currentTerritory に控え、スコア表示（updateHud）が数え直しに再利用する。
 * （標高＝不安定な地の盛り上がり・流れ出るアニメは次の増分。この段は囲い切った地＝低い池のみ。）
 */
function renderState(): void {
  scene.setState(state);
  const t = computeTerritory(def, state.cells);
  currentTerritory = t.territory;
  scene.setTerritory(t.territory, t.instability);
}

/**
 * territory 配列（±1＝各色の地）から水量スコア（m³）を数える。1マス=1m³。
 * computeTerritory を呼ばず既算出の territory を数えるだけ（毎手の二重計算回避・N4）。
 * pure API の computeScore（territory.ts）と同値だが、HUD は再計算せずここで数える。
 */
function scoreFromTerritory(territory: number[]): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (const v of territory) {
    if (v === 1) black++;
    else if (v === -1) white++;
  }
  return { black: black * RULES.cellCubicMeters, white: white * RULES.cellCubicMeters };
}

renderState();
// 合法性 probe（緑/赤ホバー）。既定は place 判定（main の空点着手・extra の追加ポア共通）。
// ムーブ元選択中は「そこからの合法着地か」に差し替える。
// 開始 state 基準（両者とも同じ空きを狙えるのは仕様＝同点衝突）。
const placeProbe = (x: number, y: number): boolean => placementRejection(def, state, x, y) === null;
// 編集モード中はホバー probe を常に緑（自由配置なので占有・合法手を無視する・Issue #17）。
const editProbe = (): boolean => true;
scene.setLegalityProbe(placeProbe);

// ---- HUD（配線層で DOM 生成。game/render に UI を混ぜない） ----
const hud = document.getElementById("hud");
if (!hud) throw new Error("#hud が無い");
// #hud 自体はクリックを盤に通す（pointer-events:none は index.html）。ボタンだけ auto。
hud.innerHTML = `
  <div id="hud-panel">
    <div class="hud-row"><span id="hud-phase"></span></div>
    <div class="hud-row" id="hud-controls">
      <button id="hud-stone" type="button">石</button>
      <button id="hud-pour" type="button">ポア</button>
      <button id="hud-pass" type="button">パス</button>
    </div>
    <div class="hud-row" id="hud-brushes" hidden>
      <button id="brush-b1" type="button">黒1</button>
      <button id="brush-b05" type="button">黒0.5</button>
      <button id="brush-w1" type="button">白1</button>
      <button id="brush-w05" type="button">白0.5</button>
      <button id="brush-erase" type="button">消す</button>
    </div>
    <div class="hud-row">
      <button id="hud-edit" type="button">編集</button>
      <button id="hud-copy" type="button">JSONコピー</button>
      <button id="hud-load" type="button">JSON読込</button>
    </div>
    <div class="hud-row" id="hud-presets"></div>
    <div class="hud-row" id="hud-count"></div>
    <div class="hud-row" id="hud-score"></div>
    <div class="hud-row" id="hud-rights"></div>
    <div class="hud-row" id="hud-events"></div>
    <div class="hud-row" id="hud-reject"></div>
  </div>
`;

const phaseEl = document.getElementById("hud-phase")!;
const countEl = document.getElementById("hud-count")!;
const scoreEl = document.getElementById("hud-score")!;
const rightsEl = document.getElementById("hud-rights")!;
const eventsEl = document.getElementById("hud-events")!;
const rejectEl = document.getElementById("hud-reject")!;
const stoneBtn = document.getElementById("hud-stone") as HTMLButtonElement;
const pourBtn = document.getElementById("hud-pour") as HTMLButtonElement;
const passBtn = document.getElementById("hud-pass") as HTMLButtonElement;
// 局面エディタ（Issue #17）の DOM 参照。対局コントロール行とブラシ行は編集 ON/OFF で出し分ける。
const editBtn = document.getElementById("hud-edit") as HTMLButtonElement;
const copyBtn = document.getElementById("hud-copy") as HTMLButtonElement;
const loadBtn = document.getElementById("hud-load") as HTMLButtonElement;
const controlsRow = document.getElementById("hud-controls")!;
const brushesRow = document.getElementById("hud-brushes")!;
// ブラシ定義: 黒1(+1)/黒0.5(+0.5)/白1(-1)/白0.5(-0.5)/消す(0)。値は5値ちょうどなので float 等値比較で可。
const brushDefs: { el: HTMLButtonElement; value: number }[] = [
  { el: document.getElementById("brush-b1") as HTMLButtonElement, value: 1 },
  { el: document.getElementById("brush-b05") as HTMLButtonElement, value: 0.5 },
  { el: document.getElementById("brush-w1") as HTMLButtonElement, value: -1 },
  { el: document.getElementById("brush-w05") as HTMLButtonElement, value: -0.5 },
  { el: document.getElementById("brush-erase") as HTMLButtonElement, value: 0 },
];

/** 1.5手の権利を表示用に整形（1.5 なら "1.5"、無ければ "—"）。 */
function fmtRight(v: number): string {
  return v === RULES.maxMoveRight ? "1.5" : "—";
}

/**
 * 編集モードの UI 同期（Issue #17）。編集トグルの active・対局コントロール行/ブラシ行の
 * 出し分け（hidden 属性・CSS の #hud .hud-row[hidden] で確実に非表示）・選択中ブラシの active。
 */
function syncEditUI(): void {
  editBtn.classList.toggle("active", editMode);
  controlsRow.hidden = editMode; // 対局コントロール（石/ポア/パス）は編集中は隠す
  brushesRow.hidden = !editMode; // ブラシパレットは編集中だけ出す
  for (const b of brushDefs) b.el.classList.toggle("active", b.value === currentBrush);
}

function updateHud(): void {
  if (editMode) {
    // 編集中はフェーズ機械を止めているので、フェーズ表示を編集モードの説明に差し替える。
    phaseEl.textContent = "編集モード: ブラシで盤面を直接塗る（OFFでプレイ再開）";
  } else {
    let text: string;
    if (phase === "black-main") text = "● 黒がプロット中";
    else if (phase === "black-extra") text = "● 黒: 追加ポアを選べ（スキップ可）";
    else if (phase === "white-main") text = "○ 白がプロット中";
    else text = "○ 白: 追加ポアを選べ（スキップ可）";
    if (pendingMoveFrom) {
      text += `（移動元 (${pendingMoveFrom.x},${pendingMoveFrom.y}) → 移動先を選べ / もう一度押すと解除）`;
    }
    phaseEl.textContent = text;
  }
  countEl.textContent = `手数: ${state.turnCount}`;
  // 取得済みの地の体積（m³）＝スコア。1マス=1m³（design.md「デジタルならではの解決」）。
  // renderState で算出済みの currentTerritory を数え直すだけ（territory 再計算はしない・N4）。
  const score = scoreFromTerritory(currentTerritory);
  scoreEl.textContent = `地: ● 黒 ${score.black} m³ ／ ○ 白 ${score.white} m³`;
  rightsEl.textContent = `権利 黒:${fmtRight(state.moveRights.black)} 白:${fmtRight(state.moveRights.white)}`;
  stoneBtn.classList.toggle("active", currentKind === "stone");
  pourBtn.classList.toggle("active", currentKind === "pour");
  // extra フェーズでは石/ポアの別は無関係（追加ポアは常に0.5）。パスは「スキップ」表示に。
  passBtn.textContent = isExtraPhase() ? "スキップ" : "パス";
  syncEditUI();
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
/** 任意の拒否メッセージを一定時間だけ赤字表示する（JSON 不正・クリップボード失敗などの自由文用）。 */
function showRejectText(text: string): void {
  rejectEl.textContent = text;
  if (rejectTimer !== undefined) clearTimeout(rejectTimer);
  rejectTimer = window.setTimeout(() => {
    rejectEl.textContent = "";
  }, 1200);
}
function showReject(reason: PlotRejection): void {
  showRejectText(REJECT_TEXT[reason]);
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

// ---- 局面エディタ（自由配置・Issue #17）----
// 編集トグル: ON でフェーズ機械を止めブラシ塗りへ。OFF で loadState 経由でラウンド機械を
// 初手（黒 main）へ戻し、編集結果の cells のままプレイ再開する。
editBtn.addEventListener("click", () => {
  if (!editMode) {
    editMode = true;
    // 対局途中のムーブ元選択が残っていても捨てる（編集は自由配置でムーブ元を持たない）。
    pendingMoveFrom = null;
    scene.setMoveSource(null);
    scene.setLegalityProbe(editProbe); // 編集中はホバー常に緑（占有・合法手を無視）
    rejectEl.textContent = "";
    eventsEl.textContent = "";
    updateHud(); // フェーズ表示を編集モードへ・コントロール/ブラシ行の出し分け・ブラシ active
    scene.refreshHover();
  } else {
    editMode = false;
    // 編集結果を現局面としてラウンド機械を初手へ戻す（既存 loadState と同手順・cells は保持）。
    loadState(state); // updateHud/renderState/refreshHover/probe(placeProbe) をまとめて行う
  }
});

// ブラシ選択: 選択中ブラシ値を currentBrush に据え、active を付け替える。
for (const b of brushDefs) {
  b.el.addEventListener("click", () => {
    currentBrush = b.value;
    updateHud();
  });
}

// 局面をJSONでコピー: serialize(state) をクリップボードへ。失敗は reject 表示。
// 非セキュアコンテキストでは navigator.clipboard が undefined で writeText が .then 前に
// 同期 throw する（N1）。?. で undefined を検知し、同期例外は try/catch で拾って同じ reject に落とす。
copyBtn.addEventListener("click", () => {
  try {
    const p = navigator.clipboard?.writeText(serialize(state));
    if (!p) {
      showRejectText("クリップボードにコピーできません");
      return;
    }
    p.then(
      () => {
        // 成功メッセージは reject と違い自動で消えないので、他の eventsEl 表示（resolve 要約）を
        // 誤って消さないよう、書いた文字列がそのままなら一定時間後にクリアする（N2）。
        const msg = "局面JSONをコピーしました";
        eventsEl.textContent = msg;
        window.setTimeout(() => {
          if (eventsEl.textContent === msg) eventsEl.textContent = "";
        }, 1500);
      },
      () => {
        showRejectText("クリップボードにコピーできません");
      },
    );
  } catch {
    showRejectText("クリップボードにコピーできません");
  }
});

// JSONを貼って読込: prompt で貼らせ deserialize→loadState。不正は try/catch で reject 表示。
loadBtn.addEventListener("click", () => {
  const json = window.prompt("局面JSONを貼り付けてください");
  if (json === null) return; // キャンセル
  const trimmed = json.trim();
  if (trimmed === "") return;
  let next: GameState;
  try {
    next = deserialize(trimmed); // 不正（JSON構文・スキーマ・セル値）は throw で弾かれる
  } catch {
    showRejectText("JSONが不正です");
    return;
  }
  loadState(next); // 復元した局面を現局面に（編集中なら probe は緑を維持）
});

// ---- 局面プリセット（定番局面のワンクリック読み込み）----
// canned GameState を applyState でロードし、ラウンド機械を初手（黒 main）へ戻す。
// resolveRound のリセット手順と同じ（プロット・追加ポア・ムーブ選択を全解除・probe/マーカーを
// place に戻す）。UI 生成・配線は main.ts の責務（game/render に UI を混ぜない既存方針）。

/**
 * loadState に渡す局面の境界検証（S1/Q1・Issue #17）。applyState は cells/cooldown の「長さ」と
 * cell 値域は見るが、盤サイズ互換・turnCount・cooldown 値域・moveRights 値域は見ない。UI は9路固定
 * なので、13/19路の妥当JSONや負の turnCount 等をそのまま適用すると computeTerritory/描画が壊れる。
 * 適用前にここで弾く（null=受理、非null=reject 表示文）。純粋関数（判定のみ・副作用なし）。
 * presets(turnCount 8/20/50・cooldown全0・moveRights{0,0})／空盤／編集OFF(cooldown 0..koCooldownTurns・
 * moveRights 0 or maxMoveRight)は必ず通過する（誤リジェクトを出さない）。cooldown に上限は設けない
 * （整数かつ >=0 のみ＝エンジンの正当値を誤って弾かない）。
 */
function importRejectReason(next: GameState): string | null {
  const nextDef = BOARD_SIZES[next.boardSizeId];
  // UI は9路固定。盤サイズが違う（=交点数が違う）妥当JSONは描画/territory を壊すので非対応扱い。
  if (!nextDef || pointCount(nextDef) !== pointCount(def)) {
    return "この盤サイズには対応していません";
  }
  if (!Number.isInteger(next.turnCount) || next.turnCount < 0) {
    return "局面JSONが不正です";
  }
  for (const v of next.cooldown) {
    if (!Number.isInteger(v) || v < 0) return "局面JSONが不正です";
  }
  const okRight = (r: number): boolean => r === 0 || r === RULES.maxMoveRight;
  if (!okRight(next.moveRights.black) || !okRight(next.moveRights.white)) {
    return "局面JSONが不正です";
  }
  return null;
}

function loadState(next: GameState): void {
  // 境界検証（S1/Q1）。全 loadState 経路（presets/空盤/編集OFF/JSON読込）が通る。不正/非対応は
  // 適用せず現局面を保つ（サイレント破損防止）。applyState 前に弾く。
  const reject = importRejectReason(next);
  if (reject !== null) {
    showRejectText(reject);
    return;
  }
  state = applyState(next); // 検証つきクローン（不正 cells は throw で弾く）
  // ラウンド機械リセット（resolveRound と同手順）。
  blackPlot = null;
  whitePlot = null;
  blackExtra = null;
  whiteExtra = null;
  phase = "black-main";
  pendingMoveFrom = null;
  scene.setMoveSource(null);
  // 編集モード中に読み込まれた（プリセット/JSON/空盤）なら probe は緑固定を維持する。
  scene.setLegalityProbe(editMode ? editProbe : placeProbe);
  rejectEl.textContent = "";
  eventsEl.textContent = "";
  renderState(); // 柵＋水を描き直す（currentTerritory も更新）
  updateHud(); // スコア・手数・権利・フェーズ表示を更新
  scene.refreshHover(); // 盤が変わったのでホバー色（緑/赤）を即再評価
}

const presetsEl = document.getElementById("hud-presets")!;
for (const p of PRESETS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = p.name;
  btn.addEventListener("click", () => loadState(p.state()));
  presetsEl.appendChild(btn);
}
// 空盤に戻すボタン（プリセットと同じ経路でリセット）。
const emptyBtn = document.createElement("button");
emptyBtn.type = "button";
emptyBtn.textContent = "空盤";
emptyBtn.addEventListener("click", () => loadState(createInitialState("9")));
presetsEl.appendChild(emptyBtn);

// ---- クリック（ルール①同時プロット＋②追加ポア＋③ムーブ）----
scene.onPointClick = (x, y) => {
  // 編集モード（自由配置・Issue #17）: フェーズ機械を通さず、ブラシ値で直接セルを塗る。
  // 占有・cooldown・合法手判定は無視（turnCount/cooldown/moveRights は paintCell が据え置く）。
  if (editMode) {
    state = paintCell(state, indexOf(def, x, y), currentBrush);
    renderState(); // 柵＋水＋標高をライブ再描画（囲い切れば凪の池・薄い囲みは高く揺れる）
    updateHud(); // スコア（m³）表示を更新
    return;
  }

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
