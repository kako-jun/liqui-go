import { describe, it, expect } from "vitest";
import { delta, resolveAdd, classify } from "./stones";

describe("delta — プレイヤー×着手種類の符号と大きさ", () => {
  it("黒の1石は +1、黒のポアは +0.5", () => {
    expect(delta("black", "stone")).toBe(1);
    expect(delta("black", "pour")).toBe(0.5);
  });
  it("白の1石は -1、白のポアは -0.5", () => {
    expect(delta("white", "stone")).toBe(-1);
    expect(delta("white", "pour")).toBe(-0.5);
  });
});

describe("resolveAdd — すべて足し算（notes の表に準拠）", () => {
  it("空きに1を打つ: 0 + 1 = 1", () => expect(resolveAdd(0, 1)).toBe(1));
  it("空きにポア: 0 + 0.5 = 0.5", () => expect(resolveAdd(0, 0.5)).toBe(0.5));
  it("自分の0.5に自分の0.5: 0.5 + 0.5 = 1（ソリディファイ）", () =>
    expect(resolveAdd(0.5, 0.5)).toBe(1));
  it("自分の0.5に相手の0.5: 0.5 - 0.5 = 0（ブレイク）", () =>
    expect(resolveAdd(0.5, -0.5)).toBe(0));
  it("相手の1にポア: -1 + 0.5 = -0.5（削る）", () => expect(resolveAdd(-1, 0.5)).toBe(-0.5));
  it("相手の1に1を打つ: -1 + 1 = 0（相打ち）", () => expect(resolveAdd(-1, 1)).toBe(0));

  it("合法値域を外れる加算は弾く（自分の1石の上に1石＝禁手）", () => {
    expect(() => resolveAdd(1, 1)).toThrow(RangeError);
    expect(() => resolveAdd(1, 0.5)).toThrow(RangeError);
  });
});

describe("classify — 現象の命名", () => {
  it("空き→1石は place、空き→ポアは pour", () => {
    expect(classify(0, 1).phenomenon).toBe("place");
    expect(classify(0, 0.5).phenomenon).toBe("pour");
  });
  it("自分の0.5にポアで solidify", () => {
    expect(classify(0.5, 0.5)).toEqual({ after: 1, phenomenon: "solidify" });
  });
  it("相手の0.5にポアで break（消滅）", () => {
    expect(classify(0.5, -0.5)).toEqual({ after: 0, phenomenon: "break" });
  });
  it("相手の1石に1石で capture（相打ち）", () => {
    expect(classify(-1, 1)).toEqual({ after: 0, phenomenon: "capture" });
  });
  it("相手の1石にポアで reduce（削る）", () => {
    expect(classify(-1, 0.5)).toEqual({ after: -0.5, phenomenon: "reduce" });
  });
  it("相手の0.5に1石で overpour（色を奪う・要design確認）", () => {
    expect(classify(-0.5, 1)).toEqual({ after: 0.5, phenomenon: "overpour" });
  });
});
