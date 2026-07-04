import { describe, it, expect } from "vitest";
import {
  isEmpty,
  isOnCooldown,
  canPlaceAt,
  placementRejection,
  legalPlacements,
  tickCooldowns,
  commitPlacement,
  resolveSimultaneous,
  moveRejection,
  isStarPoint,
} from "./rules";
import { createInitialState } from "./state";
import { BOARD_SIZES } from "./boardDef";
import { indexOf, fromIndex, pointCount } from "./coords";
import type { Player, PlaceKind } from "./stones";

// 主に9路盤（lines=9・交点81）で縛る。線形index=9=(0,1) のエイリアスが最重要の敵性。
const def = BOARD_SIZES["9"];

describe("isEmpty — 交点が空き（値 0）か否か", () => {
  it("値が 0 の交点は空きと判定する", () => {
    expect(isEmpty([0, 1, -1], 0)).toBe(true);
  });

  it("非ゼロの4値（1 / 0.5 / -0.5 / -1）はいずれも空きでない", () => {
    const cells = [1, 0.5, -0.5, -1];
    expect(isEmpty(cells, 0)).toBe(false);
    expect(isEmpty(cells, 1)).toBe(false);
    expect(isEmpty(cells, 2)).toBe(false);
    expect(isEmpty(cells, 3)).toBe(false);
  });
});

describe("isOnCooldown — cooldown 残があるか（> 0）", () => {
  it("cooldown=0 は cooldown 中でない（>= との取り違え検出・下側境界）", () => {
    const state = createInitialState("9");
    state.cooldown[0] = 0;
    expect(isOnCooldown(state, 0)).toBe(false);
  });

  it("cooldown=1 は cooldown 中", () => {
    const state = createInitialState("9");
    state.cooldown[0] = 1;
    expect(isOnCooldown(state, 0)).toBe(true);
  });

  it("cooldown=2 は cooldown 中", () => {
    const state = createInitialState("9");
    state.cooldown[0] = 2;
    expect(isOnCooldown(state, 0)).toBe(true);
  });
});

describe("canPlaceAt — 盤内 かつ 空き かつ cooldown0", () => {
  it("盤内・空き・cooldown0 の交点は置ける", () => {
    const state = createInitialState("9");
    expect(canPlaceAt(def, state, 4, 4)).toBe(true);
  });

  it("盤外 x=9（lines=9）は置けない", () => {
    const state = createInitialState("9");
    expect(canPlaceAt(def, state, 9, 0)).toBe(false);
  });

  it("占有された交点は置けない", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 1;
    expect(canPlaceAt(def, state, 3, 3)).toBe(false);
  });

  it("空きでも cooldown>0 の交点は置けない", () => {
    const state = createInitialState("9");
    state.cooldown[indexOf(def, 3, 3)] = 1;
    expect(canPlaceAt(def, state, 3, 3)).toBe(false);
  });

  it("角 (0,0) と (8,8) の空きは置ける", () => {
    const state = createInitialState("9");
    expect(canPlaceAt(def, state, 0, 0)).toBe(true);
    expect(canPlaceAt(def, state, 8, 8)).toBe(true);
  });

  it("canPlaceAt は placementRejection===null と常に整合する（代表点）", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 1; // 占有
    state.cooldown[indexOf(def, 5, 5)] = 1; // cooldown
    const points: ReadonlyArray<readonly [number, number]> = [
      [4, 4], // 合法
      [3, 3], // 占有
      [5, 5], // cooldown
      [9, 0], // 盤外
      [0, 0], // 角
    ];
    for (const [x, y] of points) {
      expect(canPlaceAt(def, state, x, y)).toBe(placementRejection(def, state, x, y) === null);
    }
  });
});

describe("placementRejection — デシジョンテーブル R1〜R6（盤外 → 占有 → cooldown）", () => {
  it("R1: 盤外 x=-1 は out-of-bounds（盤外優先）", () => {
    const state = createInitialState("9");
    expect(placementRejection(def, state, -1, 0)).toBe("out-of-bounds");
  });

  it("R2: x=9,y=0（lines=9）は out-of-bounds。線形index=9=(0,1) へエイリアスさせない", () => {
    const state = createInitialState("9");
    // bounds を後回しにして index=9 を先に見ると (0,1) の状態を誤読する。
    // (0,1)=index9 を占有かつ cooldown にしても out-of-bounds が返ることを縛る。
    state.cells[indexOf(def, 0, 1)] = 1;
    state.cooldown[indexOf(def, 0, 1)] = 1;
    expect(placementRejection(def, state, 9, 0)).toBe("out-of-bounds");
  });

  it("R3: 盤内・占有・cooldownなし は occupied", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 1;
    expect(placementRejection(def, state, 3, 3)).toBe("occupied");
  });

  it("R4: 盤内・占有・cooldownあり は occupied（占有 > cooldown 優先）", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 1;
    state.cooldown[indexOf(def, 3, 3)] = 1;
    expect(placementRejection(def, state, 3, 3)).toBe("occupied");
  });

  it("R5: 盤内・空き・cooldownあり は cooldown", () => {
    const state = createInitialState("9");
    state.cooldown[indexOf(def, 3, 3)] = 1;
    expect(placementRejection(def, state, 3, 3)).toBe("cooldown");
  });

  it("R6: 盤内・空き・cooldownなし は null（合法）", () => {
    const state = createInitialState("9");
    expect(placementRejection(def, state, 3, 3)).toBeNull();
  });

  it("角 (0,0) と (8,8) の空きは null（合法）", () => {
    const state = createInitialState("9");
    expect(placementRejection(def, state, 0, 0)).toBeNull();
    expect(placementRejection(def, state, 8, 8)).toBeNull();
  });
});

