# アーキテクチャ

docs-driven 開発。`docs/design.md`（ルール＋表示仕様の正本）とコードを並走させる。

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
│   ├── territory.ts   取得済みの地の検出（純粋・render非依存）: computeTerritory（囲われた地＋不安定さ）/ computeScore（水量=m³=スコア）
│   ├── territory.test.ts  地の判定・不安定さ・値域・純粋性の境界値テスト
│   └── state.ts       実行時状態 GameState（完全シリアライズ可能）: createInitialState / applyState / serialize / deserialize / paintCell（局面エディタ用・cells[i]=value の検証済みクローン。turnCount/cooldown/moveRights は据え置き）
└── render/          描画層。GameState を読んで描くだけ
    └── boardScene.ts  Three.js シーン構築・盤/格子/星・石＝柵（setState）・水＝取得済みの地（setTerritory）・raycast 交点ピック（onPointClick / setLegalityProbe / setMoveSource / ホバー標示）
```

`main.ts` が両層を配線する（state を作り、scene に渡し、黒→白の2段プロット→`resolveSimultaneous`→再描画をつなぐ・ルール① 同時プロット制）。プロット中は位置を盤に描かず（伏せ）、resolve 時に両手を同時に `setState` で反映して公開する。合法手判定は `game/rules.ts`、描画は `render` に閉じ、`render` は合法性を probe 関数注入で受け取るだけで判定ロジックを持たない。同点同時着手は `classifySimultaneous` が「空きセルへ黒白両デルタを同時加算」して足し算核で解決する（capture / reduce / cancel）。ムーブ（ルール③・0.5石のみ隣接8マス）を含む一般の解決は**加算デルタ寄与モデル**で統一する: 各手を `{セル→デルタ}` の寄与に分解（着手=着点へ delta、ムーブ=移動元へ −0.5・移動先へ +0.5）し、両者ぶんを合算して開始盤面へ `resolveAdd` する。これだけで同時2ムーブの**トリス**（同一着点→3点消滅）と**スワップ**（相互移動→入替）が創発する。相手同士の同一セル重なりは 0 方向へ相殺するので合算も合法値域に収まるが、**同一手番の main＋追加ポア（1.5手）が同一セルに重なる場合のみ**合算が超過し得る（例 1石+ポア=1.5）ため、`extraRejection` が着地合計を検証して弾く（main ポア+extra ポア=1.0 は正当な自石生成なので通す）。ルール②（1.5手・星パックマン）も同じモデルに乗る: 星・天元へ**着地**した手番は `moveRights` を `RULES.maxMoveRight`(=1.5) に取得（上限1.5・上書き・冪等・石に紐付かないので取られても持続）。1.5 を持つ手番は**追加ポア0.5**（`resolveSimultaneous` の `blackExtra`/`whiteExtra` オプショナル引数＝着点へ ±0.5 の寄与）を1つ打て、`moveRights` は**消費(→0)→取得(→1.5)の順**で更新する（星に着地すれば結局1.5で持続）。配線層 `main.ts` はフェーズ機械 `black-main →(黒1.5) black-extra → white-main →(白1.5) white-extra → resolve` で追加ポア入力を挟み、`moveRights` の前後差分で「チャージ」を通知する。

## 取得済みの地の検出（#5・territory.ts）

`game/territory.ts` の `computeTerritory(def, cells)` が、盤面から「**一色の柵で囲い切った地**（＝取得済みの目）」を純粋関数で検出する（render 非依存・Three.js 非 import）。design.md 表示仕様「水＝取得済みの地／囲いの無い所は乾く」の土台。

- **地の判定**: 空点を**直交連結でフラッドフィル**し、その領域に直交隣接する石の**符号**を集める。全て黒(+)→`territory=+1`、全て白(−)→`−1`、両色混在 or 石に一つも接しない（盤端だけに面する・空盤含む）→`0`（中立＝乾く）。石セルは `0`（柵の上に水は乗らない）。盤端は壁扱い（境界だが色なし）。石は絶対値でなく**符号**を見る（1石も0.5石も同色の壁として囲いに寄与）＝囲碁の地判定そのもの。
- **不安定さ** `instability[i]` ∈ [0,1] ＝ その領域を囲う石のうち **0.5石（|v|=0.5）が占める割合**（領域単位で全セルに同値を配る）。全部1石→`0`（硬い柵＝確定＝安定）、0.5 が混ざるほど→`1`（柔らかい柵＝不安定＝流れ出しそう）。design.md「0.5石＝柔らかく不安定」「薄い囲み＝不安定＝標高が高い」を体現する。
- 返り値 `{ territory: number[], instability: number[] }`（長さ = `pointCount(def)`）。純粋・非破壊・決定論。9/13/19 路で NaN/Infinity を出さない。
- スコアは territory の ±1 を数えた体積＝m³（`computeScore`。1マス=1m³）。

> 旧 `heightmap.ts`（各石の指数減衰カーネルで「効きの影響場」を作り「高さ＝係争度」を出すモデル）は**誤り**だった。丸い碁石を前提にし、design.md 表示仕様の核（石＝柵・水＝囲われて溜まった地・囲い無し＝乾く）を全くモデルしていなかったため**撤回・削除**した（session770）。

## 描画（#6・boardScene.ts）

design.md 表示仕様どおり「**石＝柵**」「**水＝取得済みの地**」を描く。丸い碁石は使わない。game/render の一方向依存を保つ（render は territory/instability の**プレーンな数値配列**を受け取るだけで game を import しない）。

### 石＝柵（`setState(state)`）

各石を柵として描く。**柱（交点のノード）** ＋ **同色隣接の連結線**（8近傍＝直交＋斜めの同色ペアを結ぶ・幾何に沿って引く）。**視覚文法は 1 チャンネル＝1 意味**に統一する：

| 見た目 | 意味 |
| ---- | ---- |
| 色（黒/白） | どちらの色か |
| 不透明 / 半透明 | 1石 / 0.5石 |
| 実線 / 破線 | 線の両端が1石 / どちらか一方でも0.5 |
| 柵の高さ | **一定**（高さで意味を持たせない） |

- 実線/破線・不透明/半透明は**端点の石種(1/0.5)だけ**で決まる。直交か斜めかは線の向きが違うだけで style には**無関係**（1石同士は斜めでも実線・不透明／0.5 が絡めば直交でも破線・半透明）。
- 柵は**静止**（乱数/時刻を持たない）。0.5 の「不安定」は半透明＋破線で表し、上下の揺れはしない。

### 水＝取得済みの地（`setTerritory(territory, instability)`）

`territory[i]==±1` の空点に、その色の流体色（黒/白）の**半透明の水タイル**を溜める（隣接同色は繋がって一つの池に見える）。**中立(0)・石セル・空盤＝水なし（乾く）**。

- **標高**: 水タイルの基底 Y ＝ `WATER_Y + instability × WATER_RISE`。確定した地（instability=0）＝海抜0付近の**凪の低い池**、不安定な地（instability→1）＝**高く盛り上がって今にも流れ出しそう**。柵の高さは超えない（柵は水上に立つ）。
- **液体の揺らぎ**: 波は render 層の `THREE.Clock` で基底 Y に加算する（`y += amp·sin(t·FREQ + phase)`、amp ∝ instability ＝不安定な水ほど強く揺れる／確定した池は凪ぎ静止）。game は時刻・乱数を持てない（純粋）ので、時刻は render 側だけが持つ。`start()` の `requestAnimationFrame` ループで水面頂点の Y を更新する（メッシュ再生成なし）。

### 配線（`main.ts`）

`renderState()` が state 変化ごとに `computeTerritory(def, state.cells)` を呼び、`setState`（柵）＋ `setTerritory(t.territory, t.instability)`（水）を反映する（毎手 full recompute。純粋・軽量なので差分は持たない）。

### 局面エディタ（自由配置・#17）

対局手順（伏せ→同時プロット→フェーズ機械）を経ずに任意局面を組む編集モード。配線層（`main.ts`）＋ HUD（DOM/CSS）＋ 純粋ヘルパ `paintCell`（`state.ts`）だけで実現し、`game/` のルール・描画層 `boardScene.ts` は変更しない。

- 編集トグル ON でフェーズ機械（同時プロット/追加ポア/ムーブ）を止め、`onPointClick` が「ブラシ値でセルを直接塗る」分岐に入る。ブラシは 黒1(+1)/黒0.5(+0.5)/白1(-1)/白0.5(-0.5)/消す(0)。塗りは `state = paintCell(state, index, brush)` → `renderState()` で柵＋水＋標高をライブ再描画する。**編集中は占有・cooldown・合法手判定を無視**（自由配置）し、ホバー probe は `() => true`（常に緑）に差し替える。
- 編集トグル OFF で `loadState(state)`（既存のプリセット/JSON 読込と同じリセット手順）を呼び、ラウンド機械を初手（黒 main）へ戻して**編集結果の cells のまま**プレイ再開する。`turnCount`/`cooldown`/`moveRights` は塗りでも据え置き（`paintCell` が保持）。
- 局面 JSON のコピー（`serialize`→クリップボード）／貼付け読込（`window.prompt`→`deserialize`→`loadState`）。検証は2層に分ける: (a) **UI 非依存の GameState 不変条件**（`turnCount` 非負整数・`cooldown` 各要素 非負整数・`moveRights` 各色 `0` か `RULES.maxMoveRight`）は `applyState`（game層）が cell 値・長さ検証の隣で `throw` する（deserialize/applyState を通る全経路 = untrusted JSON でも締まる。unit テストで固定）。(b) **配線層固有の制約**（UI は9路固定＝盤サイズ非対応）だけ `main.ts` の `importRejectReason` が見て reject 表示する。`loadState` は `importRejectReason` で盤サイズを弾き、`applyState` を try/catch で囲んで throw（値域・長さ・不正 cell）を `reject 表示`に落として現局面を保つ。全 `loadState` 経路（presets/空盤/編集OFF/JSON読込）が安全（13/19路の妥当JSONや負の turnCount 等のサイレント破損を防ぐ）。
- HUD の対局コントロール行とブラシ行は `hidden` 属性で出し分け、CSS に `#hud .hud-row[hidden]{display:none}` を併記して UA 規則の詳細度負けを防ぐ（`display:flex` を hidden で制御するときの必須対応）。

