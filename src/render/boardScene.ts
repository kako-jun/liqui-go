// 描画層。GameState を読んで Three.js で盤面を描くだけ。ゲームロジックは持たない。
// 単一責務: ここに勝敗判定や着手処理を混ぜない（src/game に置く）。
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BoardSizeDef } from "../game/boardDef";
import type { GameState } from "../game/state";
// inBounds の型・関数 import は「描画→game」の一方向依存なので規律に反しない。
// 合法判定・commit は持ち込まない（それは配線層 main.ts の責務）。
import { fromIndex, inBounds } from "../game/coords";

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

// ---- 柵（石＝境界線・壁）レンダリングの定数（描画寄り。game/RULES には置かない）----
// 盤は XZ 平面・Y 上。各石は交点に立つ縦の柱＋同色隣接を繋ぐ壁として描く（丸い碁石は描かない）。
// 柵ノード（各石）＝交点に立つ縦の柱。板上面 y=0 から立つ。
const FENCE_HEIGHT = 0.5; // 柱の高さ（board 単位）。
const POST_THICK = 0.12; // 柱の断面（正方形の一辺）。
// 同色・直交隣接の実線壁（細い縦の板）。交点間（距離1）を繋ぐ。柱より薄い。
const WALL_THICK = 0.07; // 実線壁の板厚。
const WALL_HEIGHT = FENCE_HEIGHT * 0.9; // 壁は柱よりわずかに低く（柱を節として見せる）。
// 同色・斜め隣接の「隙間のある斜め線」。実線より細く・低く・破線で繋がりきらない表現。
const DIAG_THICK = 0.05; // 斜め破線の板厚（実線 WALL_THICK より細い）。
const DIAG_HEIGHT = FENCE_HEIGHT * 0.6; // 斜めは低い（弱い連結）。
const DIAG_DASHES = 3; // 斜めを何本の破線に割るか（間に隙間が空く）。
const DIAG_FILL = 0.55; // 各破線が区間長に占める割合（残りが隙間）。
const DIAG_SOLID_OPACITY = 0.75; // 実線壁より薄い斜め線の不透明度（両端1石でも半透け）。
// 0.5石（未固形のセメント）＝半透明で揺らぐ壊れやすい柵。1石＝不透明の硬い柵。
const HALF_OPACITY = 0.5; // 0.5石が絡む柱・壁の不透明度。
// 0.5柵の揺らぎ（任意・決定的）。時刻は render の clock、位相は交点座標から算出（Math.random 不使用）。
const FENCE_WOBBLE_FREQ = 1.8; // 揺れの角速度（rad/s 相当）。
const FENCE_WOBBLE_AMP = 0.035; // 揺れの最大振幅（board 単位・上下の微小バブ）。
const FENCE_WOBBLE_PHASE_X = 1.7;
const FENCE_WOBBLE_PHASE_Z = 2.3;