describe("legalPlacements — 置ける全交点の列挙", () => {
  it("空盤では全交点（9路=81）を列挙する", () => {
    const state = createInitialState("9");
    expect(legalPlacements(def, state).length).toBe(pointCount(def));
    expect(legalPlacements(def, state).length).toBe(81);
  });

  it("全交点が占有された盤では空配列", () => {
    const state = createInitialState("9");
    state.cells.fill(1);
    expect(legalPlacements(def, state)).toEqual([]);
  });

  it("1点だけ空きの盤ではその1点のみ列挙し座標が fromIndex と一致する", () => {
    const state = createInitialState("9");
    state.cells.fill(1);
    const i = indexOf(def, 5, 2);
    state.cells[i] = 0;
    const legal = legalPlacements(def, state);
    expect(legal.length).toBe(1);
    expect(legal[0]).toEqual(fromIndex(def, i));
  });

  it("空きでも cooldown>0 の点は列挙から除外する", () => {
    const state = createInitialState("9");
    state.cooldown[indexOf(def, 4, 4)] = 1;
    const legal = legalPlacements(def, state);
    expect(legal.length).toBe(80);
    expect(legal).not.toContainEqual({ x: 4, y: 4 });
  });

  it("列挙は index 昇順（row-major）", () => {
    const state = createInitialState("9");
    const legal = legalPlacements(def, state);
    const indices = legal.map((p) => indexOf(def, p.x, p.y));
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  it("全交点で p∈legalPlacements ⇔ canPlaceAt と整合する", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 1;
    state.cells[indexOf(def, 1, 7)] = -0.5;
    state.cooldown[indexOf(def, 5, 5)] = 1;
    state.cooldown[indexOf(def, 8, 8)] = 2;
    const legal = legalPlacements(def, state);
    const inLegal = (x: number, y: number) => legal.some((p) => p.x === x && p.y === y);
    for (let y = 0; y < def.lines; y++) {
      for (let x = 0; x < def.lines; x++) {
        expect(inLegal(x, y)).toBe(canPlaceAt(def, state, x, y));
      }
    }
  });
});

describe("tickCooldowns — cooldown を1ターン進める（各要素 max(0, v-1)・純粋）", () => {
  it("[0,1,2] は [0,0,1] になる（期待は生の literal）", () => {
    expect(tickCooldowns([0, 1, 2])).toEqual([0, 0, 1]);
  });

  it("0 は 0 に下限クランプされる（負にならない）", () => {
    expect(tickCooldowns([0])).toEqual([0]);
  });

  it("1 は 0 になる", () => {
    expect(tickCooldowns([1])).toEqual([0]);
  });

  it("入力配列を破壊せず別参照の新配列を返す（純粋）", () => {
    const input = [2, 3, 1];
    const out = tickCooldowns(input);
    expect(input).toEqual([2, 3, 1]); // 入力不変
    expect(out).not.toBe(input); // 別参照
  });

  it("空配列は空配列を返す", () => {
    expect(tickCooldowns([])).toEqual([]);
  });
});

describe("commitPlacement — 1手確定（純粋・tick→押印順序）", () => {
  it("合法な黒の1石は ok:true・cells[i]===1・phenomenon=place・turnCount+1", () => {
    const state = createInitialState("9");
    const res = commitPlacement(def, state, 4, 4, "black", "stone");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.cells[indexOf(def, 4, 4)]).toBe(1);
    expect(res.resolution.phenomenon).toBe("place");
    expect(res.state.turnCount).toBe(1);
  });

  it("player×kind の4組が after に反映される（黒石+1 / 黒ポア+0.5 / 白石-1 / 白ポア-0.5）", () => {
    const cases: ReadonlyArray<readonly [Player, PlaceKind, number]> = [
      ["black", "stone", 1],
      ["black", "pour", 0.5],
      ["white", "stone", -1],
      ["white", "pour", -0.5],
    ];
    for (const [player, kind, expected] of cases) {
      const state = createInitialState("9");
      const res = commitPlacement(def, state, 4, 4, player, kind);
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.state.cells[indexOf(def, 4, 4)]).toBe(expected);
      expect(res.resolution.after).toBe(expected);
    }
  });

  it("空点への 1石 は place、ポア は pour という現象名になる", () => {
    const r1 = commitPlacement(def, createInitialState("9"), 4, 4, "black", "stone");
    expect(r1.ok && r1.resolution.phenomenon).toBe("place");
    const r2 = commitPlacement(def, createInitialState("9"), 4, 4, "black", "pour");
    expect(r2.ok && r2.resolution.phenomenon).toBe("pour");
  });

  it("commit 後、置いた点の cooldown は生値で 1（0でない＝tick→押印順序が守られている）", () => {
    const state = createInitialState("9");
    const res = commitPlacement(def, state, 4, 4, "black", "stone");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.cooldown[indexOf(def, 4, 4)]).toBe(1);
  });

  it("既存の他点の cooldown は commit の tick で 1 減る（tick は全点に効く）", () => {
    const state = createInitialState("9");
    const other = indexOf(def, 0, 0);
    state.cooldown[other] = 2;
    const res = commitPlacement(def, state, 4, 4, "black", "stone");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.cooldown[other]).toBe(1); // 2 → 1（生値）
  });

  it("freeze した元 state の cells/cooldown/turnCount は commit 後も不変（純粋）", () => {
    const state = createInitialState("9");
    state.cooldown[indexOf(def, 0, 0)] = 2;
    const cellsBefore = [...state.cells];
    const cooldownBefore = [...state.cooldown];
    Object.freeze(state.cells); // 書き込めば TypeError で即失敗
    Object.freeze(state.cooldown);
    const res = commitPlacement(def, state, 4, 4, "black", "stone");
    expect(res.ok).toBe(true);
    expect([...state.cells]).toEqual(cellsBefore);
    expect([...state.cooldown]).toEqual(cooldownBefore);
    expect(state.turnCount).toBe(0);
  });

  it("盤外への commit は ok:false・out-of-bounds（applyPlacement 未呼出＝cells 不変・例外なし）", () => {
    const state = createInitialState("9");
    Object.freeze(state.cells); // 万一書き込めば例外で検出
    const res = commitPlacement(def, state, 9, 0, "black", "stone");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("out-of-bounds");
    expect([...state.cells].every((v) => v === 0)).toBe(true);
  });

  it("占有点への commit は ok:false・occupied（二重送信拒否・state 不変）", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 1;
    const cellsBefore = [...state.cells];
    const res = commitPlacement(def, state, 3, 3, "white", "stone");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("occupied");
    expect([...state.cells]).toEqual(cellsBefore);
    expect(state.turnCount).toBe(0);
  });

  it("cooldown点への commit は ok:false・cooldown（state 不変）", () => {
    const state = createInitialState("9");
    state.cooldown[indexOf(def, 3, 3)] = 1;
    const cooldownBefore = [...state.cooldown];
    const res = commitPlacement(def, state, 3, 3, "black", "stone");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("cooldown");
    expect([...state.cooldown]).toEqual(cooldownBefore);
    expect(state.turnCount).toBe(0);
  });

  it("3ターン遷移: cooldown=1 の点は commit 不可 → 別点へ commit の tick で解放 → 置ける", () => {
    const state = createInitialState("9");
    const target = indexOf(def, 2, 2);
    state.cooldown[target] = 1; // 直前ターンに触れた点（次ターン不可）

    // ターンA: 対象点はまだ cooldown → 不可
    const rejected = commitPlacement(def, state, 2, 2, "black", "stone");
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.reason).toBe("cooldown");

    // ターンA: 別の合法点へ置く。この tick で対象点 cooldown 1 → 0
    const stepA = commitPlacement(def, state, 6, 6, "white", "stone");
    expect(stepA.ok).toBe(true);
    if (!stepA.ok) return;
    expect(stepA.state.cooldown[target]).toBe(0); // 解放された（生値）

    // ターンB: 解放後の対象点へ置ける
    const stepB = commitPlacement(def, stepA.state, 2, 2, "black", "stone");
    expect(stepB.ok).toBe(true);
    if (!stepB.ok) return;
    expect(stepB.state.cells[target]).toBe(1);
  });

  it("turnCount は commit ごとに連続インクリメントする（0→1→2）", () => {
    const state = createInitialState("9");
    const t1 = commitPlacement(def, state, 0, 0, "black", "stone");
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;
    expect(t1.state.turnCount).toBe(1);
    const t2 = commitPlacement(def, t1.state, 1, 1, "white", "stone");
    expect(t2.ok).toBe(true);
    if (!t2.ok) return;
    expect(t2.state.turnCount).toBe(2);
  });

  it("version・boardSizeId・moveRights は commit 後も保持される", () => {
    const state = createInitialState("9");
    state.moveRights = { black: 1.5, white: 0 };
    const res = commitPlacement(def, state, 4, 4, "black", "stone");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.version).toBe(1);
    expect(res.state.boardSizeId).toBe("9");
    expect(res.state.moveRights).toEqual({ black: 1.5, white: 0 });
  });

  it("commit 成功時の phenomenon は place / pour のみ（占有は弾かれ他現象は出ない）", () => {
    const r1 = commitPlacement(def, createInitialState("9"), 4, 4, "black", "stone");
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(["place", "pour"]).toContain(r1.resolution.phenomenon);
    const r2 = commitPlacement(def, createInitialState("9"), 4, 4, "white", "pour");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(["place", "pour"]).toContain(r2.resolution.phenomenon);
  });
});

