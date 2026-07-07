import { describe, it, expect } from "vitest";
import { computeTerritory, computeScore } from "./territory";
import { BOARD_SIZES } from "./boardDef";
import { pointCount, indexOf } from "./coords";
import type { BoardSizeId } from "./boardDef";

const D9 = BOARD_SIZES["9"];

/** 空盤（全 0）の cells を作る。 */
function emptyCells(id: BoardSizeId = "9"): number[] {
  return new Array<number>(pointCount(BOARD_SIZES[id])).fill(0);
}

/** (x,y) にセル値を書く小道具。 */
function set(cells: number[], id: BoardSizeId, x: number, y: number, v: number): void {
  cells[indexOf(BOARD_SIZES[id], x, y)] = v;
}

describe("computeTerritory — 空盤（囲いなし＝全部乾く）", () => {
  it("石ゼロなら全交点が中立 0", () => {
    const { territory } = computeTerritory(D9, emptyCells());
    expect(territory.length).toBe(pointCount(D9));
    expect(territory.every((v) => v === 0)).toBe(true);
  });
});

describe("computeTerritory — 一色の柵で囲い切った地", () => {
  it("黒の十字で囲った1点は +1、白の十字で囲った1点は −1、石セルは 0", () => {
    const cells = emptyCells();
    // (2,2) を黒石の十字で囲う（直交4方向）。
    set(cells, "9", 1, 2, 1);
    set(cells, "9", 3, 2, 1);
    set(cells, "9", 2, 1, 1);
    set(cells, "9", 2, 3, 1);
    // (6,6) を白石の十字で囲う。
    set(cells, "9", 5, 6, -1);
    set(cells, "9", 7, 6, -1);
    set(cells, "9", 6, 5, -1);
    set(cells, "9", 6, 7, -1);

    const { territory } = computeTerritory(D9, cells);

    // 囲われた空点は各色の地。
    expect(territory[indexOf(D9, 2, 2)]).toBe(1);
    expect(territory[indexOf(D9, 6, 6)]).toBe(-1);
    // 石セルは水が乗らない＝0。
    expect(territory[indexOf(D9, 1, 2)]).toBe(0);
    expect(territory[indexOf(D9, 5, 6)]).toBe(0);
  });

  it("0.5石も符号だけで壁になる（黒0.5の十字で囲った点は +1）", () => {
    const cells = emptyCells();
    set(cells, "9", 1, 2, 0.5);
    set(cells, "9", 3, 2, 0.5);
    set(cells, "9", 2, 1, 0.5);
    set(cells, "9", 2, 3, 0.5);
    const { territory } = computeTerritory(D9, cells);
    expect(territory[indexOf(D9, 2, 2)]).toBe(1);
  });
});

describe("computeTerritory — 両色に接する領域は中立（乾く）", () => {
  it("黒と白の両方に接する大域の空領域は 0", () => {
    const cells = emptyCells();
    // 黒の十字（(2,2)を囲う）と白の十字（(6,6)を囲う）を両方置く。
    set(cells, "9", 1, 2, 1);
    set(cells, "9", 3, 2, 1);
    set(cells, "9", 2, 1, 1);
    set(cells, "9", 2, 3, 1);
    set(cells, "9", 5, 6, -1);
    set(cells, "9", 7, 6, -1);
    set(cells, "9", 6, 5, -1);
    set(cells, "9", 6, 7, -1);

    const { territory } = computeTerritory(D9, cells);
    // 外周の広い空領域は黒石にも白石にも接する → 中立 0。
    expect(territory[indexOf(D9, 0, 0)]).toBe(0);
    expect(territory[indexOf(D9, 8, 8)]).toBe(0);
    // 内側のポケットはそれぞれ一色なので色が付く（対比）。
    expect(territory[indexOf(D9, 2, 2)]).toBe(1);
    expect(territory[indexOf(D9, 6, 6)]).toBe(-1);
  });
});

