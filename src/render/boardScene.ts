// 描画層。GameState を読んで Three.js で盤面を描くだけ。ゲームロジックは持たない。
// 単一責務: ここに勝敗判定や着手処理を混ぜない（src/game に置く）。
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BoardSizeDef } from "../game/boardDef";
import type { GameState } from "../game/state";
import { fromIndex } from "../game/coords";

const COLORS = {
  bg: 0x0a0e14,
  board: 0x123047,
  grid: 0x3f6f96,
  star: 0x6fb0e0,
  black: 0x101820,
  white: 0xeef4fb,
};

export class BoardScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly stoneGroup = new THREE.Group();
  private readonly def: BoardSizeDef;
  private running = false;
  private readonly onResize = () => this.resize();

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
    this.camera.position.set(span * 0.55, span * 0.95, span * 1.15);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(span / 2, 0, span / 2);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(span, span * 1.5, span * 0.5);
    this.scene.add(dir);

    this.buildBoard();
    this.scene.add(this.stoneGroup);

    window.addEventListener("resize", this.onResize);
    this.resize();
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
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