describe("resolveSimultaneous — 同時プロット制（ルール①・足し算解決）", () => {
  it("別点独立: 黒(2,2)石＋白(6,6)石 → 両点に 1/-1・events 2件・両点 cooldown=1・turnCount+1", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 2, y: 2, placeKind: "stone" },
      { type: "place", x: 6, y: 6, placeKind: "stone" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 2, 2)]).toBe(1);
    expect(r.state.cells[indexOf(def, 6, 6)]).toBe(-1);
    expect(r.events.length).toBe(2);
    expect(r.state.cooldown[indexOf(def, 2, 2)]).toBe(1);
    expect(r.state.cooldown[indexOf(def, 6, 6)]).toBe(1);
    expect(r.state.turnCount).toBe(1);
  });

  it("同点 capture: 黒石＋白石 同点 → after 0（空）・event capture・その点 cooldown=1（相殺点も押印）", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 4, y: 4, placeKind: "stone" },
      { type: "place", x: 4, y: 4, placeKind: "stone" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0);
    expect(r.events.length).toBe(1);
    expect(r.events[0].phenomenon).toBe("capture");
    expect(r.events[0].after).toBe(0);
    expect(r.state.cooldown[indexOf(def, 4, 4)]).toBe(1); // after 0 でも押印（相殺ループ防止）
  });

  it("同点 reduce: 黒石＋白ポア → after 0.5・reduce", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 4, y: 4, placeKind: "stone" },
      { type: "place", x: 4, y: 4, placeKind: "pour" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0.5);
    expect(r.events[0].phenomenon).toBe("reduce");
    expect(r.events[0].after).toBe(0.5);
  });

  it("同点 reduce: 黒ポア＋白石 → after -0.5・reduce", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 4, y: 4, placeKind: "pour" },
      { type: "place", x: 4, y: 4, placeKind: "stone" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(-0.5);
    expect(r.events[0].phenomenon).toBe("reduce");
    expect(r.events[0].after).toBe(-0.5);
  });

  it("同点 cancel: 黒ポア＋白ポア → after 0・cancel・cooldown=1", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 4, y: 4, placeKind: "pour" },
      { type: "place", x: 4, y: 4, placeKind: "pour" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0);
    expect(r.events[0].phenomenon).toBe("cancel");
    expect(r.state.cooldown[indexOf(def, 4, 4)]).toBe(1);
  });

  it("非合法 plot: 白が占有点(3,3)を狙う → {ok:false, which:white, reason:occupied}・state 不変", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 1;
    const cellsBefore = [...state.cells];
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 5, y: 5, placeKind: "stone" }, // 黒は合法点
      { type: "place", x: 3, y: 3, placeKind: "stone" }, // 白は占有点
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.which).toBe("white");
    expect(r.reason).toBe("occupied");
    expect([...state.cells]).toEqual(cellsBefore); // 元 state 不変
    expect(state.turnCount).toBe(0);
  });

  it("非合法 plot: 黒が占有点(3,3)を狙う → 黒で early return（白が合法でも {ok:false, which:black, reason:occupied}・state 不変）", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 1;
    const cellsBefore = [...state.cells];
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 3, y: 3, placeKind: "stone" }, // 黒は占有点（先に判定される）
      { type: "place", x: 5, y: 5, placeKind: "stone" }, // 白は合法点
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.which).toBe("black"); // 黒が先に弾かれる（白は合法でも見に行かない）
    expect(r.reason).toBe("occupied");
    expect([...state.cells]).toEqual(cellsBefore); // 元 state 不変
    expect(state.turnCount).toBe(0);
  });

  it("非合法 plot: 白が cooldown>0 の空き点(2,2)を狙う → {ok:false, which:white, reason:cooldown}・state 不変", () => {
    const state = createInitialState("9");
    state.cooldown[indexOf(def, 2, 2)] = 1; // 空きだが cooldown 中
    const cooldownBefore = [...state.cooldown];
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 6, y: 6, placeKind: "stone" }, // 黒は合法点
      { type: "place", x: 2, y: 2, placeKind: "stone" }, // 白は cooldown 点
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.which).toBe("white");
    expect(r.reason).toBe("cooldown");
    expect([...state.cooldown]).toEqual(cooldownBefore); // 元 state 不変
    expect(state.turnCount).toBe(0);
  });

  it("非合法 plot: 白が盤外(x=9,y=0)を狙う → {ok:false, which:white, reason:out-of-bounds}・state 不変", () => {
    const state = createInitialState("9");
    const cellsBefore = [...state.cells];
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 6, y: 6, placeKind: "stone" }, // 黒は合法点
      { type: "place", x: 9, y: 0, placeKind: "stone" }, // 白は盤外（lines=9）
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.which).toBe("white");
    expect(r.reason).toBe("out-of-bounds");
    expect([...state.cells]).toEqual(cellsBefore); // 元 state 不変
    expect(state.turnCount).toBe(0);
  });

  it("パス（黒 null）: 白だけ着手・events 1件・白点 cooldown=1・turnCount+1", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(def, state, null, {
      type: "place",
      x: 6,
      y: 6,
      placeKind: "stone",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 6, 6)]).toBe(-1);
    expect(r.events.length).toBe(1);
    expect(r.state.cooldown[indexOf(def, 6, 6)]).toBe(1);
    expect(r.state.turnCount).toBe(1);
  });

  it("両パス（両 null）: cells 不変・events 空・turnCount+1・cooldown は tick のみ（2→1）", () => {
    const state = createInitialState("9");
    state.cooldown[indexOf(def, 0, 0)] = 2;
    const cellsBefore = [...state.cells];
    const r = resolveSimultaneous(def, state, null, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells).toEqual(cellsBefore);
    expect(r.events.length).toBe(0);
    expect(r.state.turnCount).toBe(1);
    expect(r.state.cooldown[indexOf(def, 0, 0)]).toBe(1); // tick で 2→1
  });

  it("純粋性: freeze した元 state.cells/cooldown でも壊れず turnCount 不変", () => {
    const state = createInitialState("9");
    state.cooldown[indexOf(def, 0, 0)] = 2;
    const cellsBefore = [...state.cells];
    const cooldownBefore = [...state.cooldown];
    Object.freeze(state.cells);
    Object.freeze(state.cooldown);
    Object.freeze(state);
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 4, y: 4, placeKind: "stone" },
      { type: "place", x: 4, y: 4, placeKind: "stone" },
    );
    expect(r.ok).toBe(true);
    expect([...state.cells]).toEqual(cellsBefore);
    expect([...state.cooldown]).toEqual(cooldownBefore);
    expect(state.turnCount).toBe(0);
  });
});

