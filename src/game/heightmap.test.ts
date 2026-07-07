import { describe, it, expect } from "vitest";
import { computeHeightField } from "./heightmap";
import { BOARD_SIZES } from "./boardDef";
import { pointCount, indexOf } from "./coords";

const D9 = BOARD_SIZES["9"];
const D13 = BOARD_SIZES["13"];
const D19 = BOARD_SIZES["19"];

/** 空盤 cells（全 0） */
function emptyCells(def = D9): number[] {
  return new Array<number>(pointCount(def)).fill(0);
}

/** (x,y) の一次元インデックス（9路既定） */
function at(x: number, y: number, def = D9): number {
  return indexOf(def, x, y);
}

/** すべての要素が有限か */
function allFinite(arr: number[]): boolean {
  return arr.every((v) => Number.isFinite(v));
}

describe("computeHeightField — 出力長（3盤サイズとも pointCount と一致）", () => {
  for (const def of [D9, D13, D19]) {
    it(`${def.lines}路: ownership/height/pressure 長 = pointCount(${pointCount(def)})`, () => {
      const n = pointCount(def);
      const hf = computeHeightField(def, new Array<number>(n).fill(0));
      expect(hf.ownership.length).toBe(n);
      expect(hf.height.length).toBe(n);
      expect(hf.pressure.length).toBe(n);
      expect(hf.lines).toBe(def.lines);
    });
  }
});

describe("computeHeightField — 空盤（石ゼロ）", () => {
  it("全点 height=1 / ownership=0 / pressure=0・NaN/Infinity なし", () => {
    const hf = computeHeightField(D9, emptyCells());
    expect(hf.height.every((v) => v === 1)).toBe(true);
    expect(hf.ownership.every((v) => v === 0)).toBe(true);
    expect(hf.pressure.every((v) => v === 0)).toBe(true);
    expect(allFinite(hf.height)).toBe(true);
    expect(allFinite(hf.ownership)).toBe(true);
    expect(allFinite(hf.pressure)).toBe(true);
  });
});

