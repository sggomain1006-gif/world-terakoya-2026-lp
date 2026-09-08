/* =============================================================================
   spiral.js — 応募から帰国までの7段階を螺旋に並べる

   置き方は alche.studio の作品カルーセルと同じ式にした。
   横と奥行きが円を描き、縦だけが位相に比例して動く。円運動と直線運動を
   同じ変数で回すと螺旋になる。

     x  = (i - u) * PHASE          位相（ラジアン）。u はスクロールから作る連番
     tx = sin(x) * RX
     ty = x * RY                   CSS は下が正なので three.js の -y と符号が逆
     tz = cos(x) * RZ - RZ         前面のカードが z = 0 に来るようにずらす
     ry = x * YAW

   本家は WebGL だが、ここは CSS の 3D 変換で組んだ。式が同じなら見え方も同じで、
   文字が DOM のまま残るので読めるし選択もできる。ライブラリを足す必要もない。
   ============================================================================= */

import { expSmooth, safeDt } from './lib/spring.js?v=2026090701';

/* ------------------------------- 螺旋の形 -------------------------------- */
const PHASE = 1.32;     // カード1枚あたりの位相（ラジアン）。本家は 1.0。離して見せるため広げた
const YAW = 0.6;        // 位相1ラジアンあたりの首振り（ラジアン）
const FADE_IN = 1.0;    // |x| がここまでは完全に見える
const FADE_OUT = 3.4;   // ここで消える。同時に見えるのは5枚前後
const SHRINK = 0.12;    // 奥のカードの縮み幅。前面は必ず等倍にして字をぼかさない
const SNAP = 0.5;       // 各段で吸い付く強さ。0 で素通り、1 で完全に段階送り
const HALF_LIFE = 0.07; // 追従の半減期（秒）。フレームレートに依存させない
const ENTRY_SPAN = 0.055;// 入りに使うスクロールの割合。ここで右から滑り込ませる
const ENTRY_X = 0.92;   // 入りの開始位置。区画の幅に対する倍率
const LEAD_IN = 0.5;    // 1枚目が入ってくる手前の位相
const EXIT_PH = 2.9;    // 抜けに使う位相。最後の1枚が左へ消えきる量
const EXIT_STEP = 1.6;  // 抜けに充てるスクロール量（1段ぶんの倍率）
const EXIT_FADE = 0.055;// 章の終わりで見出し・本文・目盛りが消える割合
const DROP = 0.07;      // 螺旋ぜんたいを下げる量（区画の高さに対する割合）

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (e0, e1, v) => {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 画面幅から螺旋の寸法を決める。
    カードの幅を先に決め、半径はその比で出す。こうすると、どの幅でも
    「カード1枚ぶんの隙間を空けて隣が覗く」見え方が一定になる */
function measure(view) {
  const w = view.clientWidth;
  const h = view.clientHeight;
  const win = window.innerWidth;
  const twoCol = win >= 1024;      // 左に本文・右に螺旋の2カラム
  const wide = win >= 768;

  const cw = twoCol ? Math.min(w * 0.60, 452)
    : wide ? Math.min(w * 0.56, 400)
      : Math.min(w * 0.77, 308);

  return {
    cw,
    // 横半径はカード幅の1.55〜1.85倍。ここを広げるほど隣との間が空く
    rx: Math.min(cw * (wide ? 1.85 : 1.55), w * (wide ? 0.58 : 0.70)),
    rz: cw * (wide ? 1.05 : 0.85),
    // 縦の上がり幅。小さくするほどカード同士の段差が浅くなる
    ry: h * (wide ? 0.155 : 0.135),
    // 螺旋ぜんたいを下げる量。区画の中央だと上が空いて見えるので少し沈める
    oy: h * DROP,
    persp: wide ? 1200 : 900,
    // 追従CTAは白い章から出るようになったので、螺旋を左へ逃がす必要はない
    shift: 0,
  };
}

/* ------------------------------- 本体 -------------------------------- */
export function initSpiral({ reduceMotion = false } = {}) {
  const root = document.getElementById('spiral');
  if (!root) return null;

  const track = root.querySelector('.spiral__track');
  const view = root.querySelector('.spiral__view');
  const list = root.querySelector('.spiral__cards');
  const read = root.querySelector('.spiral__read');
  const stage = root.querySelector('.spiral__stage');
  const ground = root.querySelector('.spiral__ground');
  const walker = root.querySelector('.spiral__walker');
  const big = root.querySelector('.spiral__big');
  const cards = Array.from(root.querySelectorAll('.scard'));
  if (!track || !view || !list || !read || cards.length === 0) return null;

  // 動きを減らす設定では螺旋にしない。縦並びのまま読めるほうが目的に合う
  if (reduceMotion) return null;

  const N = cards.length;

  /* 本文をカードから読み物欄へ「移す」。複製ではないので同じ文が2つにならない */
  cards.forEach((card, i) => {
    const detail = card.querySelector('.scard__detail');
    if (!detail) return;
    detail.id = `spiral-detail-${i + 1}`;
    read.appendChild(detail);
    card.setAttribute('aria-describedby', detail.id);
  });
  const bodyBoxes = Array.from(read.querySelectorAll('.scard__detail'));


  root.classList.add('is-3d');
  // 章の地の色を外して FV の映像を透かす。縦並びのときは付けない
  const chapter = root.closest('.ch');
  if (chapter) chapter.classList.add('is-glass');

  /* --------------------------- 寸法とスクロール量 --------------------------- */
  let dim = measure(view);
  let stepPx = 0;

  function layout() {
    dim = measure(view);
    // 1段あたりのスクロール量。読む時間が要るので画面の3/4前後を充てる
    const wide = window.innerWidth >= 768;
    stepPx = Math.round(window.innerHeight * (wide ? 0.62 : 0.74));
    root.style.setProperty('--track-h', `${window.innerHeight + stepPx * (N - 1 + EXIT_STEP)}px`);
    root.style.setProperty('--cw', `${Math.round(dim.cw)}px`);
    root.style.setProperty('--persp', `${dim.persp}px`);
    // 読み物欄の高さは、いちばん長い本文に合わせて固定する。
    // 切り替えのたびに高さが飛ばず、短い機種でも文字が枠から出ない
    root.style.removeProperty('--read-h');
    let max = 0;
    bodyBoxes.forEach((b) => {
      b.style.position = 'static'; b.style.visibility = 'hidden';
      max = Math.max(max, b.offsetHeight);
      b.style.position = ''; b.style.visibility = '';
    });
    root.style.setProperty('--read-h', `${Math.ceil(max)}px`);
  }

  /* ------------------------------ 状態 ------------------------------ */
  let u = 0;            // なめらかにした連番
  let uRaw = 0;
  let vel = 0;
  let shown = -1;
  let pin = 0;            // 0=まだ貼り付いていない 1=入り終わった
  let fade = 0;           // 見出し・本文・目盛りの濃さ（入りと抜けの両方で動く）
  let running = false;
  let raf = 0;
  let last = performance.now();

  function progress() {
    const r = track.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    if (span <= 0) return 0;
    return clamp(-r.top / span, 0, 1);
  }

  function paint() {
    // 入りの量。1 で通常配置、0 で区画の右外
    const ease = 1 - Math.pow(1 - pin, 3);
    const entryPx = (1 - ease) * view.clientWidth * ENTRY_X;
    const entryA = smoothstep(0.04, 0.55, pin);
    if (stage) stage.style.setProperty('--in', fade.toFixed(3));

    for (let i = 0; i < N; i++) {
      const card = cards[i];
      const x = (i - u) * PHASE;
      const a = Math.abs(x);
      const alpha = (1 - smoothstep(FADE_IN, FADE_OUT, a)) * entryA;

      if (alpha <= 0.01) {
        if (card.style.visibility !== 'hidden') {
          card.style.visibility = 'hidden';
          card.style.opacity = '0';
        }
        continue;
      }
      const tx = Math.sin(x) * dim.rx + dim.shift + entryPx;
      const ty = x * dim.ry + dim.oy;
      const tz = Math.cos(x) * dim.rz - dim.rz;
      const rot = x * YAW * 180 / Math.PI;
      const tilt = clamp(vel * 2.4, -3.5, 3.5);      // 送っている勢いのぶんだけ傾ける
      const s = 1 - SHRINK * Math.min(1, a);

      card.style.visibility = 'visible';
      card.style.opacity = alpha.toFixed(3);
      card.style.zIndex = String(1000 - Math.round(a * 100));
      card.style.transform =
        `translate(-50%,-50%) translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,${tz.toFixed(1)}px)` +
        ` rotateY(${rot.toFixed(2)}deg) rotateZ(${tilt.toFixed(2)}deg) scale(${s.toFixed(3)})`;
    }

    const now = clamp(Math.round(u), 0, N - 1);
    if (now !== shown) {
      shown = now;
      cards.forEach((c, i) => c.classList.toggle('is-front', i === now));
      bodyBoxes.forEach((b, i) => b.classList.toggle('is-on', i === now));
      if (big) big.textContent = String(now + 1).padStart(2, '0');
      const phase = cards[now].dataset.phase;
      // 日本を出た合図は、映像にかかる幕の濃さと色で出す。
      // 現地に入ると幕が薄く暖かくなり、後ろの映像がよく見えるようになる
      if (stage) {
        stage.style.setProperty('--scrim',
          phase === 'us' ? 'rgba(58,15,21,.58)' : 'rgba(18,5,8,.76)');
      }
      playFront(now);
    }

    // マスコットは進んだぶんだけ足あとを置きながら歩く
    if (walker && ground) {
      const span = ground.clientWidth - 56;
      const p = N > 1 ? clamp(u / (N - 1), 0, 1) : 0;
      walker.style.setProperty('--walk', `${(span * p).toFixed(1)}px`);
    }
  }

  /* 前面のカードだけ映像を動かす。同時に走らせるのは1本 */
  function playFront(i) {
    cards.forEach((card, j) => {
      const v = card.querySelector('video[data-src]');
      if (!v) return;
      if (j === i) {
        if (!v.dataset.loaded) {
          const n = navigator.connection;
          if (n && (n.saveData || /(^|-)2g$/.test(n.effectiveType || ''))) return;
          v.dataset.loaded = '1';
          const s = document.createElement('source');
          s.type = 'video/mp4'; s.src = v.getAttribute('data-src');
          v.appendChild(s); v.load();
        }
        v.play().catch(() => {});
      } else if (!v.paused) {
        v.pause();
      }
    });
  }

  function tick(now) {
    const dt = safeDt((now - last) / 1000);
    last = now;

    const p = progress();

    /* まだ章に入っていない（軌道の上端が画面の上より下にある）ときは、
       なめらかにせず始まりの状態へ戻す。半減期ぶんの遅れがあると、
       一度螺旋を見たあとで上へ戻ったときに前の絵が 0.3 秒ほど残り、
       FV から下りてくる途中で「1枚目の残像」として見えてしまう */
    if (p <= 0) {
      pin = 0; fade = 0; u = -LEAD_IN; vel = 0;
      paint();
      if (running) raf = requestAnimationFrame(tick);
      return;
    }

    /* 入りはなめらかに、戻りは即座に。上へ戻るときに半減期ぶん待つと、
       入口の手前でカードが薄く残って見える */
    const pinTo = clamp(p / ENTRY_SPAN, 0, 1);
    pin = pinTo < pin ? pinTo : expSmooth(pin, pinTo, 0.05, dt);
    // 章の終わりでは、最後の1枚が左へ消えるのに合わせて文字も消す
    const fadeTo = Math.min(clamp(p / ENTRY_SPAN, 0, 1), clamp((1 - p) / EXIT_FADE, 0, 1));
    fade = expSmooth(fade, fadeTo, 0.05, dt);

    // 前半は1段ずつ送る。後半（抜け）は最後の1枚を左へ流し切る区間
    const mainP = (N - 1) / (N - 1 + EXIT_STEP);
    const leaving = p > mainP;
    const target = leaving
      ? (N - 1) + ((p - mainP) / (1 - mainP)) * EXIT_PH
      : -LEAD_IN + (p / mainP) * (N - 1 + LEAD_IN);
    // 抜けの間は段に吸い付かせない（途中で止まって見える）
    const near = Math.round(target);
    const snapped = leaving ? target : near - (near - target) * (1 - SNAP);

    const prev = u;
    u = expSmooth(u, snapped, HALF_LIFE, dt);
    vel = dt > 0 ? (u - prev) / dt : 0;
    uRaw = target;
    void uRaw;

    paint();
    if (running) raf = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true; last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    cards.forEach((c) => { const v = c.querySelector('video'); if (v && !v.paused) v.pause(); });
  }

  /* 画面に入っているあいだだけ回す */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      es.forEach((e) => (e.isIntersecting ? start() : stop()));
    }, { rootMargin: '10% 0px' }).observe(root);
  } else {
    start();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { layout(); paint(); }, 120);
  }, { passive: true });

  layout();
  // 画像や字が入ってから測り直す
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); paint(); });
  window.addEventListener('load', () => { layout(); paint(); }, { once: true });

  u = -0.5;
  paint();
  return { start, stop, layout, walkerHost: walker ? walker.querySelector('.rig') : null, ground };
}