describe("moveRejection — ムーブ拒否理由（ルール③・生値 assert）", () => {
  // 黒の 0.5 を (4,4) に置いた盤を基準にする（player=black・half=0.5）。
  function withBlackHalf(x = 4, y = 4) {
    const state = createInitialState("9");
    state.cells[indexOf(def, x, y)] = 0.5;
    return state;
  }

  it("合法ムーブ（自分の0.5→隣接空点）は null", () => {
    const state = withBlackHalf();
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 }, "black"),
    ).toBeNull();
  });

  it("from が盤外 → out-of-bounds", () => {
    const state = createInitialState("9");
    expect(
      moveRejection(def, state, { type: "move", fromX: -1, fromY: 0, toX: 0, toY: 0 }, "black"),
    ).toBe("out-of-bounds");
  });

  it("to が盤外（x=9,y=0）→ out-of-bounds（index=(0,1) へエイリアスさせない）", () => {
    const state = withBlackHalf(8, 0);
    expect(
      moveRejection(def, state, { type: "move", fromX: 8, fromY: 0, toX: 9, toY: 0 }, "black"),
    ).toBe("out-of-bounds");
  });

  it("from が空 → not-your-half", () => {
    const state = createInitialState("9");
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 }, "black"),
    ).toBe("not-your-half");
  });

  it("from が自分の1石 → not-your-half（1石は動けない）", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 1;
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 }, "black"),
    ).toBe("not-your-half");
  });

  it("from が相手の0.5 → not-your-half（自分の0.5からのみ）", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = -0.5; // 白の0.5
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 }, "black"),
    ).toBe("not-your-half");
  });

  it("to が隣接8マス外（2マス先）→ not-adjacent", () => {
    const state = withBlackHalf();
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 6, toY: 6 }, "black"),
    ).toBe("not-adjacent");
  });

  it("to === from（自己）→ not-adjacent（moveTargets に自己は含まれない）", () => {
    const state = withBlackHalf();
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 4, toY: 4 }, "black"),
    ).toBe("not-adjacent");
  });

  it("着地点が cooldown>0 → cooldown", () => {
    const state = withBlackHalf();
    state.cooldown[indexOf(def, 5, 5)] = 1;
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 }, "black"),
    ).toBe("cooldown");
  });

  it("着地結果が値域外（自分の1石へ乗る＝1.5）→ illegal-landing", () => {
    const state = withBlackHalf();
    state.cells[indexOf(def, 5, 5)] = 1; // 自分の1石
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 }, "black"),
    ).toBe("illegal-landing");
  });

  it("白の 0.5（-0.5）からのムーブも player=white なら合法（対称）", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = -0.5;
    expect(
      moveRejection(def, state, { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 }, "white"),
    ).toBeNull();
  });
});

