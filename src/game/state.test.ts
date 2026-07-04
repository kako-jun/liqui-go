import { describe, it, expect } from "vitest";
import {
  createInitialState,
  applyState,
  initWithState,
  serialize,
  deserialize,
  type GameState,
} from "./state";
import { BOARD_SIZES } from "./boardDef";
import { pointCount } from "./coords";

const N9 = pointCount(BOARD_SIZES["9"]); // 81

/** 検証を通る正常な9路 state を毎回新しく作る（負テストで局所改変する土台）。 */
function validState9(): GameState {
  return {
    version: 1,
    boardSizeId: "9",
    cells: new Array<number>(N9).fill(0),
    turnCount: 0,
    cooldown: new Array<number>(N9).fill(0),
    moveRights: { black: 0, white: 0 },
  };
}

/** 5値・非自明な turnCount/cooldown/moveRights を散らした任意局面（9路）。 */
function arbitraryState9(): GameState {
  const cells = new Array<number>(N9).fill(0);
  cells[0] = 1;
  cells[1] = 0.5;
  cells[2] = -0.5;
  cells[3] = -1;
  cells[80] = 0.5;
  const cooldown = new Array<number>(N9).fill(0);
  cooldown[0] = 1;
  cooldown[5] = 2;
  return {
    version: 1,
    boardSizeId: "9",
    cells,
    turnCount: 7,
    cooldown,
    moveRights: { black: 1.5, white: 0 },
  };
}

