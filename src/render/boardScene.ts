// 描画層。GameState を読んで Three.js で盤面を描くだけ。ゲームロジックは持たない。
// 単一責務: ここに勝敗判定や着手処理を混ぜない（src/game に置く）。
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BoardSizeDef } from "../game/boardDef";
import type { GameState } from "../game/state";
// inBounds の型・関数 import は「描画→game」の一方向依存なので規律に反しない。
// 合法判定・commit は持ち込まない（それは配線層 main.ts の責務）。
import { fromIndex, indexOf, inBounds } from "../game/coords";

const COLORS = {
  bg: 0x0a0e14,
  board: 0x123047,
  grid: 0x3f6f96,
  star: 0x6fb0e0,
  // 黒チームの柵色。暗い盤(0x123047)に沈まないよう視認できる濃紺グレーへ上げる（白柵とは十分別色）。
  black: 0x2f4a63,
  white: 0xeef4fb,
  legal: 0x4fe08a, // ホバー標示（置ける）＝緑
  illegal: 0xe0544f, // ホバー標示（置けない）＝赤
  moveSource: 0xf5b942, // ムーブ元の選択マーカー＝琥珀（ホバーリングと別色）
  // 柵（石＝境界線）の2色。黒石＝暗い柵色・白石＝明るい柵色（丸い碁石は描かない）。
  // black/white を柵の柱・壁の両方に流用する。
  // 取得済みの地（水）の2色。黒（+）の地＝暗い水色／白（−）の地＝明るい水色。
  // 黒水も盤に沈まないよう見える青へ上げる（白水とは十分別色）。
  waterBlack: 0x1c5f8c, // 黒（+）が囲い切った地の流体色
  waterWhite: 0xd6eeff, // 白（−）が囲い切った地の流体色
};

// 交点平面の y（格子線と同じ高さ）。raycast で拾う水平面。
const POINT_PLANE_Y = 0.01;
// スナップ許容距離（board 単位）。最近傍交点からこれ以内でだけ着手扱いにする。
const SNAP_THRESHOLD = 0.5;
// クリックとカメラドラッグの弁別しきい値（px）。これ未満の移動をクリックとみなす。
const CLICK_MOVE_THRESHOLD_PX = 6;

// ---- 柵（石＝境界線）レンダリングの定数（描画寄り。game/RULES には置かない）----
// 盤は XZ 平面・Y 上。各石は交点に立つ縦の柱＋同色隣接（8近傍）を結ぶ連結線で描く（丸い碁石は描かない）。
// 視覚文法（確定）: 色=黒/白／不透明=1石・半透明=0.5石／実線=両端1石・破線=どちらか0.5石。
// 太さ・高さは全て一定（直交/斜め・実線/破線で高さや太さを変えない＝高さで意味を持たせない）。柵は静止。
const FENCE_HEIGHT = 0.5; // 柱の高さ（board 単位）。全柱で一定。
const POST_THICK = 0.12; // 柱の断面（正方形の一辺）。全柱で一定。
// 連結線（同色隣接ペアを結ぶ板）。直交でも斜めでも太さ・高さは同じ。
const LINK_THICK = 0.07; // 連結線の板厚。全線一定。
const LINK_HEIGHT = FENCE_HEIGHT * 0.9; // 連結線の高さ。全線一定（柱をわずかに節として残す）。
// 破線（連結線のどちらかの端点が0.5石のとき）。両端1石の実線は破線化しない。直交/斜め共通のダッシュ生成。
const DASH_COUNT = 3; // 1連結線を何本の破線に割るか（間に隙間が空く）。
const DASH_FILL = 0.55; // 各破線が区間長に占める割合（残りが隙間）。
// 0.5石が絡む柵の不透明度（半透明）。1石だけの柵は 1.0（不透明）。
const HALF_OPACITY = 0.5;