// ---- 水（取得済みの地）レンダリングの定数 ----
// 一色の柵で囲い切った空点＝その色の水を、海抜0付近の凪の池として平たいタイルで溜める。
// 中立(0)・石セルは水なし（乾く）。この段では標高・流れは付けない（次段）。
const WATER_Y = 0.03; // 水面の基底高さ（board 単位）。板上面(0)・格子線(0.01)の直上、確定地＝海抜0の凪。
const WATER_TILE_HALF = 0.5; // 水タイルの半辺。交点を中心にセル境界まで＝隣接同色が連続して一つの池に見える。
const WATER_OPACITY = 0.5; // 水面の不透明度（半透明・下の格子が薄く透ける）。
// 不安定な地は高く盛り上がる（design.md「薄い囲み=不安定=高い/今にも流れ出す」）。
// instability∈[0,1] を持ち上げ量へ写す。柵の高さ(0.5)を超えないよう RISE+WOBBLE_AMP < 0.5 に収める。
const WATER_RISE = 0.35; // instability=1 の地の追加標高。基底 WATER_Y からの持ち上げ。
// 液体感の揺らぎ。時刻は render の clock、位相は頂点座標から決定的に（Math.random/Date 不使用）。
// 振幅は instability に比例＝確定地(0)は凪で動かず、不安定な地ほど強く揺れる。
const WATER_WOBBLE_FREQ = 1.4; // 揺らぎの角速度（rad/s 相当）。
const WATER_WOBBLE_AMP = 0.05; // instability=1 での最大振幅（凪 instability0 は 0）。
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
  // baseY=不安定さで持ち上げた静止 Y、amp=揺らぎ振幅(∝instability・凪=0)、phase=頂点座標由来の決定的位相。
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

  // 時刻は render 側だけが持つ（game は純粋・時刻を持てない）。0.5柵の揺らぎに使う。
  private readonly clock = new THREE.Clock();
  // 0.5石（半透明）の柵メッシュを揺らすための追跡（setState で作り直す）。
  // baseY=静止時の中心 Y、phase=交点座標から決めた決定的位相。start() の RAF で上下にバブさせる。
  private wobbleTargets: { mesh: THREE.Mesh; baseY: number; phase: number }[] = [];

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
      // 同色隣接の壁（直交＝実線・斜め＝隙間ある斜め線）。二重描画回避の4方向だけ見る。
      this.addWallIfSameColor(cells, x, y, v, x + 1, y, false); // 直交 +x
      this.addWallIfSameColor(cells, x, y, v, x, y + 1, false); // 直交 +z
      this.addWallIfSameColor(cells, x, y, v, x + 1, y + 1, true); // 斜め +x+z
      this.addWallIfSameColor(cells, x, y, v, x + 1, y - 1, true); // 斜め +x−z
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
    this.wobbleTargets = [];
  }

  /**
   * 取得済みの地（territory）を水として溜める。territory[i]/instability[i] は computeTerritory の出力:
   * territory=+1黒の地 / −1白の地 / 0中立（乾く）・石セル。±1 の空点だけに半透明の平たい水面タイルを置く。
   * 基底 Y は instability で持ち上げる（確定地=海抜0の凪／不安定=高く今にも流れ出す）。隣接する同色タイルは
   * セル境界で連続して一つの池に見える。黒/白ごとに1メッシュへマージ（描画コスト・continuity）。
   * 揺らぎは start() の RAF で足す（instability に比例・凪は動かさない）。毎手 clear→描き直す（リーク防止）。
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
      const amp = WATER_WOBBLE_AMP * inst; // 揺らぎは instability に比例（確定地は動かない）
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
   * amp=0（確定地＝凪）の頂点は動かさない。game は時刻を持てないので揺らぎは render のここだけで足す。
   */
  private animateWater(): void {
    if (this.waterAnim.length === 0) return;
    const t = this.clock.getElapsedTime();
    for (const w of this.waterAnim) {
      const positions = w.posAttr.array as Float32Array;
      let moved = false;
      for (let vi = 0; vi < w.baseY.length; vi++) {
        if (w.amp[vi] === 0) continue; // 凪は静止（無駄な書き込みを避ける）
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

  /** 柵の柱/壁用マテリアル。1石＝不透明の硬い柵／0.5石が絡む柵＝半透明で揺らぐ壊れやすい柵。 */
  private fenceMaterial(isBlack: boolean, solid: boolean): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: isBlack ? COLORS.black : COLORS.white,
      roughness: solid ? 0.5 : 0.25,
      metalness: 0,
      transparent: !solid,
      opacity: solid ? 1 : HALF_OPACITY,
    });
  }

  /** 柵ノード（各石）＝交点 (x,z) に立つ縦の柱。0.5石は半透明で揺れる。 */
  private addPost(x: number, z: number, isBlack: boolean, isFull: boolean): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(POST_THICK, FENCE_HEIGHT, POST_THICK),
      this.fenceMaterial(isBlack, isFull),
    );
    mesh.position.set(x, FENCE_HEIGHT / 2, z);
    this.stoneGroup.add(mesh);
    if (!isFull) this.registerWobble(mesh, x, z, FENCE_HEIGHT / 2);
  }

  /**
   * (x,z) の石 v と隣 (nx,nz) が同色なら壁を張る。異色・空点・盤外は張らない。
   * どちらかが 0.5 石なら壁も半透明（壊れやすい表現）。diagonal=true なら隙間ある斜め線。
   */
  private addWallIfSameColor(
    cells: number[],
    x: number,
    z: number,
    v: number,
    nx: number,
    nz: number,
    diagonal: boolean,
  ): void {
    if (!inBounds(this.def, nx, nz)) return;
    const nv = cells[nz * this.def.lines + nx];
    if (nv === 0) return;
    if (v > 0 !== nv > 0) return; // 異色は繋がない
    const isBlack = v > 0;
    // 両端とも1石なら実線（不透明）、どちらかが0.5なら半透明。
    const solid = Math.abs(v) === 1 && Math.abs(nv) === 1;
    if (diagonal) this.addDiagonal(x, z, nx, nz, isBlack, solid);
    else this.addWall(x, z, nx, nz, isBlack, solid);
  }

  /** 同色・直交隣接の実線壁（細い縦の板）。交点間（距離1）を繋ぐ。 */
  private addWall(x: number, z: number, nx: number, nz: number, isBlack: boolean, solid: boolean): void {
    const cx = (x + nx) / 2;
    const cz = (z + nz) / 2;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, WALL_HEIGHT, WALL_THICK),
      this.fenceMaterial(isBlack, solid),
    );
    mesh.position.set(cx, WALL_HEIGHT / 2, cz);
    mesh.rotation.y = Math.atan2(-(nz - z), nx - x); // local +X を (dx,0,dz) 方向へ
    this.stoneGroup.add(mesh);
    if (!solid) this.registerWobble(mesh, cx, cz, WALL_HEIGHT / 2);
  }

  /**
   * 同色・斜め隣接の「隙間のある斜め線」。実線壁より細く・低く、DIAG_DASHES 本の破線で繋ぐ
   * （碁の斜めは繋がりきらない＝隙間で表す）。両端1石でも DIAG_SOLID_OPACITY で薄く出す。
   */
  private addDiagonal(x: number, z: number, nx: number, nz: number, isBlack: boolean, solid: boolean): void {
    const dx = nx - x;
    const dz = nz - z;
    const fullLen = Math.hypot(dx, dz); // = √2
    const angleY = Math.atan2(-dz, dx); // local +X を斜め方向へ
    const dashLen = (fullLen / DIAG_DASHES) * DIAG_FILL; // 各破線長（残りが隙間）
    const opacity = solid ? DIAG_SOLID_OPACITY : HALF_OPACITY;
    for (let k = 0; k < DIAG_DASHES; k++) {
      const t = (k + 0.5) / DIAG_DASHES; // 区間中央
      const cx = x + dx * t;
      const cz = z + dz * t;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(dashLen, DIAG_HEIGHT, DIAG_THICK),
        new THREE.MeshStandardMaterial({
          color: isBlack ? COLORS.black : COLORS.white,
          roughness: 0.3,
          metalness: 0,
          transparent: true,
          opacity,
        }),
      );
      mesh.position.set(cx, DIAG_HEIGHT / 2, cz);
      mesh.rotation.y = angleY;
      this.stoneGroup.add(mesh);
      if (!solid) this.registerWobble(mesh, cx, cz, DIAG_HEIGHT / 2);
    }
  }

  /** 0.5柵メッシュを揺らし対象に登録。位相は交点座標から決定的に算出（Math.random 不使用）。 */
  private registerWobble(mesh: THREE.Mesh, x: number, z: number, baseY: number): void {
    const phase = x * FENCE_WOBBLE_PHASE_X + z * FENCE_WOBBLE_PHASE_Z;
    this.wobbleTargets.push({ mesh, baseY, phase });
  }

  /**
   * 0.5柵の揺らぎ。時刻 t を read して各メッシュの Y を baseY + AMP*sin(t*FREQ + phase) に上下バブ。
   * game は時刻を持てないので、揺らぎは render のここだけで足す（形状は毎手 game から来る静的値）。
   */
  private animateFences(): void {
    if (this.wobbleTargets.length === 0) return;
    const t = this.clock.getElapsedTime();
    for (const w of this.wobbleTargets) {
      w.mesh.position.y = w.baseY + FENCE_WOBBLE_AMP * Math.sin(t * FENCE_WOBBLE_FREQ + w.phase);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
      this.animateFences(); // 0.5柵の揺らぎを毎フレーム更新（時刻は render 側のみ）
      this.animateWater(); // 不安定な地の水面の揺らぎを毎フレーム更新
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
