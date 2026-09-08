/* ★一時措置：パソコンでもスマホ版を表示する。
   ・幅 768px 以上のときだけ html に .sp-force を付ける（実機のスマホは素通り）
   ・window.innerWidth を 390 に見せる。FVの帯・螺旋の寸法はここを読んでいるため、
     これを差し替えないと CSS だけ 390px にしても計算が画面幅のまま食い違う
   戻すときはこのファイルと css/sp-force.css、index.html の2行を消す。 */
(function () {
  var W = 390;
  if (window.innerWidth < W + 10) return;   /* スマホ・細い窓はそのまま */
  document.documentElement.classList.add('sp-force');
  try {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      get: function () { return W; }
    });
  } catch (e) {}
})();
