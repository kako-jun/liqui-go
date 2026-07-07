import { describe, it, expect } from "vitest";
import { PRESETS, type Preset } from "./presets";
import { applyState, type GameState } from "./state";
import { computeTerritory, computeScore } from "./territory";
import { BOARD_SIZES } from "./boardDef";
import { pointCount, indexOf } from "./coords";
import { isLegalCellValue } from "./stones";

const D9 = BOARD_SIZES["9"];
const N9 = pointCount(D9); // 81

/** 名前でプリセットを引く（見つからなければテスト側で落とす）。 */
function preset(name: string): Preset {
  const p = PRESETS.find((q) => q.name === name);
  if (!p) throw new Error(`preset not found: ${name}`);
  return p;
}

describe("PRESETS — 全プリセットがシリアライズ可能な合法 state を返す（applyState を通る）", () => {
  it("最低3つのプリセットがある（実戦の終盤・不安定デモ・大きな黒地）", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    const names = PRESETS.map((p) => p.name);
    expect(names).toContain("実戦の終盤（9路）");
    expect(names).toContain("不安定デモ");
    expect(names).toContain("大きな黒地");
  });

  for (const p of PRESETS) {
    it(`「${p.name}」は applyState を throw せず通り、9路 cells 長81・cooldown 長81・全セル5値`, () => {
      const raw = p.state();
      // applyState は不正 cells（長さ・値域・cooldown 長）を throw で弾く。通れば合法。
      const s: GameState = applyState(raw);
      expect(s.boardSizeId).toBe("9");
      expect(s.cells.length).toBe(N9);
      expect(s.cooldown.length).toBe(N9);
      for (const v of s.cells) expect(isLegalCellValue(v)).toBe(true);
      // ラウンド機械の前提: moveRights は {0,0}・cooldown は全0（プリセットは main.ts で
      // フェーズ機械を black-main にリセットして読む）。
      expect(s.moveRights).toEqual({ black: 0, white: 0 });
      expect(s.cooldown.every((c) => c === 0)).toBe(true);
    });

    it(`「${p.name}」は決定論的（2回作って deep-equal・呼び出し間で共有参照を持たない）`, () => {
      const a = p.state();
      const b = p.state();
      expect(a).toEqual(b);
      // 純粋関数だが毎回新しい配列を作る（片方を破壊してももう片方に波及しない）。
      a.cells[0] = a.cells[0] === 1 ? -1 : 1;
      expect(a).not.toEqual(b);
    });
  }
});

describe("「実戦の終盤（9路）」— 黒白の両方が地を持つ（スクショ用の要件・実棋譜由来）", () => {
  const s = applyState(preset("実戦の終盤（9路）").state());
  const score = computeScore(D9, s.cells);
  const { territory, instability } = computeTerritory(D9, s.cells);

  it("computeScore は black>0 かつ white>0（両色に地がある）", () => {
    expect(score.black).toBeGreaterThan(0);
    expect(score.white).toBeGreaterThan(0);
    // 実棋譜（武宮正樹 vs 山田規三生・読売ミニ碁 2000-12-24 の終局図）由来: 黒15m³／白16m³。1マス=1m³。
    expect(score).toEqual({ black: 15, white: 16 });
  });

  it("左上は黒地の安定した池（(0,0)=黒地・instability 0＝全1石の凪）", () => {
    expect(territory[indexOf(D9, 0, 0)]).toBe(1);
    expect(instability[indexOf(D9, 0, 0)]).toBe(0);
  });

  it("左下は白地の安定した池（(0,5)=白地・instability 0）", () => {
    expect(territory[indexOf(D9, 0, 5)]).toBe(-1);
    expect(instability[indexOf(D9, 0, 5)]).toBe(0);
  });

  it("実戦は全て1石なので水は全て確定（0.5石由来の不安定は無い＝全territoryが instability 0）", () => {
    for (let i = 0; i < instability.length; i++) {
      if (territory[i] !== 0) expect(instability[i]).toBe(0);
    }
  });

  it("(3,2) は黒白の柵が両接する唯一のダメで中立＝乾く（水なし）", () => {
    expect(territory[indexOf(D9, 3, 2)]).toBe(0);
  });
});

describe("「不安定デモ」— 0.5石で囲った1マスが最大不安定（instability 1）", () => {
  const s = applyState(preset("不安定デモ").state());
  const { territory, instability } = computeTerritory(D9, s.cells);

  it("囲った天元(4,4)は黒地かつ instability 1（＝今にも流れ出す高い水）", () => {
    expect(territory[indexOf(D9, 4, 4)]).toBe(1);
    expect(instability[indexOf(D9, 4, 4)]).toBe(1);
  });

  it("外周は白1石で中立化されて乾く（(0,0)近傍(1,1)は水なし）", () => {
    expect(territory[indexOf(D9, 1, 1)]).toBe(0);
  });
});

describe("「大きな黒地」— 黒で3×3を囲い切った大きめの池（black=9・white=0）", () => {
  const s = applyState(preset("大きな黒地").state());
  const score = computeScore(D9, s.cells);
  const { territory, instability } = computeTerritory(D9, s.cells);

  it("computeScore は black=9（囲った領域数）・white=0", () => {
    expect(score).toEqual({ black: 9, white: 0 });
  });

  it("内部3×3の全マスが黒地(+1)で instability 0（全1石＝硬い柵＝確定）", () => {
    for (let y = 3; y <= 5; y++) {
      for (let x = 3; x <= 5; x++) {
        expect(territory[indexOf(D9, x, y)]).toBe(1);
        expect(instability[indexOf(D9, x, y)]).toBe(0);
      }
    }
  });
});
