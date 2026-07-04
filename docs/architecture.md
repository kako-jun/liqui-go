# アーキテクチャ

docs-driven 開発。`docs/design.md`（ルールの正本）とコードを並走させる。

## レイヤ分離

```
src/
├── game/            ロジック層。Three.js を一切 import しない純粋ロジック
│   ├── boardDef.ts    定義データ（不変）: 盤サイズ・星・ルール定数。実行時状態を持たない
│   ├── coords.ts      座標 ↔ インデックス変換、ムーブ可能点（純粋関数）
│   ├── stones.ts      足し算エンジン（核）: delta / resolveAdd / classify / classifySimultaneous / applyPlacement
│   ├── stones.test.ts エンジンの境界値テスト
│   ├── rules.ts       合法手判定とターン確定（純粋）: canPlaceAt / placementRejection / legalPlacements / tickCooldowns / commitPlacement / resolveSimultaneous（同時プロット解決・ルール①）
│   ├── rules.test.ts  合法手判定・cooldown 遷移・同時着手・純粋性の境界値テスト
│   └── state.ts       実行時状態 GameState（完全シリアライズ可能）
└── render/          描画層。GameState を読んで描くだけ
    └── boardScene.ts  Three.js シーン構築・盤/格子/星・石マーカー・raycast 交点ピック（onPointClick / setLegalityProbe / ホバー標示）
```

`main.ts` が両層を配線する（state を作り、scene に渡し、黒→白の2段プロット→`resolveSimultaneous`→再描画をつなぐ・ルール① 同時プロット制）。プロット中は位置を盤に描かず（伏せ）、resolve 時に両手を同時に `setState` で反映して公開する。合法手判定は `game/rules.ts`、描画は `render` に閉じ、`render` は合法性を probe 関数注入で受け取るだけで判定ロジックを持たない。同点同時着手は `classifySimultaneous` が「空きセルへ黒白両デルタを同時加算」して足し算核で解決する（capture / reduce / cancel）。

## 設計規律（dev-doctrine 準拠）

1. **定義データと実行時状態の分離** — 不変の盤仕様・ルール定数は `boardDef.ts`。対局中に変わる値は `state.ts` の `GameState` だけ。両者を混ぜない。
2. **単一責務 / 依存の一方向** — `render` は `game` を読むだけ。`game` は `render`（Three.js）を知らない。ロジックは純粋関数に切り出してテスト可能にする。
3. **GameState 完全シリアライズ + `applyState` / `initWithState`** — 状態はプレーンオブジェクト。`serialize`/`deserialize` で JSON ラウンドトリップでき、任意局面から起動・再開・デバッグできる（描画とロジックが分離している機械的な検証点）。
4. **足し算がルールの核** — 石の衝突は全て加算。`resolveAdd` は合法値域 `{-1,-0.5,0,0.5,1}` を外れたら例外を投げ、禁手の取りこぼしを早期に検出する。

## セル値モデル

各交点は数値ひとつ。黒 +、白 −：

| 値    | 意味                              |
| ----- | --------------------------------- |
| `+1`  | 黒の1石（固まった構造物）          |
| `+0.5`| 黒の0.5石（まだ固まらないセメント）|
| `0`   | 空き                              |
| `-0.5`| 白の0.5石                         |
| `-1`  | 白の1石                           |

## コマンド

```
npm run dev          開発サーバ
npm run build        型チェック + 本番ビルド
npm test             ロジックのユニットテスト（vitest）
npm run type-check   型チェックのみ
```
