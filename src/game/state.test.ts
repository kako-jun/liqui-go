import { describe, it, expect } from "vitest";
import {
  createInitialState,
  applyState,
  initWithState,
  paintCell,
  serialize,
  deserialize,
  type GameState,
} from "./state";
import { computeTerritory, computeScore } from "./territory";
import { BOARD_SIZES } from "./boardDef";
import { pointCount, indexOf } from "./coords";

const N9 = pointCount(BOARD_SIZES["9"]); // 81
const D9 = BOARD_SIZES["9"];

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

/**
 * 天元(4,4)の8近傍を ringValue で囲い、遠方(0,0)に反対色の黒1石を置いた9路フィクスチャ。
 * 中央(4,4)は直交4近傍の白にだけ接する＝単色包囲（territory=−1）。外周の広い空領域は
 * ring(白)と (0,0)(黒) の両色に接する＝中立（territory=0）なので、中央の判定を乱さない。
 * すべて paintCell で構築し、局面エディタ経由で境界フィクスチャを組めることも同時に示す。
 */
function tengenRing(ringValue: number): GameState {
  let s = createInitialState("9");
  const ring: ReadonlyArray<readonly [number, number]> = [
    [3, 3],
    [4, 3],
    [5, 3],
    [3, 4],
    [5, 4],
    [3, 5],
    [4, 5],
    [5, 5],
  ];
  for (const [x, y] of ring) s = paintCell(s, indexOf(D9, x, y), ringValue);
  return paintCell(s, indexOf(D9, 0, 0), 1); // 遠方の黒1石で外周を中立化
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

  it("deserialize は壊れた JSON 内容（未知 version）を applyState 検証で弾く", () => {
    // deserialize = applyState ∘ JSON.parse。検証経路そのものを1本踏む。
    const badJson = JSON.stringify({ ...createInitialState("9"), version: 2 });
    expect(() => deserialize(badJson)).toThrow(/version/);
  });

  it("deserialize は不正な JSON 文字列（パース不能）で throw", () => {
    expect(() => deserialize("{not valid json")).toThrow();
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
  // throw は必ずメッセージ正規表現で「意図した検証分岐」から出たことまで固定する
  // （bare toThrow() だと別理由の throw でも緑になり退行を見逃す。姉妹 stones.test.ts に倣う）。
  it("未知の version（2）は throw", () => {
    const bad = { ...validState9(), version: 2 } as unknown as GameState;
    expect(() => applyState(bad)).toThrow(/version/);
  });

  it("未知の boardSizeId（\"7\"）は throw", () => {
    const bad = { ...validState9(), boardSizeId: "7" } as unknown as GameState;
    expect(() => applyState(bad)).toThrow(/boardSizeId/);
  });

  it("cells 長が盤サイズより短い（80）は throw", () => {
    const bad = validState9();
    bad.cells = new Array<number>(N9 - 1).fill(0); // 80
    expect(() => applyState(bad)).toThrow(/cells 長/);
  });

  it("cells 長が盤サイズより長い（82）は throw", () => {
    const bad = validState9();
    bad.cells = new Array<number>(N9 + 1).fill(0); // 82
    expect(() => applyState(bad)).toThrow(/cells 長/);
  });

  it("cooldown 長が盤サイズ不一致は throw（cells は正常長で単離）", () => {
    const bad = validState9();
    bad.cooldown = new Array<number>(N9 - 1).fill(0); // 80
    expect(() => applyState(bad)).toThrow(/cooldown 長/);
  });

  it("不正なセル値 0.3 を含む cells は throw", () => {
    const bad = validState9();
    bad.cells[10] = 0.3;
    expect(() => applyState(bad)).toThrow(/不正なセル値/);
  });

  it("不正なセル値 2 を含む cells は throw", () => {
    const bad = validState9();
    bad.cells[10] = 2;
    expect(() => applyState(bad)).toThrow(/不正なセル値/);
  });

  it("NaN を含む cells は throw", () => {
    const bad = validState9();
    bad.cells[10] = NaN;
    expect(() => applyState(bad)).toThrow(/不正なセル値/);
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
    expect(N9).toBe(81); // 13/19 路と対称に pointCount 実値をアンカー（boardDef 破損の一次検出）
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

describe("paintCell — 純粋契約（cells[index] だけ塗り・他は据え置き）", () => {
  it("cells[index] だけ value になり他フィールド（turnCount/cooldown/moveRights/boardSizeId/version）は入力と一致", () => {
    const s = arbitraryState9(); // 非自明な turnCount=7 / cooldown / moveRights を持つ
    const out = paintCell(s, 40, 1); // 40=天元・元は空
    const expectedCells = s.cells.slice();
    expectedCells[40] = 1;
    expect(out.cells).toEqual(expectedCells); // 塗ったマス以外の cells は不変
    expect(out.turnCount).toBe(s.turnCount);
    expect(out.cooldown).toEqual(s.cooldown);
    expect(out.moveRights).toEqual(s.moveRights);
    expect(out.boardSizeId).toBe(s.boardSizeId);
    expect(out.version).toBe(s.version);
  });

  it("塗ったマスの cooldown は据え置き（cooldown[index]≠0 のマスに塗っても cooldown[index] は不変）", () => {
    const s = arbitraryState9(); // cooldown[5]=2, cells[5]=0
    const out = paintCell(s, 5, 1);
    expect(out.cells[5]).toBe(1); // cells は塗り替わる
    expect(out.cooldown[5]).toBe(2); // cooldown は据え置き（塗りは cooldown を触らない）
  });

  it("占有マスへの上書きは throw せず直接置換（cells[index]=1 に −1 を塗ると −1・capture で 0 にならない）", () => {
    const s = arbitraryState9(); // cells[0]=1
    const out = paintCell(s, 0, -1);
    expect(out.cells[0]).toBe(-1); // 足し算（1 + −1 = 0 の capture）ではなく直接置換
  });

  it("cooldown>0 のマスにも塗れる（連続配置禁止＝合法手判定を無視する）", () => {
    const s = arbitraryState9(); // cooldown[0]=1, cells[0]=1
    expect(() => paintCell(s, 0, -0.5)).not.toThrow();
    expect(paintCell(s, 0, -0.5).cells[0]).toBe(-0.5);
  });
});

describe("paintCell — 非破壊・独立性（規律6）", () => {
  it("入力 state を破壊しない（cells/cooldown/moveRights は塗り後も元のまま）", () => {
    const s = arbitraryState9();
    const before = deserialize(serialize(s)); // 深いスナップショット
    paintCell(s, 40, 1);
    expect(s).toEqual(before);
  });

  it("戻り値は入力とは別の配列/オブジェクト（cells/cooldown/moveRights すべて新参照）", () => {
    const s = arbitraryState9();
    const out = paintCell(s, 40, 1);
    expect(out.cells).not.toBe(s.cells);
    expect(out.cooldown).not.toBe(s.cooldown);
    expect(out.moveRights).not.toBe(s.moveRights);
  });

  it("深い独立（戻り値を書き換えても入力に波及しない）", () => {
    const s = arbitraryState9();
    const out = paintCell(s, 40, 1);
    out.cells[0] = -1; // 元は 1
    out.cooldown[0] = 9; // 元は 1
    out.moveRights.black = 0; // 元は 1.5
    expect(s.cells[0]).toBe(1);
    expect(s.cooldown[0]).toBe(1);
    expect(s.moveRights).toEqual({ black: 1.5, white: 0 });
  });
});

describe("paintCell — ブラシ全域（5値塗りと 0 消去）", () => {
  it("5値ブラシ {1,0.5,−1,−0.5} は空マスをその値に塗り、0 で空へ戻せる", () => {
    const base = createInitialState("9");
    for (const v of [1, 0.5, -1, -0.5]) {
      const painted = paintCell(base, 40, v);
      expect(painted.cells[40]).toBe(v);
      expect(paintCell(painted, 40, 0).cells[40]).toBe(0);
    }
  });

  it("0 で消去すると石マスが空になり、1石だけの局面は空局面（初期状態）へ deep-equal で戻る", () => {
    const oneStone = paintCell(createInitialState("9"), 40, 1);
    const erased = paintCell(oneStone, 40, 0);
    expect(erased).toEqual(createInitialState("9"));
  });

  it("同 index・同 value の2回塗りは冪等（1回塗りと deep-equal）", () => {
    const s = arbitraryState9();
    const once = paintCell(s, 40, 1);
    const twice = paintCell(once, 40, 1);
    expect(twice).toEqual(once);
  });

  it("同 index への異値2回塗りは last-wins（1 → −0.5 で cells[index]=−0.5）", () => {
    const a = paintCell(createInitialState("9"), 40, 1);
    const b = paintCell(a, 40, -0.5);
    expect(b.cells[40]).toBe(-0.5);
  });
});

describe("paintCell — 異常系（型・メッセージ・検証順序）", () => {
  // throw は bare toThrow() を避け、メッセージ正規表現で「意図した検証分岐」まで固定する。
  it("value=0.3（5値外）は throw /不正なセル値/", () => {
    expect(() => paintCell(validState9(), 40, 0.3)).toThrow(/不正なセル値/);
  });

  it("value=2（値域外の整数）は throw /不正なセル値/", () => {
    expect(() => paintCell(validState9(), 40, 2)).toThrow(/不正なセル値/);
  });

  it("value=NaN は throw /不正なセル値/", () => {
    expect(() => paintCell(validState9(), 40, NaN)).toThrow(/不正なセル値/);
  });

  it("index=−1 は throw RangeError /範囲外/", () => {
    expect(() => paintCell(validState9(), -1, 1)).toThrow(/範囲外/);
    expect(() => paintCell(validState9(), -1, 1)).toThrow(RangeError);
  });

  it("index=81（n=81 の上界外）は throw RangeError /範囲外/", () => {
    expect(() => paintCell(validState9(), 81, 1)).toThrow(/範囲外/);
    expect(() => paintCell(validState9(), 81, 1)).toThrow(RangeError);
  });

  it("index=3.5（非整数）は throw RangeError /範囲外/", () => {
    expect(() => paintCell(validState9(), 3.5, 1)).toThrow(/範囲外/);
    expect(() => paintCell(validState9(), 3.5, 1)).toThrow(RangeError);
  });

  it("検証順序は index が先: paint(s,−1,2) は /範囲外/（value=2 の /不正なセル値/ ではない）", () => {
    expect(() => paintCell(validState9(), -1, 2)).toThrow(/範囲外/);
    expect(() => paintCell(validState9(), -1, 2)).not.toThrow(/不正なセル値/);
  });
});

describe("paintCell — 境界値（index）", () => {
  it("index=0 と index=80（9路の下端・上端）は塗れる", () => {
    expect(paintCell(validState9(), 0, 1).cells[0]).toBe(1);
    expect(paintCell(validState9(), 80, 1).cells[80]).toBe(1);
  });

  it("非整数境界: index=3 は可・3.5 は throw・4 は可", () => {
    expect(paintCell(validState9(), 3, 1).cells[3]).toBe(1);
    expect(() => paintCell(validState9(), 3.5, 1)).toThrow(/範囲外/);
    expect(paintCell(validState9(), 4, 1).cells[4]).toBe(1);
  });

  it("index 上界は盤サイズに追従する（13路: 168 可・169 範囲外／19路: 360 可・361 範囲外）", () => {
    const s13 = createInitialState("13"); // n = 169
    expect(paintCell(s13, 168, 1).cells[168]).toBe(1);
    expect(() => paintCell(s13, 169, 1)).toThrow(/範囲外/);
    const s19 = createInitialState("19"); // n = 361
    expect(paintCell(s19, 360, 1).cells[360]).toBe(1);
    expect(() => paintCell(s19, 361, 1)).toThrow(/範囲外/);
  });
});

describe("paintCell — シリアライズ往復", () => {
  it("deserialize(serialize(paintCell(...))) は塗った state に deep-equal（往復で不変）", () => {
    const painted = paintCell(arbitraryState9(), 40, -1);
    expect(deserialize(serialize(painted))).toEqual(painted);
  });
});

describe("paintCell × computeTerritory/computeScore — 結合（session770 表示モデル固定）", () => {
  it("天元8近傍を −0.5 で囲うと中央(4,4) は白地 territory=−1・柔らかい柵なので instability=1", () => {
    const s = tengenRing(-0.5);
    const { territory, instability } = computeTerritory(D9, s.cells);
    expect(territory[indexOf(D9, 4, 4)]).toBe(-1);
    expect(instability[indexOf(D9, 4, 4)]).toBe(1);
  });

  it("同リングを −1 に塗り替えると中央は territory=−1 のまま・硬い柵なので instability=0", () => {
    const s = tengenRing(-1);
    const { territory, instability } = computeTerritory(D9, s.cells);
    expect(territory[indexOf(D9, 4, 4)]).toBe(-1);
    expect(instability[indexOf(D9, 4, 4)]).toBe(0);
  });

  it("柵1マス(4,3)を 0 で壊すと中央が外周＋黒石に合流して両色接触＝乾く（territory −1→0）", () => {
    const s = tengenRing(-1);
    // 壊す前は白地。
    expect(computeTerritory(D9, s.cells).territory[indexOf(D9, 4, 4)]).toBe(-1);
    const broken = paintCell(s, indexOf(D9, 4, 3), 0);
    expect(computeTerritory(D9, broken.cells).territory[indexOf(D9, 4, 4)]).toBe(0);
  });

  it("1石の十字で1マス囲い切り＋外周を白1石で中立化すると computeScore は black:1/white:0", () => {
    let s = createInitialState("9");
    s = paintCell(s, indexOf(D9, 1, 2), 1);
    s = paintCell(s, indexOf(D9, 3, 2), 1);
    s = paintCell(s, indexOf(D9, 2, 1), 1);
    s = paintCell(s, indexOf(D9, 2, 3), 1);
    s = paintCell(s, indexOf(D9, 6, 6), -1); // 外周中立化
    expect(computeScore(D9, s.cells)).toEqual({ black: 1, white: 0 });
  });
});
