import { describe, it, expect } from "vitest";
import {
  isEmpty,
  isOnCooldown,
  canPlaceAt,
  placementRejection,
  legalPlacements,
  tickCooldowns,
  commitPlacement,
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
