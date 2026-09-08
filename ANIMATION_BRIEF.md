# 目的

このLPに、**アニメーションとデザインで突出したものを作る**。
到達目標は https://alche.studio/ と同水準。平均的に整えるのではなく、
「これは他と違う」と一目で分かるものを作ること。

**今回はLPの目的（説明会の申込を増やす）やコピーの妥当性は評価軸に入れない。**
アニメーションとデザインに全振りしてよい。既存のコピーや情報は、演出の都合で
再配置・再構成してよい。デザインの改修も許可されている。

# 担当

- あなたの作業対象は自分に割り当てられたフォルダ**だけ**。
- `build/` と `_build_original/` は**絶対に触らない**（現行版と控え）。
- もう一方の複製フォルダも触らない。

# 手持ちの素材

| 種類 | 場所 |
|---|---|
| 写真 7,116枚（第1〜4回・SF/ボストン/アイルランド） | `~/Desktop/EdFuture/EdFuture写真素材/` |
| 動画 9本（4K・6〜14秒） | `~/Desktop/EdFuture/EdFuture写真素材/動画/` |
| マスコットSVG（部品ごとにid付き・53ポーズ） | `~/Desktop/EdFuture/EDFUTURE-WORLD-2026/assets/mascot/` |
| ロゴ | `~/Downloads/rogo.png` `rogo1.png` `rogo2.png` |
| 現行LPで使用中の画像・動画 | 自分のフォルダの `img/` `video/` |

マスコットは部品に `id` が付いていて（`arm-left` `leg-right` `head` `panel` `eye-left` `pupil-left` 等）、
関節の回転中心も README に実測値がある。腕脚を個別に動かせる。

# 参考になる自前の蓄積（使っても使わなくてもよい）

| 内容 | 場所 |
|---|---|
| **alche.studio の再現研究** | `~/Desktop/Web制作/サイト再現・クローン/alche-study/` |
| 物理（バネ・流体・粒子） | `~/lp-knowledge/04_engineering/physics/06_playbook.md` / 実装 `~/Desktop/Web制作/技術習作/physics-lab/` |
| 幾何（形・模様・SDF） | `~/lp-knowledge/04_engineering/geometry/06_playbook.md` / 実装 `~/Desktop/Web制作/技術習作/geometry-lab/` |
| 建築（スケール・シークエンス・視界） | `~/lp-knowledge/04_engineering/architecture/06_playbook.md` / 実装 `~/Desktop/Web制作/技術習作/arch-lab/` |
| 和文組版 | `~/lp-knowledge/04_engineering/typography-engineering.md` |
| SVG→3D 変換キット | `~/Desktop/Web制作/技術習作/_svg-to-3d-kit/` |

Blender も使ってよい（`blender` コマンドあり）。three.js / WebGL / WebGPU / Canvas / SVG / CSS、
手段は問わない。ライブラリを使うならローカルに vendor して自己完結させること。

# 守ってほしい技術上の約束

1. **ページが開くこと。** 何をしても、ブラウザで開いて最後までスクロールできる状態で終える。
2. **自己完結。** 外部CDNに依存しない。使うライブラリはフォルダ内に置く。
3. **ブラウザは1つずつ。** Playwright 等を並列で起動しない。過去にグラフィックメモリが枯渇して
   Mac ごと落ちたことがある。必ず1インスタンスずつ、使い終わったら閉じる。
4. **動きを減らす設定を尊重する。** `prefers-reduced-motion: reduce` で過激な動きを止める。
5. **JavaScript が無効でも本文が読めること。** 演出で内容を隠したまま戻らない状態を作らない。
6. 完成したら自分で開いて確認する。壊れたまま終えない。

# 既知の落とし穴（踏むと時間を溶かす）

- `clip-path` で隠した要素は IntersectionObserver に検知されない。隠すなら `mask`。
- 作者側の `display` 指定はブラウザ既定の `[hidden]{display:none}` に勝つ。閉じた状態は明示する。
- SVG の `transform-origin` と `rotate(a cx cy)` を併用すると壊れる。どちらか一方。
- SVG の fill に CSS 変数だけを使うと、変数未対応の描画系で黒に落ちる。
- 和文見出しは「1行に何文字入るか」で割れ方が決まる。vw 比例だと幅ごとに割れ方が変わる。
- 動画を `preload="auto"` にすると低速回線で HTML/CSS の到着まで遅らせる。
- リロード時のスクロール位置復元で、冒頭の演出が画面外で終わることがある。

# 現行LPの構成（改変してよい）

FV（全画面動画＋キャラのセリフ＋CTA）→ 応募から帰国までの流れ（01〜07・前半は日本／後半は現地）
→ 3つの派遣の見開き（開閉式）→ 読み手別タブ（高校生／保護者／大学生）→ 費用 → 後援とメディア
→ 説明会 → よくある質問 → 最終CTA → フッター

配色は バーガンディ `#55161F` / 濃 `#3A0F15` / 漆黒 `#1A0508` / クリーム `#F5EFE6` / 黄 `#FFD83E`。
変えてもよい。

# 終わり方

作業が終わったら、自分のフォルダに `WHAT_I_DID.md` を書いて、
何を作ったか・どういう技術を使ったか・どこを見ればよいかを日本語で残すこと。
