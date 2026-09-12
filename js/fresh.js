/* ★押した直後でもスーパーリロード無しで新しい版を出す。
   GitHub Pages は HTML に cache-control: max-age=600 を付けるので、
   何もしないと最大10分は古い HTML が出続ける。ヘッダーは変えられない。

   version.txt（bump.py が書く）をキャッシュを通さずに取り、
   HTML に埋めた版と食い違ったら、HTML のキャッシュを更新してから1回だけ読み直す。
   ・fetch にも時刻を付ける。ブラウザだけでなく CDN も URL 単位で持つため
   ・同じ版で2回目は走らせない（無限に読み直すのを止める） */
(function () {
  var meta = document.querySelector('meta[name="build"]');
  if (!meta || !window.fetch || !window.sessionStorage) return;
  var here = meta.content;
  fetch('version.txt?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.text() : null; })
    .then(function (t) {
      if (!t) return;
      var latest = t.trim();
      if (!latest || latest === here) return;
      if (sessionStorage.getItem('build-reload') === latest) return;
      sessionStorage.setItem('build-reload', latest);
      /* HTML そのものをキャッシュを飛ばして取り直してから読み直す。
         これをしないと reload しても同じ古い HTML が返る */
      return fetch(location.href, { cache: 'reload' }).then(function () { location.reload(); });
    })
    .catch(function () {});
})();
