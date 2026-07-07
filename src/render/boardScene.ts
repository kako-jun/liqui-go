// 描画層。GameState を読んで Three.js で盤面を描くだけ。ゲームロジックは持たない。
// 単一責務: ここに勝敗判定や着手処理を混ぜない（src/game に置く）。
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BoardSizeDef } from "../game/boardDef";
import type { GameState } from "../game/state";
import type { HeightField } from "../game/heightmap";
// inBounds の型・関数 import は「描画→game」の一方向依存なので規律に反しない。
// 合法判定・commit は持ち込まない（それは配線層 main.ts の責務）。
import { fromIndex, inBounds } from "../game/coords";

const COLORS = {
  bg: 0x0a0e14,
  board: 0x123047,
  grid: 0x3f6f96,
  star: 0x6fb0e0,
  black: 0x101820,
  white: 0xeef4fb,
  legal: 0x4fe08a, // ホバー標示（置ける）＝緑
  illegal: 0xe0544f, // ホバー標示（置けない）＝赤
  moveSource: 0xf5b942, // ムーブ元の選択マーカー＝琥珀（ホバーリングと別色）
  // 液体地形（#6）の水色。ownership を白↔黒流体で lerp し、効きの弱い域は中立の濁り色へ抜く。
  waterWhite: 0xd6eeff, // 白（−）が支配する流体の色
  waterBlack: 0x0e2c44, // 黒（＋）が支配する流体の色
  waterNeutral: 0x2b6f7a, // 効きが届かない／拮抗する係争域の中立の濁り色
};

// 交点平面の y（格子線と同じ高さ）。raycast で拾う水平面。
const POINT_PLANE_Y = 0.01;
// スナップ許容距離（board 単位）。最近傍交点からこれ以内でだけ着手扱いにする。
const SNAP_THRESHOLD = 0.5;
// クリックとカメラドラッグの弁別しきい値（px）。これ未満の移動をクリックとみなす。
const CLICK_MOVE_THRESHOLD_PX = 6;

// ---- 液体地形（水面）レンダリングのチューニング定数（描画寄り。game/RULES には置かない）----
// 1 セル（交点間隔=1）を何分割して水面格子を張るか。上げるほど滑らかで重い。
const WATER_SUBDIV = 6;
// height[0,1] を board 単位の頂点 Y へ写す係数（係争度が高いほど盛り上がる）。
const HEIGHT_SCALE = 0.8;
// 波立ちの角速度（rad/s 相当）。時刻 t に掛ける。
const WOBBLE_FREQ = 1.6;
// 波立ちの最大振幅（height=1 のとき。凪=height0 では 0）。board 単位。
const WOBBLE_AMP = 0.12;
// 波の位相を頂点座標から決定するための係数（Math.random 不使用＝再現的）。
const WOBBLE_PHASE_X = 1.7;
const WOBBLE_PHASE_Z = 2.3;
// 水面メッシュ全体の持ち上げ量。板の上面(y=0)との z-fighting を避け、格子線(0.01)より下に置く。
const WATER_LIFT = 0.005;
// 全体の不透明度（第一段は per-vertex alpha を使わず彩度ゲート＋一律 opacity で液感を出す）。
const WATER_OPACITY = 0.5;

// 石メッシュの半径（setState と共有・stoneTop の石頭算出にも使う）。
const STONE_RADIUS_FULL = 0.42; // |v|=1（固まった1石・top≈0.462）
const STONE_RADIUS_HALF = 0.3; // |v|=0.5（未固形の0.5石・top≈0.33）
// 石セルの水位＝石の頭(stoneTop)の約10%。水は石の足元だけをひたひたと浸し、石は約90%が水上に
// 立つ（海抜0の池から石が突き出る）。割合方式なので背の低い0.5石も埋もれない。ライブ調整のツマミ。
// 結果水位: full≈0.462*0.10≈0.046 / half≈0.33*0.10≈0.033。
const WATER_STONE_FILL = 0.1;
// ownership 色を presence（効きの総量）でゲートする閾。HeightField は presence を直接持たず
// pressure(=total) を公開するので、単調な pressure に smoothstep を掛けてゲートする。
// pressure がこの下限以下なら中立の濁り色、上限以上なら ownership 色を全掛けする。
const PRESSURE_GATE_LOW = 0.08;
const PRESSURE_GATE_HIGH = 1.0;