// ---- 水（取得済みの地）レンダリングの定数 ----
// 一色の柵で囲い切った空点＝その色の水を、海抜0付近の凪の池として平たいタイルで溜める。
// 中立(0)・石セルは水なし（乾く）。この段では標高・流れは付けない（次段）。
// 水面の基底高さ（board 単位）。確定地の揺らぎの谷（WATER_Y − AMP*BASE = 0.10 − 0.035 = 0.065）が
// 板上面(0)・格子線(0.01)を確実に上回るよう底上げする（低すぎると谷が板に接触して地面に沈む）。
const WATER_Y = 0.1;
const WATER_TILE_HALF = 0.5; // 水タイルの半辺。交点を中心にセル境界まで＝隣接同色が連続して一つの池に見える。
const WATER_OPACITY = 0.5; // 水面の不透明度（半透明・下の格子が薄く透ける）。
// 不安定な地は高く盛り上がる（design.md「薄い囲み=不安定=高い/今にも流れ出す」）。
// instability∈[0,1] を持ち上げ量へ写す。柵の高さ(0.5)を超えないよう
// WATER_Y + WATER_RISE + WATER_WOBBLE_AMP*(WATER_WOBBLE_BASE+1) < 0.5 に収める。
// 底上げした WATER_Y(0.10) に合わせて縮小: 0.10 + 0.27 + 0.07*1.5 = 0.475 < 0.5 で柵を超えない。
const WATER_RISE = 0.27; // instability=1 の地の追加標高。基底 WATER_Y からの持ち上げ。
// 液体感の揺らぎ。時刻は render の clock、位相は頂点座標から決定的に（Math.random/Date 不使用）。
// 凪の池でも水は生きて動く: 振幅は instability=0 でも WATER_WOBBLE_BASE ぶんは揺れ、
// 不安定なほど強く揺れる（確定地=0.5倍のゆったり／不安定地=1.5倍の強い波）。
const WATER_WOBBLE_FREQ = 1.4; // 揺らぎの角速度（rad/s 相当）。
const WATER_WOBBLE_AMP = 0.07; // 振幅の基準（実効振幅 = AMP*(BASE+instability)、instability=1 で最大 AMP*1.5）。
const WATER_WOBBLE_BASE = 0.5; // instability=0（確定地）でも凍らせない下駄。凪の池も 0.5 倍でゆったり揺れる。
const WATER_WOBBLE_PHASE_X = 1.3;
const WATER_WOBBLE_PHASE_Z = 2.1;

