/* パソコン・タブレットの表示。中身はSP版そのままで、左右に地と飾りを足す。
   ・幅 768px 以上のときだけ html に .sp-force を付ける（実機のスマホは素通り）
   ・window.innerWidth を 390 に見せる。FVの帯・螺旋の寸法はここを読んでいるため、
     これを差し替えないと CSS だけ 390px にしても計算が画面幅のまま食い違う
   ★PC専用のレイアウトは持たない。css/*.css に PC用メディアクエリは1つも無い。 */
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

  /* ★左右の地の映像は、ここで初めて src を入れる。
     HTML に src を書くと、.pcbg が display:none の実機でもブラウザが取りに行く
     ことがある。パソコンのときだけ 94KB を読ませる。
     モーション低減のときは再生せず poster（静止画）のままにする */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var vs = document.querySelectorAll('.pcbg__v[data-src]');
  for (var i = 0; i < vs.length; i++) {
    var v = vs[i];
    /* poster も data- から入れる。HTML に書くと display:none でもブラウザが取りに行く */
    v.poster = v.getAttribute('data-poster');
    v.src = v.getAttribute('data-src');
    v.load();
    if (!reduce) {
      var pr = v.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
  }
})();