### 未実装（次段）

- **流れ出す演出（リーク）**: 0.5 の柵が壊れる瞬間・侵食されている地の水が流出するアニメ（design.md「0.5石が消える瞬間＝枠が崩れて液体が流れ出す」）。

## 設計規律（dev-doctrine 準拠）

1. **定義データと実行時状態の分離** — 不変の盤仕様・ルール定数は `boardDef.ts`。対局中に変わる値は `state.ts` の `GameState` だけ。両者を混ぜない。
2. **単一責務 / 依存の一方向** — `render` は `game` を読むだけ。`game` は `render`（Three.js）を知らない。ロジックは純粋関数に切り出してテスト可能にする。
3. **GameState 完全シリアライズ + `applyState` / `initWithState`** — 状態はプレーンオブジェクト。`serialize`/`deserialize` で JSON ラウンドトリップでき、任意局面から起動・再開・デバッグできる（描画とロジックが分離している機械的な検証点）。
4. **足し算がルールの核** — 石の衝突は全て加算。`resolveAdd` は合法値域 `{-1,-0.5,0,0.5,1}` を外れたら例外を投げ、禁手の取りこぼしを早期に検出する。
5. **表示仕様に照らして検証** — 描画は design.md「表示仕様」が正本。ルールのテストが緑でも、石＝柵・水＝取得済みの地の見た目が出ていなければ完了ではない（session770 の再発防止）。

## セル値モデル

各交点は数値ひとつ。黒 +、白 −：

| 値    | 意味                              |
| ----- | --------------------------------- |
| `+1`  | 黒の1石（固まった柵＝実線・不透明）|
| `+0.5`| 黒の0.5石（柔らかい柵＝破線・半透明）|
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