describe("computeHeightField — 値域不変条件（混在盤）", () => {
  it("height∈[0,1] / ownership∈[-1,1] / pressure>=0・全要素有限", () => {
    // 5値を散らした非自明な混在盤。
    const cells = emptyCells();
    cells[at(1, 1)] = 1;
    cells[at(2, 1)] = 0.5;
    cells[at(6, 6)] = -1;
    cells[at(5, 6)] = -0.5;
    cells[at(4, 4)] = 1;
    cells[at(7, 2)] = -1;
    cells[at(0, 8)] = 0.5;
    const hf = computeHeightField(D9, cells);

    expect(allFinite(hf.height)).toBe(true);
    expect(allFinite(hf.ownership)).toBe(true);
    expect(allFinite(hf.pressure)).toBe(true);
    for (let i = 0; i < hf.height.length; i++) {
      expect(hf.height[i]).toBeGreaterThanOrEqual(0);
      expect(hf.height[i]).toBeLessThanOrEqual(1);
      expect(hf.ownership[i]).toBeGreaterThanOrEqual(-1);
      expect(hf.ownership[i]).toBeLessThanOrEqual(1);
      expect(hf.pressure[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeHeightField — 単石アンカー（LAMBDA=2.5/T0=1.0 依存の回帰ガード）", () => {
  it("9路中央(4,4)に +1 一石: 自点 pressure≈1 / ownership≈1 / height≈1/e", () => {
    const cells = emptyCells();
    cells[at(4, 4)] = 1;
    const hf = computeHeightField(D9, cells);
    const c = at(4, 4);
    expect(hf.pressure[c]).toBeCloseTo(1.0, 5);
    expect(hf.ownership[c]).toBeCloseTo(1.0, 5);
    // height = 1 - dominance*presence = 1 - 1*(1 - 1/e) = 1/e
    expect(hf.height[c]).toBeCloseTo(1 / Math.E, 5);
  });

  it("9路中央(4,4)に −1 一石: 自点 ownership≈−1（pressure/height は +1 と同値）", () => {
    const cells = emptyCells();
    cells[at(4, 4)] = -1;
    const hf = computeHeightField(D9, cells);
    const c = at(4, 4);
    expect(hf.pressure[c]).toBeCloseTo(1.0, 5);
    expect(hf.ownership[c]).toBeCloseTo(-1.0, 5);
    expect(hf.height[c]).toBeCloseTo(1 / Math.E, 5);
  });
});

describe("computeHeightField — 純粋性（入力不変・決定論）", () => {
  it("呼び出し前後で入力 cells 配列が不変", () => {
    const cells = emptyCells();
    cells[at(2, 3)] = 1;
    cells[at(6, 5)] = -0.5;
    const before = cells.slice();
    computeHeightField(D9, cells);
    expect(cells).toEqual(before);
  });

  it("同一 cells を2回呼ぶと結果が deep-equal（決定論・乱数なし）", () => {
    const cells = emptyCells();
    cells[at(1, 7)] = -1;
    cells[at(4, 4)] = 0.5;
    cells[at(8, 0)] = 1;
    const a = computeHeightField(D9, cells);
    const b = computeHeightField(D9, cells);
    expect(a).toEqual(b);
  });
});

describe("computeHeightField — 黒白対称（全符号反転）", () => {
  it("全 +1↔−1 を反転: height/pressure 不変・ownership は全点符号反転", () => {
    const cells = emptyCells();
    cells[at(2, 2)] = 1;
    cells[at(3, 5)] = 0.5;
    cells[at(6, 6)] = 1;
    cells[at(7, 1)] = 0.5;
    const flipped = cells.map((v) => -v);

    const a = computeHeightField(D9, cells);
    const b = computeHeightField(D9, flipped);

    for (let i = 0; i < a.height.length; i++) {
      expect(b.height[i]).toBeCloseTo(a.height[i], 10);
      expect(b.pressure[i]).toBeCloseTo(a.pressure[i], 10);
      expect(b.ownership[i]).toBeCloseTo(-a.ownership[i], 10);
    }
  });
});

describe("computeHeightField — 係争 > 支配（高さ＝係争度の核）", () => {
  it("等距離の異色挟み(拮抗)は height≈1・ownership≈0", () => {
    const cells = emptyCells();
    cells[at(3, 4)] = 1;
    cells[at(5, 4)] = -1;
    const hf = computeHeightField(D9, cells);
    const mid = at(4, 4);
    expect(hf.height[mid]).toBeCloseTo(1, 6); // dominance≈0 → 最も荒れる
    expect(hf.ownership[mid]).toBeCloseTo(0, 6);
  });

  it("拮抗点の height > 同色挟み点の height（同色は支配＝凪ぐ）", () => {
    const contested = emptyCells();
    contested[at(3, 4)] = 1;
    contested[at(5, 4)] = -1;
    const hfContested = computeHeightField(D9, contested);

    const same = emptyCells();
    same[at(3, 4)] = 1;
    same[at(5, 4)] = 1;
    const hfSame = computeHeightField(D9, same);

    const mid = at(4, 4);
    expect(hfSame.ownership[mid]).toBeCloseTo(1, 6); // 同色=完全支配
    expect(hfContested.height[mid]).toBeGreaterThan(hfSame.height[mid]);
  });
});

describe("computeHeightField — 0.5石の寄与（pressure は mag に線形）", () => {
  it("mag=0.5 単石の pressure は同位置の mag=1 単石のちょうど半分", () => {
    const c05 = emptyCells();
    c05[at(4, 4)] = 0.5;
    const c1 = emptyCells();
    c1[at(4, 4)] = 1;

    const hf05 = computeHeightField(D9, c05);
    const hf1 = computeHeightField(D9, c1);

    // 自点だけでなく遠方の点でも比 0.5（線形性）を確認する。
    for (const [x, y] of [
      [4, 4],
      [0, 0],
      [8, 8],
      [2, 6],
    ]) {
      const i = at(x, y);
      expect(hf05.pressure[i]).toBeCloseTo(hf1.pressure[i] * 0.5, 10);
    }
  });
});

describe("computeHeightField — 全面同色", () => {
  it("全点 +1: ownership=1・height=1−presence(>0 有限)・NaN なし", () => {
    const cells = new Array<number>(pointCount(D9)).fill(1);
    const hf = computeHeightField(D9, cells);
    expect(allFinite(hf.height)).toBe(true);
    expect(allFinite(hf.ownership)).toBe(true);
    expect(allFinite(hf.pressure)).toBe(true);
    for (let i = 0; i < hf.height.length; i++) {
      expect(hf.ownership[i]).toBeCloseTo(1, 10); // dominance=1（片色支配）
      expect(hf.pressure[i]).toBeGreaterThan(0);
      // height = 1 - presence。presence<1（total 有限）ゆえ 0<height<1。
      expect(hf.height[i]).toBeGreaterThan(0);
      expect(hf.height[i]).toBeLessThan(1);
    }
  });
});