describe("resolveSimultaneous — ムーブ／トリス／スワップ（ルール③・加算デルタ寄与）", () => {
  it("空点移動(move): 黒0.5(4,4)→空点(5,5) → to=0.5・from=0・event move・from/to cooldown=1・turnCount+1", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5;
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 5, 5)]).toBe(0.5); // to へ 0.5 が乗る
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0); // from は空く
    expect(r.events.length).toBe(1);
    expect(r.events[0].phenomenon).toBe("move");
    expect(r.events[0].after).toBe(0.5);
    expect(r.state.cooldown[indexOf(def, 4, 4)]).toBe(1); // from へ押印
    expect(r.state.cooldown[indexOf(def, 5, 5)]).toBe(1); // to へ押印
    expect(r.state.turnCount).toBe(1);
  });

  it("cancel(move): 黒0.5(4,4)→白0.5(5,5) → その点0(cancel)・from 0", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5; // 黒0.5
    state.cells[indexOf(def, 5, 5)] = -0.5; // 白0.5（隣接）
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 5, 5)]).toBe(0); // 相殺
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0);
    expect(r.events[0].phenomenon).toBe("cancel");
  });

  it("solidify(move): 黒0.5(4,4)→黒0.5(5,5) → to=1(solidify)・from 0", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5;
    state.cells[indexOf(def, 5, 5)] = 0.5; // 隣接する自分の0.5
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 5, 5)]).toBe(1); // 固まる
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0);
    expect(r.events[0].phenomenon).toBe("solidify");
  });

  it("reduce(move): 黒0.5(4,4)→白1石(5,5) → to=-0.5(reduce)", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5;
    state.cells[indexOf(def, 5, 5)] = -1; // 白1石（隣接）
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 5, 5)]).toBe(-0.5); // 削れて -0.5
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0);
    expect(r.events[0].phenomenon).toBe("reduce");
  });

  it("自分の1石へ移動は拒否: 黒0.5(4,4)→黒1石(5,5) → {ok:false, which:black, reason:illegal-landing}・state 不変", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5;
    state.cells[indexOf(def, 5, 5)] = 1; // 自分の1石
    const cellsBefore = [...state.cells];
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.which).toBe("black");
    expect(r.reason).toBe("illegal-landing");
    expect([...state.cells]).toEqual(cellsBefore);
    expect(state.turnCount).toBe(0);
  });

  it("隣接外拒否: 黒0.5(4,4)→(6,6)（2マス先）→ {ok:false, reason:not-adjacent}", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5;
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 6, toY: 6 },
      null,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not-adjacent");
  });

  it("非0.5移動拒否: from が空 → {ok:false, reason:not-your-half}", () => {
    const state = createInitialState("9"); // (4,4) は空
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not-your-half");
  });

  it("着地点 cooldown 拒否: to が cooldown>0 → {ok:false, reason:cooldown}", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5;
    state.cooldown[indexOf(def, 5, 5)] = 1;
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("cooldown");
  });

  it("トリス: 黒 A(3,3)→D(4,3)・白 C(5,3)→D(4,3) → A,C,D すべて0・event tris", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 3)] = 0.5; // A 黒0.5
    state.cells[indexOf(def, 5, 3)] = -0.5; // C 白0.5
    // D(4,3) は空点。A,C とも D の隣接。
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 3, fromY: 3, toX: 4, toY: 3 },
      { type: "move", fromX: 5, fromY: 3, toX: 4, toY: 3 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 3, 3)]).toBe(0); // A 空く
    expect(r.state.cells[indexOf(def, 5, 3)]).toBe(0); // C 空く
    expect(r.state.cells[indexOf(def, 4, 3)]).toBe(0); // D 空く（デルタ相殺）
    expect(r.events.length).toBe(1);
    expect(r.events[0].phenomenon).toBe("tris");
    expect(r.events[0].after).toBe(0);
    // 3点すべて cooldown 押印。
    expect(r.state.cooldown[indexOf(def, 3, 3)]).toBe(1);
    expect(r.state.cooldown[indexOf(def, 5, 3)]).toBe(1);
    expect(r.state.cooldown[indexOf(def, 4, 3)]).toBe(1);
  });

  it("スワップ: 黒 A(4,4)→B(5,4)・白 B(5,4)→A(4,4) → A=-0.5(白)・B=0.5(黒)・event swap×2", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5; // A 黒0.5
    state.cells[indexOf(def, 5, 4)] = -0.5; // B 白0.5（隣接）
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 4 },
      { type: "move", fromX: 5, fromY: 4, toX: 4, toY: 4 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(-0.5); // A は白の0.5に
    expect(r.state.cells[indexOf(def, 5, 4)]).toBe(0.5); // B は黒の0.5に
    expect(r.events.length).toBe(2);
    expect(r.events.every((e) => e.phenomenon === "swap")).toBe(true);
  });

  it("place と move の混在: 黒 place(0,0)・白 move(8,8)→(7,7) → 両方独立に反映", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 8, 8)] = -0.5; // 白0.5
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 0, y: 0, placeKind: "stone" },
      { type: "move", fromX: 8, fromY: 8, toX: 7, toY: 7 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 0, 0)]).toBe(1); // 黒の着手
    expect(r.state.cells[indexOf(def, 7, 7)]).toBe(-0.5); // 白の移動先
    expect(r.state.cells[indexOf(def, 8, 8)]).toBe(0); // 白の移動元は空く
    expect(r.events.length).toBe(2);
    expect(r.events.map((e) => e.phenomenon).sort()).toEqual(["move", "place"]);
  });

  it("チェーン: 黒 A(3,4)→B(4,4)・白 B(4,4)→C(5,4)（一方の from=他方の to・非swap） → A=0/B=0.5(黒)/C=-0.5(白)・throwなし", () => {
    // 共有セル B の net デルタが相殺せず ±0.5 残る唯一の重なり型。個別合法⇒合算合法
    // （値域 {-1,-0.5,0,0.5,1} に収まる）ことを回帰から守る。
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 4)] = 0.5; // A 黒0.5
    state.cells[indexOf(def, 4, 4)] = -0.5; // B 白0.5（A・C 双方に隣接）
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 3, fromY: 4, toX: 4, toY: 4 }, // 黒 A→B
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 4 }, // 白 B→C
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 3, 4)]).toBe(0); // A 空く（黒が抜ける）
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0.5); // B: 白抜け(-0.5→0)＋黒着地(+0.5)=黒0.5
    expect(r.state.cells[indexOf(def, 5, 4)]).toBe(-0.5); // C 白0.5が着地
    // 特殊(tris/swap)でないので各ムーブを独立ラベル（近似・盤面は上のとおり正）。
    expect(r.events.length).toBe(2);
  });

  it("純粋性: freeze した元 state でも壊れず（ムーブ経路）turnCount 不変", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5;
    const cellsBefore = [...state.cells];
    const cooldownBefore = [...state.cooldown];
    Object.freeze(state.cells);
    Object.freeze(state.cooldown);
    Object.freeze(state);
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(true);
    expect([...state.cells]).toEqual(cellsBefore);
    expect([...state.cooldown]).toEqual(cooldownBefore);
    expect(state.turnCount).toBe(0);
  });

  it("純粋性: moveRights を freeze しても壊れず、戻り値は別参照の深コピー（#5 の巻き戻し防止）", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 4, 4)] = 0.5;
    Object.freeze(state.moveRights); // resolve が元 moveRights に書けば TypeError で即失敗
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 4, fromY: 4, toX: 5, toY: 5 },
      null,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.moveRights).not.toBe(state.moveRights); // 参照が切れている
    expect(r.state.moveRights).toEqual(state.moveRights); // 値は同一
  });
});