describe("serialize ↔ deserialize — JSON ラウンドトリップ（規律6）", () => {
  it("初期 state は serialize→deserialize で構造が同一に戻る", () => {
    const s = createInitialState("9");
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it("任意局面（5値・非自明な手数/cooldown/moveRights）も同一に戻る", () => {
    const s = arbitraryState9();
    const round = deserialize(serialize(s));
    expect(round).toEqual(s);
    // 生値も直接確認する
    expect(round.cells[0]).toBe(1);
    expect(round.cells[2]).toBe(-0.5);
    expect(round.cells[3]).toBe(-1);
    expect(round.turnCount).toBe(7);
    expect(round.cooldown[5]).toBe(2);
    expect(round.moveRights).toEqual({ black: 1.5, white: 0 });
  });

  it("deserialize の戻り値は元とも各配列/オブジェクトとも別参照（クローン）", () => {
    const s = arbitraryState9();
    const out = deserialize(serialize(s));
    expect(out).not.toBe(s);
    expect(out.cells).not.toBe(s.cells);
    expect(out.cooldown).not.toBe(s.cooldown);
    expect(out.moveRights).not.toBe(s.moveRights);
  });
});

describe("applyState — 不正 state を弾く", () => {
  it("未知の version（2）は throw", () => {
    const bad = { ...validState9(), version: 2 } as unknown as GameState;
    expect(() => applyState(bad)).toThrow();
  });

  it("未知の boardSizeId（\"7\"）は throw", () => {
    const bad = { ...validState9(), boardSizeId: "7" } as unknown as GameState;
    expect(() => applyState(bad)).toThrow();
  });

  it("cells 長が盤サイズより短い（80）は throw", () => {
    const bad = validState9();
    bad.cells = new Array<number>(N9 - 1).fill(0); // 80
    expect(() => applyState(bad)).toThrow();
  });

  it("cells 長が盤サイズより長い（82）は throw", () => {
    const bad = validState9();
    bad.cells = new Array<number>(N9 + 1).fill(0); // 82
    expect(() => applyState(bad)).toThrow();
  });

  it("cooldown 長が盤サイズ不一致は throw（cells は正常長で単離）", () => {
    const bad = validState9();
    bad.cooldown = new Array<number>(N9 - 1).fill(0); // 80
    expect(() => applyState(bad)).toThrow();
  });

  it("不正なセル値 0.3 を含む cells は throw", () => {
    const bad = validState9();
    bad.cells[10] = 0.3;
    expect(() => applyState(bad)).toThrow();
  });

  it("不正なセル値 2 を含む cells は throw", () => {
    const bad = validState9();
    bad.cells[10] = 2;
    expect(() => applyState(bad)).toThrow();
  });

  it("NaN を含む cells は throw", () => {
    const bad = validState9();
    bad.cells[10] = NaN;
    expect(() => applyState(bad)).toThrow();
  });
});

describe("applyState — 正常 state はクローンを返す", () => {
  it("throw せず、元とも各配列/オブジェクトとも別参照を返す", () => {
    const s = arbitraryState9();
    const out = applyState(s);
    expect(out).toEqual(s);
    expect(out).not.toBe(s);
    expect(out.cells).not.toBe(s.cells);
    expect(out.cooldown).not.toBe(s.cooldown);
    expect(out.moveRights).not.toBe(s.moveRights);
  });

  it("全 5 値（-1,-0.5,0,0.5,1）を含む cells を throw せず受理する", () => {
    const s = validState9();
    s.cells[0] = -1;
    s.cells[1] = -0.5;
    s.cells[2] = 0;
    s.cells[3] = 0.5;
    s.cells[4] = 1;
    const out = applyState(s);
    expect(out.cells.slice(0, 5)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
});

describe("initWithState — applyState の別名として同一挙動", () => {
  it("applyState と同じ関数参照（別名）である", () => {
    expect(initWithState).toBe(applyState);
  });

  it("正常入力で applyState と同じクローンを返す", () => {
    const s = arbitraryState9();
    expect(initWithState(s)).toEqual(applyState(s));
  });

  it("同じ不正入力（version 2）で同様に throw する", () => {
    const bad = { ...validState9(), version: 2 } as unknown as GameState;
    expect(() => initWithState(bad)).toThrow();
    expect(() => applyState(bad)).toThrow();
  });
});

describe("createInitialState — 定義との整合", () => {
  it("9路（既定）は cells/cooldown 長 = pointCount(81)・全 0", () => {
    const s = createInitialState();
    expect(s.cells.length).toBe(N9);
    expect(s.cooldown.length).toBe(N9);
    expect(s.cells.every((v) => v === 0)).toBe(true);
    expect(s.cooldown.every((v) => v === 0)).toBe(true);
  });

  it("9路の初期メタ値: version 1・turnCount 0・moveRights {0,0}", () => {
    const s = createInitialState("9");
    expect(s.version).toBe(1);
    expect(s.boardSizeId).toBe("9");
    expect(s.turnCount).toBe(0);
    expect(s.moveRights).toEqual({ black: 0, white: 0 });
  });

  it("13路は cells/cooldown 長 = pointCount(169)", () => {
    const s = createInitialState("13");
    const n = pointCount(BOARD_SIZES["13"]);
    expect(n).toBe(169);
    expect(s.cells.length).toBe(n);
    expect(s.cooldown.length).toBe(n);
  });

  it("19路は cells/cooldown 長 = pointCount(361)", () => {
    const s = createInitialState("19");
    const n = pointCount(BOARD_SIZES["19"]);
    expect(n).toBe(361);
    expect(s.cells.length).toBe(n);
    expect(s.cooldown.length).toBe(n);
  });
});

describe("任意局面クローンの独立性（規律6 の核・深い独立）", () => {
  it("クローンの cells/cooldown/moveRights を書き換えても元に波及しない", () => {
    const s = arbitraryState9();
    const clone = applyState(s);

    clone.cells[0] = -1; // 元は 1
    clone.cooldown[0] = 9; // 元は 1
    clone.moveRights.black = 0; // 元は 1.5
    clone.moveRights.white = 5; // 元は 0

    expect(s.cells[0]).toBe(1);
    expect(s.cooldown[0]).toBe(1);
    expect(s.moveRights).toEqual({ black: 1.5, white: 0 });
  });

  it("元 state を後から書き換えてもクローンに波及しない", () => {
    const s = arbitraryState9();
    const clone = applyState(s);

    s.cells[0] = -1; // クローン取得後に元を破壊
    s.cooldown[0] = 9;
    s.moveRights.black = 0;
    s.turnCount = 999;

    expect(clone.cells[0]).toBe(1);
    expect(clone.cooldown[0]).toBe(1);
    expect(clone.moveRights).toEqual({ black: 1.5, white: 0 });
    expect(clone.turnCount).toBe(7);
  });
});
