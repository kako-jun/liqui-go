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
  black: 0x101820,
  white: 0xeef4fb,
  legal: 0x4fe08a, // ホバー標示（置ける）＝緑
  illegal: 0xe0544f, // ホバー標示（置けない）＝赤
};

// 交点平面の y（格子線と同じ高さ）。raycast で拾う水平面。
const POINT_PLANE_Y = 0.01;
// スナップ許容距離（board 単位）。最近傍交点からこれ以内でだけ着手扱いにする。
const SNAP_THRESHOLD = 0.5;
// クリックとカメラドラッグの弁別しきい値（px）。これ未満の移動をクリックとみなす。
const CLICK_MOVE_THRESHOLD_PX = 6;

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

  // ホバー標示のリング（1つを使い回す）。合法性は外注注入の probe で色分け。
  private readonly hoverRing: THREE.Mesh;
  private readonly hoverRingMat: THREE.MeshBasicMaterial;
  private legalityProbe?: (x: number, y: number) => boolean;

  private readonly onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);

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

    // pointer イベントは canvas（renderer.domElement）に張る。
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointermove", this.onPointerMove);

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

  private handlePointerMove(e: PointerEvent): void {
    const p = this.pickPoint(e.clientX, e.clientY);
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
      const radius = isFull ? 0.42 : 0.3;
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

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
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
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    el.remove();
  }
}
