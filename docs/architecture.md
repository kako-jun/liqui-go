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
│   ├── heightmap.ts   確定度→heightmap（純粋・render非依存）: computeHeightField
│   └── state.ts       実行時状態 GameState（完全シリアライズ可能）
└── render/          描画層。GameState を読んで描くだけ
    └── boardScene.ts  Three.js シーン構築・盤/格子/星・石マーカー・raycast 交点ピック（onPointClick / setLegalityProbe / setMoveSource / ホバー標示）
```

`main.ts` が両層を配線する（state を作り、scene に渡し、黒→白の2段プロット→`resolveSimultaneous`→再描画をつなぐ・ルール① 同時プロット制）。プロット中は位置を盤に描かず（伏せ）、resolve 時に両手を同時に `setState` で反映して公開する。合法手判定は `game/rules.ts`、描画は `render` に閉じ、`render` は合法性を probe 関数注入で受け取るだけで判定ロジックを持たない。同点同時着手は `classifySimultaneous` が「空きセルへ黒白両デルタを同時加算」して足し算核で解決する（capture / reduce / cancel）。ムーブ（ルール③・0.5石のみ隣接8マス）を含む一般の解決は**加算デルタ寄与モデル**で統一する: 各手を `{セル→デルタ}` の寄与に分解（着手=着点へ delta、ムーブ=移動元へ −0.5・移動先へ +0.5）し、両者ぶんを合算して開始盤面へ `resolveAdd` する。これだけで同時2ムーブの**トリス**（同一着点→3点消滅）と**スワップ**（相互移動→入替）が創発する。相手同士の同一セル重なりは 0 方向へ相殺するので合算も合法値域に収まるが、**同一手番の main＋追加ポア（1.5手）が同一セルに重なる場合のみ**合算が超過し得る（例 1石+ポア=1.5）ため、`extraRejection` が着地合計を検証して弾く（main ポア+extra ポア=1.0 は正当な自石生成なので通す）。ルール②（1.5手・星パックマン）も同じモデルに乗る: 星・天元へ**着地**した手番は `moveRights` を `RULES.maxMoveRight`(=1.5) に取得（上限1.5・上書き・冪等・石に紐付かないので取られても持続）。1.5 を持つ手番は**追加ポア0.5**（`resolveSimultaneous` の `blackExtra`/`whiteExtra` オプショナル引数＝着点へ ±0.5 の寄与）を1つ打て、`moveRights` は**消費(→0)→取得(→1.5)の順**で更新する（星に着地すれば結局1.5で持続）。配線層 `main.ts` はフェーズ機械 `black-main →(黒1.5) black-extra → white-main →(白1.5) white-extra → resolve` で追加ポア入力を挟み、`moveRights` の前後差分で「チャージ」を通知する。

## 確定度スコアリング（#5）

`game/heightmap.ts` の `computeHeightField(def, cells)` が、盤面から液体地形の土台となる **heightmap** を純粋関数で算出する（render 非依存・Three.js 非 import。水の描画は別レイヤ #6）。核は **高さ＝係争度**：決着した地は海抜0の静かな池、係争中の地は盛り上がって波立つ。

各交点で盤上の全石からの指数減衰寄与 `w = exp(-dist / LAMBDA)` を黒白別に積んで**影響場（influence field）**を作り、そこから 3 つの派生量を出す：`dominance = |pos-neg|/total`（片色支配=1 / 拮抗=0）、`presence = 1 - exp(-total / T0)`（効きの総量。石から遠い点=0）、その積 `settled = dominance × presence`（確定度）。**`height = 1 - settled`**（確定度の裏返し＝係争度・[0,1]）、`ownership = (pos-neg)/total`（[-1,1]・水の着色用）、`pressure = total`（デバッグ／強度用）を `HeightField` として返す。`total=0`（石が届かない点）をガードして 9/13/19 路のどれでも NaN/Infinity を出さない。`LAMBDA=2.5`（減衰長・交点間隔=1 単位）・`T0=1.0`（presence 基準）はレンダリング寄りのチューニング定数なので `RULES` でなく heightmap.ts 内に置く。

## #6 に向けたレンダリング接続方針

`computeHeightField`（#5）の出力 `HeightField = { lines, ownership[-1,1], height[0,1], pressure }` を、液体地形レンダリング（#6）で render 層がどう受け取り Three.js に落とすかの設計メモ。**方針の先行記述であってコードはまだ書かない。** 以下は 4 論点それぞれの推奨案と、短く添える候補。既存事実に接地する：`render/boardScene.ts` の `BoardScene` は既に `setState(state)` で盤面を受け取って `stoneGroup` を張り替え、`start()` が `requestAnimationFrame` ループ（`controls.update()`→`renderer.render()`→`rAF`）を保持している。盤は XZ 平面に敷かれ Y が上（石は `position.set(x, h, y)`）。

### 1. 再計算の粒度 — 推奨: 毎手 full recompute

`computeHeightField` は純粋・軽量（コスト＝点数 × 石数。19 路でも 361 点 ×〜50 石程度で瑣末）なので、**着手のたびに全点を計算し直す**。差分・キャッシュは持たない。配線層 `main.ts` が state 変化時（`resolveSimultaneous`→`setState` の直後、既に state→render を配線している延長）に `computeHeightField(def, state.cells)` を呼び、`BoardScene` の新メソッド（例 `setHeightField(field: HeightField)`）へ渡す。game/render の一方向依存は保たれる（render は HeightField という**プレーンな数値配列**を受け取るだけで、game を import しない）。
候補: 差分再計算（触れたセル周辺だけ更新）。この規模では最適化の価値がなく、純粋関数の単純さを捨てるので**採らない**。

### 2. ジオメトリ写像（頂点 Y 変位）— 推奨: 交点間を細分した水面 Plane

水面は盤を覆う `PlaneGeometry`（既存 board plane と同じ XZ 座標系に敷く）。各頂点の高さを `y = height[p] * HEIGHT_SCALE`（`HEIGHT_SCALE`〜0.6〜1.0 board 単位）で変位する。settled（`height≈0`）＝海抜0の凪の池、係争（`height≈1`）＝盛り上がる、が地形として立ち上がる。**各セルを k×k のサブ quad に細分し**、格子頂点だけでなくセル内部の点も `height`/`ownership` を交点値の bilinear 補間でサンプルして滑らかな液面にする。変位後に `geometry.computeVertexNormals()` で法線を張り直し、`MeshStandardMaterial` のライティングを効かせる（凹凸が陰影で読める）。
候補: 交点そのものを頂点にする最小構成（`lines × lines`）。実装は容易だが 9 路では面が角ばる。第一段の出発点にはできる（下の増分参照）。

### 3. マテリアル／色写像（ownership → 色）— 推奨: 第一段は vertexColors 付き MeshStandardMaterial

`ownership[-1,1]` を白流体 ↔ 黒流体の色 lerp に写像し、`ownership≈0`（係争）は中立の濁り色にする。**まず頂点ごとに `ownership` から頂点カラーを与えた `MeshStandardMaterial`（`vertexColors: true`・`transparent`・低 `roughness`）で早く液体感を出す**。既存の石も `MeshStandardMaterial` なので画作りが揃う。ただし `ownership = (pos−neg)/total` は **presence（効きの総量）を無視する**——盤に石が1つでもあれば、効きの弱い遠方の点でも片色なら ownership が ±1 に飽和する。そこは `height≈1`（最も係争）なのに濃色に塗られてしまい、地形（盛り上がり）と色（濃＝決着）が食い違う。これを避けるため **色の彩度／不透明度(α)は presence（または `pressure`）でゲートする**——ownership だけで着色すると効きの弱い未確定域が濃色になる。第一段でも α か彩度を presence に比例させ、効きの届かない域を薄く抜く。`pressure` は当面デバッグ表示（効きの強い所を可視化）にも使うが、この着色ゲートとして色にも効かせる。
候補: `ShaderMaterial` で流れ・コースティクスまで作り込む（第二段。「出してから磨く」）。

### 4. 波立ち（時間アニメ）— 推奨: 時刻は render 側だけが持ち、基底 height に加算する

game 層は時刻・乱数・副作用を持てない（純粋・`Date`/`Math.random` 禁止）。よって **基底 `HeightField` は毎手 game から来る静的値**とし、**波のアニメーションは render 層の `requestAnimationFrame` 側だけで足す**。式の骨子：

```
displacedY = height[p] * HEIGHT_SCALE + wobbleAmp(height[p]) * sin(t * FREQ + phase(x, y))
```

`wobbleAmp` は `height` に比例（settled=揺れ 0・係争=最大）＝「決着した池は凪ぎ、係争地だけ波立つ」。`phase` を頂点座標で散らして有機的な波紋にする。時刻 `t` は render の経過時間だが、**現状の `start()` ループは時刻を持たない**ので、`BoardScene` に `THREE.Clock` を持たせ、既存ループ内で `clock.getElapsedTime()` を読んで更新点を1つ挿す。推奨は **`ShaderMaterial` に `uTime` uniform を渡し頂点シェーダで波立ちを計算する**（GPU・最安、頂点更新を JS で回さない）。
候補: CPU で毎フレーム頂点属性を更新（この頂点数なら現実的。`position` 属性書き換え＋`needsUpdate`＋`computeVertexNormals`）。`MeshStandardMaterial` のまま `onBeforeCompile` で頂点変位を注入して PBR ライティングを保ったまま GPU 波立ちにする折衷もあり得る。

### 増分の切り分け（第一段=最小で出す → 第二段=磨く）

- **第一段（最小で出す）**: 交点を細分した水面 Plane ＋ `vertexColors` 付き `MeshStandardMaterial`（ownership 着色）＋ CPU もしくは簡易な波立ち。まず「係争地が盛り上がり色が付いて揺れる」ところまでを実ブラウザで出す。
- **第二段（磨く）**: `ShaderMaterial` に移行し、`uTime` 波立ち・半透明・流れ・コースティクス・屈折までシェーダで作り込む。基底 `HeightField` の受け渡し口（`setHeightField`）と毎手 full recompute の配線は第一段のまま流用できる。 (#6)

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
