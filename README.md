# リキッ碁 / Liqui-go

> Go reimagined with liquid — 物理の碁石では表現できなかった 0.5 石を、液体で実現した囲碁。

石を「丸い碁石」ではなく「液体を閉じ込める枠」として捉え直す。0.5 石（まだ固まっていないセメント）が自然に存在できるので、コミ（五目半）が要らない。地の量は液体量としてリアルタイムに見える。

3 つのルール（① 同時プロット制 ／ ② 1.5 手 ／ ③ 0.5 石が動ける）が絡み合って成立する。石の衝突は**すべて足し算**（黒+ / 白−）で処理する。

詳細は [`docs/design.md`](docs/design.md) を参照。アーキテクチャは [`docs/architecture.md`](docs/architecture.md)。

## 状態

dev scaffold。3D の盤面レンダリング・足し算エンジン・シリアライズ可能な GameState まで。液体地形（シェーダー）と着手インタラクションはこれから。

## 開発

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # ロジックのユニットテスト
npm run build    # 型チェック + 本番ビルド
```

Three.js + TypeScript + Vite。

## ライセンス

MIT
