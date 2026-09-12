/* ★一時措置：パソコンでもスマホ版を表示する。
   ・幅 768px 以上のときだけ html に .sp-force を付ける（実機のスマホは素通り）
   ・window.innerWidth を 390 に見せる。FVの帯・螺旋の寸法はここを読んでいるため、
     これを差し替えないと CSS だけ 390px にしても計算が画面幅のまま食い違う
   戻すときはこのファイルと css/sp-force.css、index.html の2行を消す。 */
(function () {
  var W = 390;
  /* ★実機のスマホを巻き込まないための閾値。W+10（400px）だと iPhone 14 Pro Max（430px）が
     入ってしまい、実機で桁が 390px に縮む。PC の分岐と同じ 768px 以上でだけ効かせる */
  if (window.innerWidth < 768) return;
  document.documentElement.classList.add('sp-force');
  try {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      get: function () { return W; }
    });
    /* ★document.documentElement.clientWidth も桁幅に見せる。
       参加者の声の横送り量がこれを読んでいて、放置すると送りが窓幅ぶんになる */
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      get: function () { return W; }
    });
  } catch (e) {}
})();
