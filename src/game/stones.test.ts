import { describe, it, expect } from "vitest";
import { delta, resolveAdd, classify, classifySimultaneous } from "./stones";

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
  it("自分の0.5に自分の0.5（ムーブ）で solidify", () => {
    expect(classify(0.5, 0.5)).toEqual({ after: 1, phenomenon: "solidify" });
    expect(classify(-0.5, -0.5)).toEqual({ after: -1, phenomenon: "solidify" });
  });
  it("0.5 同士の相殺は cancel（同時着手でもムーブでも消滅）", () => {
    expect(classify(0.5, -0.5)).toEqual({ after: 0, phenomenon: "cancel" });
    expect(classify(-0.5, 0.5)).toEqual({ after: 0, phenomenon: "cancel" });
  });
  it("1石 vs 1石で capture（相打ち）", () => {
    expect(classify(-1, 1)).toEqual({ after: 0, phenomenon: "capture" });
  });
  it("自分の1石が相手の0.5に削られて自分の0.5（reduce）。1のまま残らない", () => {
    expect(classify(-1, 0.5)).toEqual({ after: -0.5, phenomenon: "reduce" });
    expect(classify(1, -0.5)).toEqual({ after: 0.5, phenomenon: "reduce" });
  });
  it("相手の0.5に1石をぶつける手は存在しない（1は動けない）→ 例外", () => {
    expect(() => classify(-0.5, 1)).toThrow(RangeError);
    expect(() => classify(0.5, -1)).toThrow(RangeError);
  });
});

describe("classifySimultaneous — 同点同時着手（ルール①・空きへ黒白両デルタ加算）", () => {
  // design.md ①同時着手の表と一致すること（返り値の生値を直接検証）。
  it("(1,-1) → after 0・capture（相討ち）", () => {
    expect(classifySimultaneous(1, -1)).toEqual({ after: 0, phenomenon: "capture" });
  });
  it("(1,-0.5) → after 0.5・reduce（黒石＋白ポア）", () => {
    expect(classifySimultaneous(1, -0.5)).toEqual({ after: 0.5, phenomenon: "reduce" });
  });
  it("(0.5,-1) → after -0.5・reduce（黒ポア＋白石）", () => {
    expect(classifySimultaneous(0.5, -1)).toEqual({ after: -0.5, phenomenon: "reduce" });
  });
  it("(0.5,-0.5) → after 0・cancel（相殺）", () => {
    expect(classifySimultaneous(0.5, -0.5)).toEqual({ after: 0, phenomenon: "cancel" });
  });
  it("前提違反（dBlack<0 / dWhite>0 / どちらか 0）は RangeError", () => {
    expect(() => classifySimultaneous(-1, -1)).toThrow(RangeError); // dBlack<0
    expect(() => classifySimultaneous(1, 1)).toThrow(RangeError); // dWhite>0
    expect(() => classifySimultaneous(0, -1)).toThrow(RangeError); // dBlack=0
    expect(() => classifySimultaneous(1, 0)).toThrow(RangeError); // dWhite=0
  });
});
