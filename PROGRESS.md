# PROGRESS（引き継ぎ用・最終更新 2026-09-05 19:05）

## 状態: 完了

ページは **動く状態で完成している**。PC 1280 / SP 390 / SE 375 / JS無効 / WebGL無し / reduced-motion をヘッドレス Chromium で確認し、console エラー 0・横スクロール 0。
解説は `WHAT_I_DID.md`。起動は `cd build-fable && python3 -m http.server 8961`（`file://` では ES Modules と fetch が動かない）。

## 1. 作ったもの

| ファイル | 担当 |
|---|---|
| `index.html` | 全面書き換え。幕 / 固定キャンバス / 上部バー / 章レール / FV（280vh のスクロール区間）/ 01 流れ（足あとの道）/ 02 3つの扉 / 03 タブ / 04 費用 / 後援 / 05 説明会 / FAQ / 最終CTA / フッター |
| `css/base.css` | トークン・リセット・見出し・ボタン・表・写真の出現（mask-size）・出現 |
| `css/fv.css` | 幕・キャンバス・バー・レール・FV・CSS の扉（WebGL 無し用）・カーソル・追従CTA |
| `css/sections.css` | 各章。歩くマスコットの列（sticky）・扉カード（CSS 3D）・タブ・費用カード・チケット・FAQ・最終・フッター |
| `js/door.js` | ★主役。依存ゼロ WebGL2 の「筋ガラスの扉」（背景取り込み屈折＋分散＋ステンシル映像＋MSAA＋床の光と映り込み） |
| `js/lib/{gl,mat4,spring,geom}.js` | WebGL 道具 / 行列 / バネ・半減期 / 面取り箱など |
| `js/mascot.js` | リグ差し替え・顔（瞳追従＋喋り）・歩き（スクロールで足あと）・おじぎ |
| `js/ui.js` | タブ・FAQ/扉カードの開閉・出現・カウント・動画遅延・マグネット・傾き・カーソル・共有・計測 |
| `js/main.js` | 起動。幕 → 扉 intro → スクロール進捗 → 章の色 → 各 UI の結線 |
| `fonts/` | 自己ホスト woff2 9 面（283KB）＋ `build_fonts.py`（コピーを変えたら再実行） |
| `assets/mascot/` | `rig-rev.svg`（暗い地用キーライン付きリグ）・ポーズ・足あと |
| `video/` `img/` | 再エンコード済み動画（door.mp4 ほか 6 本）とポスター・使用中の写真だけ |

## 2. 直前までやっていたこと

- 床への映り込み（`door.js` の `uReflect` 0.16）を入れて確認した。薄く出ている。消すなら 0 にするだけ
- SE 375×667 で FV / 通り抜け / 扉カード / 説明会を確認した

## 3. 残っていること（任意）

1. 実機 iOS Safari での確認（ヘッドレス Chromium のみ確認済み）
2. 申込フォーム URL 受領後に `data-todo="form-url"` の `href="#"` 2 箇所を差し替える
3. 扉の見た目を変えるなら `door.js` `render()` 内の `uFlute` / `uReedK` / `uRefract` / `uDisp` / `uRough`
4. コピーを変えたら `python3 fonts/build_fonts.py`（配信中の 8961 を前提）

## 落とし穴（踏んだもの）

- `body{overflow-x:hidden}` が `@supports{overflow-x:clip}` より後ろにあると sticky が死ぬ（歩くマスコットが止まる）
- `.ch--flow` に `overflow:hidden` を置くと同じく sticky が死ぬ
- 映像の板を scale するとき z を 1 倍にして補正すると板が奥へ逃げる（`M.scaling(sH,sH,sH)` にした）
- `.fv__mascot` の出現アニメと `--fp` のスクロール消しを同じ要素に書くと後者が負ける（中身に付けた）
- 検証で `window.scrollTo` を使うと `scroll-behavior:smooth` のせいで長距離は 900ms では着かない（1.8s 待つか `behavior:'instant'`）

触ってはいけない場所: `build/` `_build_original/` `build-codex/`