export class BoardScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly stoneGroup = new THREE.Group();
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

  // ---- 液体地形（水面）。setHeightField で初回だけ生成し、以降は頂点バッファのみ更新（再生成しない＝リーク防止）。----
  private readonly clock = new THREE.Clock(); // 時刻は render 側だけが持つ（game は純粋・時刻を持てない）。
  private waterGeometry?: THREE.BufferGeometry;
  private waterMaterial?: THREE.MeshStandardMaterial;
  // 波アニメで毎フレーム使う頂点別データ（setHeightField で更新）。
  private waterBaseY?: Float32Array; // 各頂点の基底 Y（= sampledHeight * HEIGHT_SCALE）
  private waterAmp?: Float32Array; // 各頂点の波振幅（= sampledHeight * WOBBLE_AMP・凪=0）
  private waterPhase?: Float32Array; // 各頂点の波位相（座標から決定的に算出）
  // 頂点色計算の使い回し（毎頂点 new を避ける）。
  private readonly waterWhite = new THREE.Color(COLORS.waterWhite);
  private readonly waterBlack = new THREE.Color(COLORS.waterBlack);
  private readonly waterNeutral = new THREE.Color(COLORS.waterNeutral);
  private readonly waterOwnColor = new THREE.Color();
  private readonly waterFinalColor = new THREE.Color();

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

  /** GameState の cells を石マーカーとして描き直す。 */
  setState(state: GameState): void {
    this.stoneGroup.clear();
    for (let i = 0; i < state.cells.length; i++) {
      const v = state.cells[i];
      if (v === 0) continue;
      const { x, y } = fromIndex(this.def, i);
      const isFull = Math.abs(v) === 1;
      const isBlack = v > 0;
      const radius = isFull ? STONE_RADIUS_FULL : STONE_RADIUS_HALF;
      const mat = new THREE.MeshStandardMaterial({
        color: isBlack ? COLORS.black : COLORS.white,
        roughness: isFull ? 0.5 : 0.2,
        transparent: !isFull, // 0.5石はまだ固まっていない＝半透明
        opacity: isFull ? 1 : 0.55,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
      mesh.scale.y = 0.55; // 碁石らしく平たく
      mesh.position.set(x, radius * 0.55, y);
      this.stoneGroup.add(mesh);
    }
  }

  /**
   * 確定度 heightmap（#5 の純粋関数出力）と現盤面 cells を水面メッシュに反映する。
   * - 初回だけ格子ジオメトリ／マテリアル／メッシュを生成する。以降は頂点バッファ（position/color）
   *   だけを更新し、ジオメトリを作り直さない（毎手呼ばれてもリークしない）。
   * - 盤 [0,span]×[0,span]（span=lines-1）を各セル WATER_SUBDIV 分割した格子。頂点 (wx, y, wz) は
   *   board 単位（交点 (x,y) は盤ワールド (x, 上=Y, z=y) に対応するので wz が z 側＝盤の y 座標）。
   * - 交点ごとに水位 level[] と波振幅 ampF[] を作る:
   *   ・石セル(cells[i]≠0): level=石頭*WATER_STONE_FILL（頭の約10%＝足元・石は水上に立つ）・amp=0（凪）。
   *   ・空点(cells[i]=0): level=height*HEIGHT_SCALE（係争度で持ち上がる）・amp=height*WOBBLE_AMP。
   * - 各頂点の Y と波振幅は level/ampF を、色用の ownership/pressure は field を、囲む4交点の
   *   bilinear 補間でサンプルする。頂点色 = presence(pressure) でゲートした ownership 色。
   *   波立ちは start() ループで足す（時刻は render 側のみ）。level/ampF は毎手ローカルに作って捨てる。
   */
  setHeightField(field: HeightField, cells: number[]): void {
    const lines = field.lines;
    const span = lines - 1;
    const segs = span * WATER_SUBDIV; // 1 軸あたりのセグメント数
    const vpa = segs + 1; // 1 軸あたりの頂点数
    const vcount = vpa * vpa;

    if (!this.waterGeometry) {
      // 初回生成。position/color 属性と三角形 index を張る。
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
      geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
      const indices: number[] = [];
      for (let row = 0; row < segs; row++) {
        for (let col = 0; col < segs; col++) {
          const a = row * vpa + col;
          const b = row * vpa + col + 1;
          const c = (row + 1) * vpa + col;
          const d = (row + 1) * vpa + col + 1;
          // (a,c,b),(b,c,d) の巻き順で法線が +Y（上）を向く（XZ 平面・Y 上）。
          indices.push(a, c, b, b, c, d);
        }
      }
      geom.setIndex(indices);

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: WATER_OPACITY,
        roughness: 0.2,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      // 板の上面(y=0)との z-fighting を避けて少しだけ持ち上げる（格子線 0.01 より下・石より下）。
      mesh.position.y = WATER_LIFT;

      this.waterGeometry = geom;
      this.waterMaterial = mat;
      this.waterBaseY = new Float32Array(vcount);
      this.waterAmp = new Float32Array(vcount);
      this.waterPhase = new Float32Array(vcount);
      this.scene.add(mesh);
    }

    // 交点ごとの水位 level と波振幅 ampF を作る（sampleField が number[] を取るので Array で）。
    // 石セルは石頭の高さで凪、空点だけ係争度で持ち上がって波立つ。毎手作り捨て（頂点バッファは別）。
    const n = lines * lines;
    const level = new Array<number>(n);
    const ampF = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const v = cells[i];
      if (v !== 0) {
        // 石の頭の約10%＝足元だけをひたひたと。石は約90%が水上に立つ（背の低い0.5石も埋もれない）。
        level[i] = this.stoneTop(v) * WATER_STONE_FILL;
        ampF[i] = 0; // 石セルは凪
      } else {
        level[i] = field.height[i] * HEIGHT_SCALE; // 係争度で持ち上がる
        ampF[i] = field.height[i] * WOBBLE_AMP; // 凪(height0)=0・係争(height1)=最大
      }
    }

    const geom = this.waterGeometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geom.getAttribute("color") as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;
    const baseY = this.waterBaseY!;
    const amp = this.waterAmp!;
    const phase = this.waterPhase!;

    for (let row = 0; row <= segs; row++) {
      const wz = row / WATER_SUBDIV;
      for (let col = 0; col <= segs; col++) {
        const wx = col / WATER_SUBDIV;
        const vi = row * vpa + col;

        const y = this.sampleField(field, level, wx, wz); // 水位（石高さ or 係争度）
        const ow = this.sampleField(field, field.ownership, wx, wz);
        const pr = this.sampleField(field, field.pressure, wx, wz);

        positions[vi * 3] = wx;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = wz;
        baseY[vi] = y;
        amp[vi] = this.sampleField(field, ampF, wx, wz); // 石セル周りは 0（凪）
        phase[vi] = wx * WOBBLE_PHASE_X + wz * WOBBLE_PHASE_Z; // 座標から決定的に散らす

        // ownership[-1,1] を白↔黒流体で lerp: (ow+1)/2 が 0=白 / 1=黒。
        const t = (ow + 1) / 2;
        this.waterOwnColor.lerpColors(this.waterWhite, this.waterBlack, t);
        // 効きの弱い域（pressure 小）は ownership が飽和しても濃色にせず中立へ抜く。
        const gate = THREE.MathUtils.smoothstep(pr, PRESSURE_GATE_LOW, PRESSURE_GATE_HIGH);
        this.waterFinalColor.lerpColors(this.waterNeutral, this.waterOwnColor, gate);
        colors[vi * 3] = this.waterFinalColor.r;
        colors[vi * 3 + 1] = this.waterFinalColor.g;
        colors[vi * 3 + 2] = this.waterFinalColor.b;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    // 基底位置で法線を張り直す（PBR ライティングで凹凸を陰影として読ませる）。
    // 波立ちの毎フレーム法線再計算まではしない（第一段・コスト回避）。
    geom.computeVertexNormals();
  }

  /**
   * 石メッシュの頭（top）の Y。setState と同じ寸法から算出する。
   * 石は半径 radius の球を scale.y=0.55 で平たくし position.y=radius*0.55 に置くので、
   * top = position.y(radius*0.55) + 潰れた半径(radius*0.55) = radius*1.1。
   */
  private stoneTop(v: number): number {
    const radius = Math.abs(v) === 1 ? STONE_RADIUS_FULL : STONE_RADIUS_HALF;
    return radius * 1.1;
  }

  /**
   * (wx,wz) を囲む4交点から値配列を bilinear 補間する。交点値の添字は gz*lines+gx（= indexOf(def,gx,gz)）。
   * ix=floor(wx) を [0,lines-2] にクランプ、tx=wx-ix（wz/tz も同様。z 側が盤の y 座標）。
   */
  private sampleField(field: HeightField, values: number[], wx: number, wz: number): number {
    const lines = field.lines;
    let ix = Math.floor(wx);
    if (ix < 0) ix = 0;
    else if (ix > lines - 2) ix = lines - 2;
    let iz = Math.floor(wz);
    if (iz < 0) iz = 0;
    else if (iz > lines - 2) iz = lines - 2;
    const tx = wx - ix;
    const tz = wz - iz;
    const v00 = values[iz * lines + ix];
    const v10 = values[iz * lines + (ix + 1)];
    const v01 = values[(iz + 1) * lines + ix];
    const v11 = values[(iz + 1) * lines + (ix + 1)];
    const top = v00 * (1 - tx) + v10 * tx;
    const bot = v01 * (1 - tx) + v11 * tx;
    return top * (1 - tz) + bot * tz;
  }

  /**
   * 水面の波立ち。時刻 t を read して各頂点 Y を baseY + amp*sin(t*FREQ + phase) に更新する。
   * game は時刻を持てないので、波は render のここだけで足す（基底 height は毎手 game から来る静的値）。
   */
  private animateWater(): void {
    if (!this.waterGeometry || !this.waterBaseY) return;
    const t = this.clock.getElapsedTime();
    const posAttr = this.waterGeometry.getAttribute("position") as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const baseY = this.waterBaseY;
    const amp = this.waterAmp!;
    const phase = this.waterPhase!;
    for (let vi = 0; vi < baseY.length; vi++) {
      positions[vi * 3 + 1] = baseY[vi] + amp[vi] * Math.sin(t * WOBBLE_FREQ + phase[vi]);
    }
    posAttr.needsUpdate = true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
      this.animateWater(); // 水面の波立ちを毎フレーム更新（時刻は render 側のみ）
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
    // 水面のジオメトリ/マテリアルも明示解放（生成済みなら）。
    this.waterGeometry?.dispose();
    this.waterMaterial?.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