describe("isStarPoint — 星・天元判定（ルール②）", () => {
  it("9路の星（4隅の星＋天元）はすべて true", () => {
    // 9路の星: (2,2),(6,2),(4,4=天元),(2,6),(6,6)
    expect(isStarPoint(def, 2, 2)).toBe(true);
    expect(isStarPoint(def, 6, 2)).toBe(true);
    expect(isStarPoint(def, 4, 4)).toBe(true); // 天元
    expect(isStarPoint(def, 2, 6)).toBe(true);
    expect(isStarPoint(def, 6, 6)).toBe(true);
  });

  it("非星点は false（星の隣・盤中の非星・(x,y)取り違えの検出）", () => {
    expect(isStarPoint(def, 0, 0)).toBe(false);
    expect(isStarPoint(def, 3, 4)).toBe(false); // 天元の隣
    expect(isStarPoint(def, 4, 3)).toBe(false);
    expect(isStarPoint(def, 2, 4)).toBe(false); // 星の x と 別の星の y の混成（座標ペア判定の確認）
  });
});

describe("resolveSimultaneous — 1.5手の権利（ルール②・星取得と追加ポア）", () => {
  it("取得(place): 黒が天元(4,4)へ place → moveRights.black===1.5（白は0のまま）", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(def, state, { type: "place", x: 4, y: 4, placeKind: "stone" }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.moveRights.black).toBe(1.5);
    expect(r.state.moveRights.white).toBe(0);
  });

  it("取得しない(place): 黒が非星点(0,0)へ place → moveRights.black===0 のまま", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(def, state, { type: "place", x: 0, y: 0, placeKind: "stone" }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.moveRights.black).toBe(0);
  });

  it("取得(move): 黒0.5(3,4)→星(4,4) へ move（着地点が星）→ moveRights.black===1.5", () => {
    const state = createInitialState("9");
    state.cells[indexOf(def, 3, 4)] = 0.5; // 星(4,4)の隣（非星）に黒0.5
    const r = resolveSimultaneous(
      def,
      state,
      { type: "move", fromX: 3, fromY: 4, toX: 4, toY: 4 },
      null,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0.5); // 星へ 0.5 が乗る
    expect(r.state.moveRights.black).toBe(1.5);
  });

  it("両者同星取得: 黒石・白石が同じ星(4,4)へ（capture で相殺）→ 両者とも 1.5", () => {
    const state = createInitialState("9");
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 4, y: 4, placeKind: "stone" },
      { type: "place", x: 4, y: 4, placeKind: "stone" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0); // 相殺で石は消える
    expect(r.state.moveRights.black).toBe(1.5); // が、着地点が星なら取得は成立
    expect(r.state.moveRights.white).toBe(1.5);
  });

  it("上限据え置き: 既に black=1.5 の state で再度星(4,4)へ → 1.5 のまま（2.0 にならない）", () => {
    const state = createInitialState("9");
    state.moveRights.black = 1.5;
    const r = resolveSimultaneous(def, state, { type: "place", x: 4, y: 4, placeKind: "stone" }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.moveRights.black).toBe(1.5);
  });

  it("持続: black=1.5 の state で星と無関係な普通の手(0,0)を打つ → 1.5 のまま（勝手に消えない）", () => {
    const state = createInitialState("9");
    state.moveRights.black = 1.5;
    const r = resolveSimultaneous(def, state, { type: "place", x: 0, y: 0, placeKind: "stone" }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.moveRights.black).toBe(1.5); // 石に紐付かない＝勝手に消えない
  });

  it("消費: black=1.5 で 主手(1,1)＋追加ポア(0,0) → (0,0)=黒0.5・(1,1)=黒1石・moveRights.black===0", () => {
    const state = createInitialState("9");
    state.moveRights.black = 1.5;
    const r = resolveSimultaneous(
      def,
      state,
      { type: "place", x: 1, y: 1, placeKind: "stone" },
      null,
      { x: 0, y: 0 }, // blackExtra（追加ポア）
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 0, 0)]).toBe(0.5); // 追加ポアで黒0.5
    expect(r.state.cells[indexOf(def, 1, 1)]).toBe(1); // 主手の1石
    expect(r.state.moveRights.black).toBe(0); // 追加ポアを使ったら消費 → 0
    expect(r.state.cooldown[indexOf(def, 0, 0)]).toBe(1); // 追加ポア点にも cooldown 押印
  });

  it("消費と取得の同ラウンド重なり: black=1.5・追加ポアを星(4,4)へ → 消費0→取得1.5 で最終 1.5", () => {
    const state = createInitialState("9");
    state.moveRights.black = 1.5;
    const r = resolveSimultaneous(
      def,
      state,
      null, // 主手はパス
      null,
      { x: 4, y: 4 }, // blackExtra を星へ
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.cells[indexOf(def, 4, 4)]).toBe(0.5); // 星へ黒0.5
    expect(r.state.moveRights.black).toBe(1.5); // 消費(→0) の後に星取得(→1.5)
  });

  it("権利無しで extra 拒否: black=0 で blackExtra 指定 → {ok:false, which:black, reason:no-move-right}・state 不変", () => {
    const state = createInitialState("9"); // moveRights.black=0
    const cellsBefore = [...state.cells];
    const r = resolveSimultaneous(def, state, null, null, { x: 0, y: 0 }, null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.which).toBe("black");
    expect(r.reason).toBe("no-move-right");
    expect([...state.cells]).toEqual(cellsBefore); // 元 state 不変
    expect(state.turnCount).toBe(0);
  });

  it("extra の非合法点拒否: 占有点への extra → {ok:false, which:black, reason:occupied}", () => {
    const state = createInitialState("9");
    state.moveRights.black = 1.5;
    state.cells[indexOf(def, 0, 0)] = 1; // (0,0) は占有
    const r = resolveSimultaneous(def, state, null, null, { x: 0, y: 0 }, null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.which).toBe("black");
    expect(r.reason).toBe("occupied");
  });

  it("純粋性: 元 state（cells/cooldown/moveRights/turnCount）を freeze しても壊れず不変・戻り値は別参照", () => {
    const state = createInitialState("9");
    state.moveRights.black = 1.5;
    const cellsBefore = [...state.cells];
    const cooldownBefore = [...state.cooldown];
    Object.freeze(state.cells);
    Object.freeze(state.cooldown);
    Object.freeze(state.moveRights);
    Object.freeze(state);
    // 消費(→0)＋星取得(→1.5) の両方を通す最も動く経路（追加ポアを星へ）。
    const r = resolveSimultaneous(def, state, null, null, { x: 4, y: 4 }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...state.cells]).toEqual(cellsBefore); // 元 cells 不変
    expect([...state.cooldown]).toEqual(cooldownBefore); // 元 cooldown 不変
    expect(state.turnCount).toBe(0); // 元 turnCount 不変
    expect(state.moveRights).toEqual({ black: 1.5, white: 0 }); // 元 moveRights 不変
    expect(r.state.moveRights).not.toBe(state.moveRights); // 戻り値は別参照
    expect(r.state.moveRights.black).toBe(1.5); // 消費0→星取得1.5
  });
});
