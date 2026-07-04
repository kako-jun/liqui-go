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
│   ├── rules.ts       合法手判定とターン確定（純粋）: canPlaceAt / placementRejection / moveRejection / extraRejection / isStarPoint / legalPlacements / tickCooldowns / commitPlacement / resolveSimultaneous（着手・ムーブ・追加ポアを加算デルタ寄与モデルで統一解決・ルール①②③）
│   ├── rules.test.ts  合法手判定・cooldown 遷移・同時着手・純粋性の境界値テスト
│   └── state.ts       実行時状態 GameState（完全シリアライズ可能）
└── render/          描画層。GameState を読んで描くだけ
    └── boardScene.ts  Three.js シーン構築・盤/格子/星・石マーカー・raycast 交点ピック（onPointClick / setLegalityProbe / setMoveSource / ホバー標示）
```

`main.ts` が両層を配線する（state を作り、scene に渡し、黒→白の2段プロット→`resolveSimultaneous`→再描画をつなぐ・ルール① 同時プロット制）。プロット中は位置を盤に描かず（伏せ）、resolve 時に両手を同時に `setState` で反映して公開する。合法手判定は `game/rules.ts`、描画は `render` に閉じ、`render` は合法性を probe 関数注入で受け取るだけで判定ロジックを持たない。同点同時着手は `classifySimultaneous` が「空きセルへ黒白両デルタを同時加算」して足し算核で解決する（capture / reduce / cancel）。ムーブ（ルール③・0.5石のみ隣接8マス）を含む一般の解決は**加算デルタ寄与モデル**で統一する: 各手を `{セル→デルタ}` の寄与に分解（着手=着点へ delta、ムーブ=移動元へ −0.5・移動先へ +0.5）し、両者ぶんを合算して開始盤面へ `resolveAdd` する。これだけで同時2ムーブの**トリス**（同一着点→3点消滅）と**スワップ**（相互移動→入替）が創発する。相手同士の同一セル重なりは 0 方向へ相殺するので合算も合法値域に収まるが、**同一手番の main＋追加ポア（1.5手）が同一セルに重なる場合のみ**合算が超過し得る（例 1石+ポア=1.5）ため、`extraRejection` が着地合計を検証して弾く（main ポア+extra ポア=1.0 は正当な自石生成なので通す）。ルール②（1.5手・星パックマン）も同じモデルに乗る: 星・天元へ**着地**した手番は `moveRights` を `RULES.maxMoveRight`(=1.5) に取得（上限1.5・上書き・冪等・石に紐付かないので取られても持続）。1.5 を持つ手番は**追加ポア0.5**（`resolveSimultaneous` の `blackExtra`/`whiteExtra` オプショナル引数＝着点へ ±0.5 の寄与）を1つ打て、`moveRights` は**消費(→0)→取得(→1.5)の順**で更新する（星に着地すれば結局1.5で持続）。配線層 `main.ts` はフェーズ機械 `black-main →(黒1.5) black-extra → white-main →(白1.5) white-extra → resolve` で追加ポア入力を挟み、`moveRights` の前後差分で「チャージ」を通知する。

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