describe("computeTerritory — instability（囲う柵の弱さ＝0.5石の割合）", () => {
  it("1石だけで囲った地は instability 0（硬い柵＝確定＝安定）", () => {
    const cells = emptyCells();
    set(cells, "9", 1, 2, 1);
    set(cells, "9", 3, 2, 1);
    set(cells, "9", 2, 1, 1);
    set(cells, "9", 2, 3, 1);
    const { territory, instability } = computeTerritory(D9, cells);
    expect(territory[indexOf(D9, 2, 2)]).toBe(1);
    expect(instability[indexOf(D9, 2, 2)]).toBe(0);
    // 非territory・石セルは 0。
    expect(instability[indexOf(D9, 1, 2)]).toBe(0);
    expect(instability[indexOf(D9, 0, 0)]).toBe(0);
  });

  it("0.5石だけで囲った同形は instability 1（柔らかい柵＝不安定）", () => {
    const cells = emptyCells();
    set(cells, "9", 1, 2, 0.5);
    set(cells, "9", 3, 2, 0.5);
    set(cells, "9", 2, 1, 0.5);
    set(cells, "9", 2, 3, 0.5);
    const { territory, instability } = computeTerritory(D9, cells);
    expect(territory[indexOf(D9, 2, 2)]).toBe(1);
    expect(instability[indexOf(D9, 2, 2)]).toBe(1);
  });

  it("半々（1石2つ・0.5石2つ）で囲った地は instability 0.5", () => {
    const cells = emptyCells();
    set(cells, "9", 1, 2, 1); // 1石
    set(cells, "9", 3, 2, 1); // 1石
    set(cells, "9", 2, 1, 0.5); // 0.5石
    set(cells, "9", 2, 3, 0.5); // 0.5石
    const { territory, instability } = computeTerritory(D9, cells);
    expect(territory[indexOf(D9, 2, 2)]).toBe(1);
    expect(instability[indexOf(D9, 2, 2)]).toBeCloseTo(0.5, 10);
  });
});

describe("computeTerritory — 値域・NaN無し・純粋性（3盤サイズ）", () => {
  const ids: BoardSizeId[] = ["9", "13", "19"];
  for (const id of ids) {
    it(`${id}路: territory{−1,0,1}・instability[0,1]・NaN無し・長さ一致・入力不変・決定論`, () => {
      const def = BOARD_SIZES[id];
      const cells = emptyCells(id);
      // 5値を散らした任意局面（±1・±0.5・0）。
      set(cells, id, 0, 0, 1);
      set(cells, id, 1, 0, -1);
      set(cells, id, 0, 1, 0.5);
      set(cells, id, 2, 2, -0.5);
      set(cells, id, 4, 4, 1);
      const clone = [...cells];

      const { territory, instability } = computeTerritory(def, cells);

      expect(territory.length).toBe(pointCount(def));
      expect(instability.length).toBe(pointCount(def));
      for (const v of territory) {
        expect(Number.isNaN(v)).toBe(false);
        expect([-1, 0, 1]).toContain(v);
      }
      for (let i = 0; i < instability.length; i++) {
        const u = instability[i];
        expect(Number.isNaN(u)).toBe(false);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        // 非territoryセルの instability は必ず 0。
        if (territory[i] === 0) expect(u).toBe(0);
      }
      // 非破壊。
      expect(cells).toEqual(clone);
      // 決定論（同入力→同出力）。
      const again = computeTerritory(def, cells);
      expect(again.territory).toEqual(territory);
      expect(again.instability).toEqual(instability);
    });
  }
});

describe("computeScore — 取得済みの地の体積(m³・1マス=1m³)", () => {
  it("空盤は 0/0（地なし）", () => {
    expect(computeScore(D9, emptyCells())).toEqual({ black: 0, white: 0 });
  });

  it("黒で1マス囲うと black:1（外周を白石で中立化して純粋に1マスだけ地にする）", () => {
    const cells = emptyCells();
    // (2,2) を黒石の十字で囲う → そのポケットだけ黒の地。
    set(cells, "9", 1, 2, 1);
    set(cells, "9", 3, 2, 1);
    set(cells, "9", 2, 1, 1);
    set(cells, "9", 2, 3, 1);
    // 白石を1つ置き、広い外周領域を「黒白両方に接する＝中立」にする（外周が黒の地に染まるのを防ぐ）。
    set(cells, "9", 6, 6, -1);
    expect(computeScore(D9, cells)).toEqual({ black: 1, white: 0 });
  });

  it("白で1マス囲うと white:1（外周を黒石で中立化）", () => {
    const cells = emptyCells();
    set(cells, "9", 1, 2, -1);
    set(cells, "9", 3, 2, -1);
    set(cells, "9", 2, 1, -1);
    set(cells, "9", 2, 3, -1);
    set(cells, "9", 6, 6, 1);
    expect(computeScore(D9, cells)).toEqual({ black: 0, white: 1 });
  });

  it("囲いのない中立だけの盤は 0/0（黒白が開放空間に1つずつ・ポケットなし）", () => {
    const cells = emptyCells();
    set(cells, "9", 3, 3, 1);
    set(cells, "9", 5, 5, -1);
    expect(computeScore(D9, cells)).toEqual({ black: 0, white: 0 });
  });
});