export class BoardScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly stoneGroup = new THREE.Group();
  // 取得済みの地（水）の専用 Group。setTerritory で毎手 clear→描き直す（geometry/material dispose）。
  private readonly waterGroup = new THREE.Group();
  // 水面の揺らぎ用の頂点別データ（setTerritory で作り直す）。start() の RAF で Y を毎フレーム更新する。
  // baseY=不安定さで持ち上げた静止 Y、amp=揺らぎ振幅(=AMP*(BASE+instability)・確定地でも下駄で>0)、phase=頂点座標由来の決定的位相。
  private waterAnim: {
    posAttr: THREE.BufferAttribute;
    baseY: Float32Array;
    amp: Float32Array;
    phase: Float32Array;
  }[] = [];
  private readonly def: BoardSizeDef;
  private running = false;
  private readonly onResize = () => this.resize();

  /** 交点クリック通知。配線層（main.ts）が着手判定・commit を行う。 */
  onPointClick?: (x: number, y: number) => void;

  // raycast 用の使い回しオブジェクト（毎フレーム new を避ける）。
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -POINT_PLANE_Y);
  private readonly ndc = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();

  // クリック / ドラッグ弁別のための pointerdown 位置。
  private downX = 0;
  private downY = 0;
  private downTracked = false;

  // 最後のポインタ位置。着手後に同じ場所のホバー色を再評価する（refreshHover）ために保持。
  private lastPointerX = 0;
  private lastPointerY = 0;
  private hasLastPointer = false;

  // ホバー標示のリング（1つを使い回す）。合法性は外注注入の probe で色分け。
  private readonly hoverRing: THREE.Mesh;
  private readonly hoverRingMat: THREE.MeshBasicMaterial;
  private legalityProbe?: (x: number, y: number) => boolean;

  // ムーブ元の選択マーカー（ルール③）。ホバーリングとは別の1つを使い回す。
  // 判定は持ち込まない。main.ts が座標を渡して出す/隠す。
  private readonly moveSourceRing: THREE.Mesh;
  private readonly moveSourceRingMat: THREE.MeshBasicMaterial;

  // 時刻は render 側だけが持つ（game は純粋・時刻を持てない）。水面の揺らぎに使う（柵は静止）。
  private readonly clock = new THREE.Clock();

  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private readonly onPointerCancel = () => this.handlePointerCancel();
  private readonly onPointerLeave = () => this.handlePointerLeave();

  constructor(
    private readonly container: HTMLElement,
    def: BoardSizeDef,
  ) {
    this.def = def;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);

    const span = def.lines - 1;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    // x は盤中心（span/2）に合わせて左右対称に。y を上げ z を引いて盤全体を
    // フレーム内へ（近い手前の辺が下で切れないようにする）。
    this.camera.position.set(span / 2, span * 1.2, span * 1.55);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(span / 2, 0, span / 2);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(span, span * 1.5, span * 0.5);
    this.scene.add(dir);

    this.buildBoard();
    this.scene.add(this.waterGroup); // 水（地）は柵の下に溜まる。先に足す。
    this.scene.add(this.stoneGroup);

    // ホバー標示リング（薄い水平トーラス）。初期は隠す。
    this.hoverRingMat = new THREE.MeshBasicMaterial({
      color: COLORS.legal,
      transparent: true,
      opacity: 0.85,
    });
    this.hoverRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 8, 32), this.hoverRingMat);
    this.hoverRing.rotation.x = -Math.PI / 2; // 盤面に寝かせる
    this.hoverRing.position.y = 0.03;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);

    // ムーブ元の選択マーカー（ホバーリングより一回り大きい琥珀リング）。初期は隠す。
    this.moveSourceRingMat = new THREE.MeshBasicMaterial({
      color: COLORS.moveSource,
      transparent: true,
      opacity: 0.9,
    });
    this.moveSourceRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.06, 8, 32),
      this.moveSourceRingMat,
    );
    this.moveSourceRing.rotation.x = -Math.PI / 2;
    this.moveSourceRing.position.y = 0.04;
    this.moveSourceRing.visible = false;
    this.scene.add(this.moveSourceRing);

    // pointer イベントは canvas（renderer.domElement）に張る。
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("pointerleave", this.onPointerLeave);

    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  /**
   * 合法性 probe を注入する。BoardScene 自身は game を判定に使わず、色を塗るだけ。
   * main.ts が (x,y)=>canPlaceAt(def, state, x, y) を渡す。
   */
  setLegalityProbe(fn: (x: number, y: number) => boolean): void {
    this.legalityProbe = fn;
  }

  /**
   * ムーブ元の選択マーカーを (x,y) に出す（null で隠す）。ルール③のムーブ入力用。
   * 合法判定は持ち込まない（座標を受けて出す/隠すだけ）。配線層 main.ts が制御する。
   */
  setMoveSource(p: { x: number; y: number } | null): void {
    if (!p) {
      this.moveSourceRing.visible = false;
      return;
    }
    this.moveSourceRing.position.set(p.x, 0.04, p.y);
    this.moveSourceRing.visible = true;
  }

  /**
   * クリック座標（clientX/Y）から最近傍の整数交点を拾う。
   * 交点平面に raycast し、round でスナップ、盤内かつスナップ距離が閾値内なら返す。
   */
  private pickPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    // 平面に当たらない（水平視線）場合は null。
    if (!this.raycaster.ray.intersectPlane(this.pointerPlane, this.hitPoint)) return null;

    const x = Math.round(this.hitPoint.x);
    const y = Math.round(this.hitPoint.z); // 交点は XZ 平面配置（z が y 座標）
    if (!inBounds(this.def, x, y)) return null;
    // スナップ距離チェック（最近傍交点から離れすぎていたら無効）。
    const dx = this.hitPoint.x - x;
    const dz = this.hitPoint.z - y;
    if (Math.hypot(dx, dz) > SNAP_THRESHOLD) return null;
    return { x, y };
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // 左ボタンのみ着手対象
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downTracked = true;
    // ポインタキャプチャで、canvas 外で離しても pointerup を必ず受け取る
    // （downTracked が張り付いて次 down まで残るのを防ぐ）。合成イベント等で
    // pointerId が無い場合に備えて try/catch で握りつぶす。
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* pointerId が無い合成イベント等では無視 */
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.downTracked) return;
    this.downTracked = false;
    // カメラドラッグ（OrbitControls）で動いた分が大きければクリックとみなさない。
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    if (moved >= CLICK_MOVE_THRESHOLD_PX) return;
    const p = this.pickPoint(e.clientX, e.clientY);
    if (p) this.onPointClick?.(p.x, p.y);
  }

  private handlePointerCancel(): void {
    // ジェスチャ中断（pointercancel）。クリック追跡をリセットして張り付きを防ぐ。
    this.downTracked = false;
  }

  private handlePointerLeave(): void {
    // canvas から出たらホバー標示を消し、最後の位置も忘れる。
    this.hoverRing.visible = false;
    this.hasLastPointer = false;
  }

  private handlePointerMove(e: PointerEvent): void {
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.hasLastPointer = true;
    this.updateHoverAt(e.clientX, e.clientY);
  }

  /**
   * 直近のポインタ位置でホバー標示を更新する。着手後に呼べば、置いた点が
   * occupied/cooldown になった結果（緑→赤）を次のマウス移動を待たずに反映できる。
   */
  refreshHover(): void {
    if (!this.hasLastPointer) return;
    this.updateHoverAt(this.lastPointerX, this.lastPointerY);
  }

  /** clientX/Y の交点にホバーリングを合わせ、probe で合法=緑/非合法=赤に塗る。 */
  private updateHoverAt(clientX: number, clientY: number): void {
    const p = this.pickPoint(clientX, clientY);
    if (!p) {
      this.hoverRing.visible = false;
      return;
    }
    // 合法なら緑、非合法なら赤。probe 未注入なら緑（中立）で標示だけ出す。
    const legal = this.legalityProbe ? this.legalityProbe(p.x, p.y) : true;
    this.hoverRingMat.color.setHex(legal ? COLORS.legal : COLORS.illegal);
    this.hoverRing.position.set(p.x, 0.03, p.y);
    this.hoverRing.visible = true;
  }

  /** 盤（板・格子線・星）を組む。GameState に依存しない静的ジオメトリ。 */
  private buildBoard(): void {
    const span = this.def.lines - 1;

    // 板
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(span + 1.4, 0.4, span + 1.4),
      new THREE.MeshStandardMaterial({ color: COLORS.board, roughness: 0.9 }),
    );
    board.position.set(span / 2, -0.2, span / 2);
    this.scene.add(board);

    // 格子線
    const gridMat = new THREE.LineBasicMaterial({ color: COLORS.grid });
    const pts: number[] = [];
    for (let i = 0; i < this.def.lines; i++) {
      pts.push(0, 0.01, i, span, 0.01, i); // 横線
      pts.push(i, 0.01, 0, i, 0.01, span); // 縦線
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(new THREE.LineSegments(geom, gridMat));

    // 星
    const starMat = new THREE.MeshStandardMaterial({ color: COLORS.star });
    for (const [sx, sy] of this.def.starPoints) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), starMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(sx, 0.02, sy);
      this.scene.add(dot);
    }
  }

  /**
   * GameState の cells を「柵」（柱＋同色壁）として描き直す。丸い碁石は描かない。
   * 各交点に立つ柱を置き、同色の直交隣接は実線壁、同色の斜め隣接は隙間ある斜め線で繋ぐ。
   * 二重描画を避けるため、壁は各石から +x/+z（直交）と +x+z/+x−z（斜め）方向の隣だけ見る。
   * 1石＝不透明の硬い柵／0.5石が絡む柵＝半透明で揺らぐ壊れやすい柵。
   */
  setState(state: GameState): void {
    this.clearStones();
    const cells = state.cells;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v === 0) continue;
      const { x, y } = fromIndex(this.def, i);
      const isBlack = v > 0;
      const isFull = Math.abs(v) === 1;
      // 柵ノード（各石）＝交点に立つ縦の柱。
      this.addPost(x, y, isBlack, isFull);
      // 同色隣接（8近傍）を連結線で結ぶ。二重描画回避で +x/+z/+x+z/+x−z の4方向だけ見る。
      // 直交/斜めは幾何が違うだけで、実線/破線・不透明/半透明は端点の石種(1/0.5)だけで決まる。
      this.addLinkIfSameColor(cells, x, y, v, x + 1, y); // 直交 +x
      this.addLinkIfSameColor(cells, x, y, v, x, y + 1); // 直交 +z
      this.addLinkIfSameColor(cells, x, y, v, x + 1, y + 1); // 斜め +x+z
      this.addLinkIfSameColor(cells, x, y, v, x + 1, y - 1); // 斜め +x−z
    }
  }

  /** stoneGroup の子（柵メッシュ）のジオメトリ/マテリアルを解放してから空にする（毎手のリーク防止）。 */
  private clearStones(): void {
    for (const child of this.stoneGroup.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const m = child.material;
        if (Array.isArray(m)) for (const mm of m) mm.dispose();
        else m.dispose();
      }
    }
    this.stoneGroup.clear();
  }

  /**
   * 取得済みの地（territory）を水として溜める。territory[i]/instability[i] は computeTerritory の出力:
   * territory=+1黒の地 / −1白の地 / 0中立（乾く）・石セル。±1 の空点だけに半透明の平たい水面タイルを置く。
   * 基底 Y は instability で持ち上げる（確定地=海抜0の凪／不安定=高く今にも流れ出す）。隣接する同色タイルは
   * セル境界で連続して一つの池に見える。黒/白ごとに1メッシュへマージ（描画コスト・continuity）。
   * 揺らぎは start() の RAF で足す（確定地も下駄でゆったり揺れ、不安定なほど強い）。毎手 clear→描き直す（リーク防止）。
   */
  setTerritory(territory: number[], instability: number[]): void {
    this.clearWater();
    this.addWaterMesh(territory, instability, 1); // 黒（+）の地＝暗い水色
    this.addWaterMesh(territory, instability, -1); // 白（−）の地＝明るい水色
  }

  /** territory の sign(+1黒/−1白) のセルを1枚のマージ水面メッシュにして waterGroup へ足す。 */
  private addWaterMesh(territory: number[], instability: number[], sign: number): void {
    const positions: number[] = [];
    const indices: number[] = [];
    const baseYs: number[] = [];
    const amps: number[] = [];
    const phases: number[] = [];
    let quads = 0;
    for (let i = 0; i < territory.length; i++) {
      if (territory[i] !== sign) continue;
      const { x, y } = fromIndex(this.def, i);
      const inst = instability[i];
      const baseY = WATER_Y + inst * WATER_RISE; // 不安定なほど高い（凪 inst0 は海抜0付近）
      // 実効振幅は下駄(BASE)＋instability。確定地(inst0)も BASE ぶんゆったり揺れ、凍らない。
      const amp = WATER_WOBBLE_AMP * (WATER_WOBBLE_BASE + inst);
      const x0 = x - WATER_TILE_HALF;
      const x1 = x + WATER_TILE_HALF;
      const z0 = y - WATER_TILE_HALF;
      const z1 = y + WATER_TILE_HALF;
      // 交点 (x,y) を中心に ±half の水平タイル（Y=baseY）。4頂点 → 2三角形。角の順は (x0,z0)(x1,z0)(x1,z1)(x0,z1)。
      const corners: ReadonlyArray<readonly [number, number]> = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ];
      for (const [cx, cz] of corners) {
        positions.push(cx, baseY, cz);
        baseYs.push(baseY);
        amps.push(amp);
        phases.push(cx * WATER_WOBBLE_PHASE_X + cz * WATER_WOBBLE_PHASE_Z); // 座標から決定的
      }
      const b = quads * 4;
      // 巻き順は法線が +Y（上）を向くように（XZ 平面・Y 上）。
      indices.push(b, b + 2, b + 1, b, b + 3, b + 2);
      quads++;
    }
    if (quads === 0) return; // その色の地が無ければメッシュを作らない（空盤＝水なし）

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: sign > 0 ? COLORS.waterBlack : COLORS.waterWhite,
      transparent: true,
      opacity: WATER_OPACITY,
      roughness: 0.15,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.waterGroup.add(new THREE.Mesh(geom, mat));
    // 揺らぎ用の頂点データを登録（RAF で Y を更新する）。
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    this.waterAnim.push({
      posAttr,
      baseY: new Float32Array(baseYs),
      amp: new Float32Array(amps),
      phase: new Float32Array(phases),
    });
  }

  /**
   * 水面の揺らぎ。時刻 t を read して各頂点 Y を baseY + amp*sin(t*FREQ + phase) に更新する。
   * amp は下駄(BASE)ぶん常に>0＝全頂点が揺れる（確定地はゆったり・不安定は強く）。
   * amp===0 ガードは残すが実質発火しない。game は時刻を持てないので揺らぎは render のここだけで足す。
   */
  private animateWater(): void {
    if (this.waterAnim.length === 0) return;
    const t = this.clock.getElapsedTime();
    for (const w of this.waterAnim) {
      const positions = w.posAttr.array as Float32Array;
      let moved = false;
      for (let vi = 0; vi < w.baseY.length; vi++) {
        if (w.amp[vi] === 0) continue; // 下駄で amp>0 のため実質無効（保険として残す）
        positions[vi * 3 + 1] = w.baseY[vi] + w.amp[vi] * Math.sin(t * WATER_WOBBLE_FREQ + w.phase[vi]);
        moved = true;
      }
      if (moved) w.posAttr.needsUpdate = true;
    }
  }

  /** waterGroup の子（水面メッシュ）のジオメトリ/マテリアルを解放してから空にする（毎手のリーク防止）。 */
  private clearWater(): void {
    for (const child of this.waterGroup.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const m = child.material;
        if (Array.isArray(m)) for (const mm of m) mm.dispose();
        else m.dispose();
      }
    }
    this.waterGroup.clear();
    this.waterAnim = [];
  }

  /** 柵の柱/連結線用マテリアル。opacity=1.0＝不透明の硬い柵（1石だけ）／0.5＝半透明（0.5石が絡む）。 */
  private fenceMaterial(isBlack: boolean, opacity: number): THREE.MeshStandardMaterial {
    const solid = opacity >= 1;
    return new THREE.MeshStandardMaterial({
      color: isBlack ? COLORS.black : COLORS.white,
      roughness: solid ? 0.5 : 0.25,
      metalness: 0,
      transparent: !solid,
      opacity,
    });
  }

  /** 柵ノード（各石）＝交点 (x,z) に立つ縦の柱。1石=不透明／0.5石=半透明。太さ・高さは全柱一定・静止。 */
  private addPost(x: number, z: number, isBlack: boolean, isFull: boolean): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(POST_THICK, FENCE_HEIGHT, POST_THICK),
      this.fenceMaterial(isBlack, isFull ? 1 : HALF_OPACITY),
    );
    mesh.position.set(x, FENCE_HEIGHT / 2, z);
    this.stoneGroup.add(mesh);
  }

  /**
   * (x,z) の石 v と隣 (nx,nz) が同色なら連結線を引く。異色・空点・盤外は引かない。
   * 視覚文法（確定）: 両端とも1石→実線・不透明／どちらかが0.5石→破線・半透明。直交/斜めは無関係。
   */
  private addLinkIfSameColor(cells: number[], x: number, z: number, v: number, nx: number, nz: number): void {
    if (!inBounds(this.def, nx, nz)) return;
    const nv = cells[indexOf(this.def, nx, nz)];
    if (nv === 0) return;
    if (v > 0 !== nv > 0) return; // 異色は繋がない
    const isBlack = v > 0;
    // 石種だけで決める: 両端1石なら実線・不透明、どちらか0.5なら破線・半透明。
    const solid = Math.abs(v) === 1 && Math.abs(nv) === 1;
    this.addLink(x, z, nx, nz, isBlack, !solid, solid ? 1 : HALF_OPACITY);
  }

  /**
   * 同色隣接ペア (ax,az)-(bx,bz) を連結線で結ぶ。太さ・高さは全線一定（直交/斜めで変えない）。
   * isDashed=false なら全長1本の実線、true なら DASH_COUNT 本の破線（間に隙間＝0.5が絡むことを表す）。
   * 破線生成は直交・斜め共通（幾何は端点座標に沿う）。opacity は 1.0（不透明）か HALF_OPACITY（半透明）。
   */
  private addLink(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    isBlack: boolean,
    isDashed: boolean,
    opacity: number,
  ): void {
    const dx = bx - ax;
    const dz = bz - az;
    const fullLen = Math.hypot(dx, dz); // 直交=1 / 斜め=√2
    const angleY = Math.atan2(-dz, dx); // local +X を (dx,0,dz) 方向へ
    if (!isDashed) {
      // 実線: 全長1本の板を中点に置く。
      this.addBar(ax + dx / 2, az + dz / 2, fullLen, angleY, isBlack, opacity);
      return;
    }
    // 破線: DASH_COUNT 本の短い板を等間隔に（間に隙間）。
    const dashLen = (fullLen / DASH_COUNT) * DASH_FILL;
    for (let k = 0; k < DASH_COUNT; k++) {
      const t = (k + 0.5) / DASH_COUNT; // 区間中央
      this.addBar(ax + dx * t, az + dz * t, dashLen, angleY, isBlack, opacity);
    }
  }

  /** 連結線1本ぶんの板（Box）を中心 (cx,cz)・長さ len・向き angleY で置く。高さ・厚さは全線一定。 */
  private addBar(
    cx: number,
    cz: number,
    len: number,
    angleY: number,
    isBlack: boolean,
    opacity: number,
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(len, LINK_HEIGHT, LINK_THICK),
      this.fenceMaterial(isBlack, opacity),
    );
    mesh.position.set(cx, LINK_HEIGHT / 2, cz);
    mesh.rotation.y = angleY;
    this.stoneGroup.add(mesh);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
      this.animateWater(); // 不安定な地の水面の揺らぎを毎フレーム更新（柵は静止）
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // updateStyle=true（既定）: キャンバスに CSS サイズ w×h を付ける。
    // false にすると drawing buffer サイズ（devicePixelRatio 倍）が CSS px として
    // leak し、キャンバスがビューポートより大きく描かれて overflow:hidden で
    // 左上だけ見える＝盤が右下に寄る。ここで CSS サイズを必ず一致させる。
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.running = false;
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointercancel", this.onPointerCancel);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("resize", this.onResize);
    // 選択マーカーのジオメトリ/マテリアルを明示解放（renderer.dispose では解放されない）。
    this.moveSourceRing.geometry.dispose();
    this.moveSourceRingMat.dispose();
    // 柵・水メッシュのジオメトリ/マテリアルも明示解放（renderer.dispose では解放されない）。
    this.clearStones();
    this.clearWater();
    this.renderer.dispose();
    el.remove();
  }
}
