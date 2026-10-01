/* =============================================================================
   mascot.js — マスコット（扉の子）のリグ操作
   - リグ SVG を fetch して <img> と差し替える（JS 無効なら <img> のまま）
   - 顔: 瞳がカーソルを追い、近づくと喋る（瞬きつき）
   - 歩き: スクロール量で歩き、着地のたびに虹の足あとを置く
   - おじぎ: 画面に入ったとき一礼

   規則（assets/mascot/README.md より）
   - transform-origin を持つ要素は style.transform（中心を書かない）で回す
   - 胴体を傾けるときは必ず #torso を回す
   - #trail は隠す（動的に置く足あとと二重になる）
   ============================================================================= */

import { Spring, expSmooth, safeDt } from './lib/spring.js?v=2026100196';

const rigCache = new Map();

async function fetchRig(url) {
  if (!rigCache.has(url)) {
    rigCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`rig ${url}: ${r.status}`);
      return r.text();
    }));
  }
  return rigCache.get(url);
}

function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('rig: not svg');
  return document.importNode(svg, true);
}

/** ページ内の .rig[data-rig] をすべてリグに差し替える。失敗した要素は <img> のまま */
export async function mountRigs(root = document) {
  const hosts = Array.from(root.querySelectorAll('.rig[data-rig]'));
  const results = await Promise.allSettled(hosts.map(async (host) => {
    const text = await fetchRig(host.getAttribute('data-rig'));
    const svg = parseSvg(text);
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const img = host.querySelector('img');
    if (img) img.replaceWith(svg); else host.appendChild(svg);
    host.classList.add('is-rigged');
    applyPose(svg, host.getAttribute('data-pose'));
    return host;
  }));
  return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

const q = (svg, id) => svg.querySelector('#' + id);

/* ---------------------------------------------------------------------------
   関節を回す（★白フチ付きの -rev は二層構造なので、両方を同じ角度で回す）

   -rev は「太いクリームのストロークで描いた複製（白フチ層）」と「本体」の2枚。
   白フチ層のグループには id が無いが、★本体と同じ transform-origin を持っている。
   そこで原点の文字列で突き合わせて対にする（実測 20個中19個が1対1で対応）。
   本体だけ回すと白フチが取り残され、背後に白い影が残る
   （2026-09-30 に最終CTAのおじぎで実際に起きた）
   --------------------------------------------------------------------------- */
const jointMaps = new WeakMap();
function jointMap(svg) {
  let m = jointMaps.get(svg);
  if (m) return m;
  m = new Map();
  const byOrigin = new Map();
  svg.querySelectorAll('g[style]').forEach((g) => {
    const o = g.style.transformOrigin;
    if (!o) return;
    if (!byOrigin.has(o)) byOrigin.set(o, []);
    byOrigin.get(o).push(g);
  });
  byOrigin.forEach((els) => {
    const named = els.find((e) => e.id);
    if (named) m.set(named.id, els);   /* [本体, 白フチ…] */
  });
  jointMaps.set(svg, m);
  return m;
}
/** id の関節を deg 度回す。-rev なら白フチ層も一緒に回る */
function rotJoint(svg, id, deg) {
  const els = jointMap(svg).get(id);
  const t = `rotate(${deg.toFixed(2)}deg)`;
  if (els) { els.forEach((e) => { e.style.transform = t; }); return; }
  const one = q(svg, id);           /* 原点を持たないファイル向けの退避 */
  if (one) one.style.transform = t;
}

/** 静止ポーズ（リグの静止角からの差分・度） */
function applyPose(svg, pose) {
  const set = (id, deg) => rotJoint(svg, id, deg);
  if (pose === 'point') {
    set('arm-right', -56);
    set('arm-left', 6);
  } else if (pose === 'bow') {
    set('arm-left', -20);
    set('arm-right', 26);
  }
}

// ---------------------------------------------------------------------------
// 顔: 瞳がカーソルを追う・近いと喋る
// ---------------------------------------------------------------------------
/* ---------------------------------------------------------------------------
   画面に入っている間だけ rAF を回す。
   ★これが無いと、閉じた <details> の中など一生見えない場所の輪郭でも
     毎フレーム SVG の style を書き続ける（実測で2本・計224回/秒）。
   ★見え方は変わらない。見えていない間に進まないぶん、位相が変わるだけ
   --------------------------------------------------------------------------- */
function whileVisible(host, start, stop) {
  if (!('IntersectionObserver' in window)) { start(); return () => stop(); }
  let on = false;
  const io = new IntersectionObserver((es) => {
    const vis = es.some((e) => e.isIntersecting);
    if (vis === on) return;
    on = vis;
    if (vis) start(); else stop();
  }, { rootMargin: '120px 0px' });
  io.observe(host);
  const onHidden = () => { if (document.hidden) stop(); else if (on) start(); };
  document.addEventListener('visibilitychange', onHidden);
  return () => { io.disconnect(); document.removeEventListener('visibilitychange', onHidden); stop(); };
}

export function attachFace(host, { reduceMotion = false } = {}) {
  const svg = host.querySelector('svg');
  if (!svg || reduceMotion) return () => {};
  const EL = q(svg, 'eye-left'), ER = q(svg, 'eye-right');
  const PL = q(svg, 'pupil-left'), PR = q(svg, 'pupil-right');
  const F = q(svg, 'face'), M = q(svg, 'mouth');
  if (!EL || !ER || !PL || !PR || !F || !M) return () => {};

  /* ★変形の軸を必ず自分の中心に置く。
     rig.svg は6つの可動部に transform-box:view-box と transform-origin を持っているが、
     pose-*.svg は持っていない。原点が無いまま scaleY / rotate を掛けると、
     SVG の既定どおり viewBox の原点（-99,-54）を軸に掛かってしまい、
     口が数百ユニット上へ滑って目に重なる。何度も起きていた「目や口が重なる」の正体。
     ファイル側が自分で原点を書いているときは尊重し、無いときだけ fill-box で補う */
  [F, EL, ER, PL, PR, M].forEach((el) => {
    if (!el.style.transformOrigin && !el.getAttribute('transform-origin')) {
      el.style.transformBox = 'fill-box';
      el.style.transformOrigin = '50% 50%';
    }
  });

  /* ★瞳の可動域は決め打ちでなく、目と瞳の実寸から出す。
     固定値（旧 16 / 12 ユニット）はポーズによって目からはみ出す。
     目の内側に収まる範囲の 72% までしか動かさない */
  let MAXX = 16, MAXY = 12;
  try {
    const eb = EL.getBBox(), pb = PL.getBBox();
    if (eb.width && pb.width) {
      MAXX = Math.max(0, (eb.width - pb.width) / 2) * 0.72;
      MAXY = Math.max(0, (eb.height - pb.height) / 2) * 0.72;
    }
  } catch (e) { /* 描画前などで bbox が取れないときは既定値のまま */ }

  let px = 0, py = 0, near = 0, alive = true;
  const onMove = (e) => {
    const r = host.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    px = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width * 1.6)));
    py = Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height * 1.6)));
    const d = Math.hypot(e.clientX - cx, e.clientY - cy);
    near = Math.max(0, Math.min(1, 1 - (d - r.width * 0.6) / (r.width * 2.2)));
  };
  const onLeave = () => { near = 0; };
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);

  let ex = 0, ey = 0, tilt = 0, mouth = 1, mTarget = 1, nextTalk = 0, blinkUntil = 0;
  let nextBlink = performance.now() + 2400 + Math.random() * 2000;
  let last = performance.now();
  let raf = 0;
  const halfLife = (cur, tgt, half, h) => cur + (tgt - cur) * (1 - Math.pow(2, -h / half));

  function tick(now) {
    if (!alive) return;
    const h = Math.min((now - last) / 1000, 0.05); last = now;
    ex = halfLife(ex, px * MAXX, 0.09, h);
    ey = halfLife(ey, py * MAXY, 0.09, h);
    tilt = halfLife(tilt, px * 4.5, 0.22, h);
    if (near > 0.25) {
      if (now > nextTalk) { mTarget = 0.55 + Math.random() * 0.8; nextTalk = now + 90 + Math.random() * 130; }
    } else { mTarget = 1; }
    mouth = halfLife(mouth, mTarget, 0.05, h);
    if (now > nextBlink) { blinkUntil = now + 95; nextBlink = now + 2600 + Math.random() * 3800; }
    const lid = now < blinkUntil ? 0.07 : 1;
    PL.style.transform = `translate(${ex}px,${ey}px)`;
    PR.style.transform = `translate(${ex}px,${ey}px)`;
    EL.style.transform = `scaleY(${lid})`;
    ER.style.transform = `scaleY(${lid})`;
    M.style.transform = `scaleY(${mouth})`;
    F.style.transform = `rotate(${tilt}deg)`;
    raf = requestAnimationFrame(tick);
  }
  const stopLoop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const startLoop = () => { if (!raf && alive) raf = requestAnimationFrame(tick); };
  const detach = whileVisible(host, startLoop, stopLoop);

  return () => {
    alive = false;
    detach();
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
  };
}

// ---------------------------------------------------------------------------
// 歩き: スクロール量で歩く。着地のたびに足あとを置く
// ---------------------------------------------------------------------------
export function attachWalker(host, { column, footprintSrc, reduceMotion = false, maxPrints = 90, strideX = 46 } = {}) {
  const svg = host.querySelector('svg');
  if (!svg || !column) return () => {};
  const L = q(svg, 'leg-left'), R = q(svg, 'leg-right');
  const AL = q(svg, 'arm-left'), AR = q(svg, 'arm-right');
  const T = q(svg, 'torso');
  if (!L || !R || !AL || !AR || !T) return () => {};
  // 靴 = 脚グループの最後の子（チューブ → ワイン → クリーム部品の順に描いている）
  const shoeL = L.lastElementChild, shoeR = R.lastElementChild;

  const LEG = 17, ARM = 15, BOB = 6;
  /* ★2026-09-11: 脚の周期をスクロール量でなく「実際に横へ進んだ距離」で回す。
     以前はスクロール 96px ごとに1周期だったが、この子が横へ進むのは螺旋ぜんたいで
     320px 前後しかない。スクロール 5600px では 58 周期＝1歩あたり 5.5px しか進まず、
     その場で脚だけが高速回転し、足あとも 3〜4px 間隔で敷き詰められていた。
     横の移動量で回せば、どの画面幅でも歩幅が一定になる（PC は横が広いぶん歩数も増える）*/
  const STRIDE_X = strideX;      // 1 周期（2歩）で横に進む距離
  let phase = 0;                 // 周期 [0,1)
  let lastX = null;
  let amp = 0;                   // 動いている度合い（止まると脚が戻る）
  let vel = 0;
  let lastLand = -1;
  let alive = true;
  let raf = 0;
  let lastNow = performance.now();
  const prints = [];

  if (reduceMotion) return () => {};

  function stamp(shoe, side) {
    const cr = column.getBoundingClientRect();
    const br = shoe.getBoundingClientRect();
    if (!br.width) return;
    const el = document.createElement('img');
    el.src = footprintSrc;
    el.alt = '';
    el.className = 'trail__print';
    el.style.setProperty('--r', (side < 0 ? -8 : 6) + 'deg');
    el.style.left = (br.left - cr.left + br.width * 0.5 - 9) + 'px';
    el.style.top = (br.bottom - cr.top - 10) + 'px';
    column.appendChild(el);
    prints.push(el);
    requestAnimationFrame(() => el.classList.add('is-on'));
    while (prints.length > maxPrints) { const old = prints.shift(); old.remove(); }
  }

  function tick(now) {
    if (!alive) return;
    const dt = safeDt((now - lastNow) / 1000); lastNow = now;
    const hr = host.getBoundingClientRect();
    const cr = column.getBoundingClientRect();
    const x = hr.left - cr.left;                 // 足あとの列の中での横位置
    if (lastX === null) lastX = x;
    const dx = x - lastX; lastX = x;
    vel = expSmooth(vel, dx / Math.max(dt, 1e-3), 0.08, dt);
    const moving = Math.abs(vel) > 6 ? 1 : 0;
    amp = expSmooth(amp, moving, 0.14, dt);
    // 進んだぶんだけ歩く（戻るときも脚は動くが足あとは置かない）
    if (dx !== 0) phase = ((phase + dx / STRIDE_X) % 1 + 1) % 1;
    const sw = Math.sin(phase * Math.PI * 2) * amp;
    L.style.transform = `rotate(${LEG * sw}deg)`;
    R.style.transform = `rotate(${-LEG * sw}deg)`;
    AL.style.transform = `rotate(${-ARM * sw}deg)`;
    AR.style.transform = `rotate(${ARM * sw}deg)`;
    const bob = -BOB * Math.abs(Math.cos(phase * Math.PI * 2)) * amp;
    T.style.transform = `rotate(${vel > 0 ? 3 * amp : -2 * amp}deg) translateY(${bob}px)`;

    // 着地 = sin が ±1 の位相（0.25: 右足前, 0.75: 左足前）。前進中のみ置く
    if (dx > 0 && amp > 0.35) {
      const landIndex = Math.floor((x + STRIDE_X * 0.25) / (STRIDE_X / 2));
      if (landIndex !== lastLand) {
        lastLand = landIndex;
        const inView = hr.bottom > 0 && hr.top < window.innerHeight;
        if (inView) stamp(landIndex % 2 ? shoeL : shoeR, landIndex % 2 ? -1 : 1);
      }
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return () => { alive = false; cancelAnimationFrame(raf); };
}

// ---------------------------------------------------------------------------
// おじぎ: 画面に入るたびに一礼
// ---------------------------------------------------------------------------
export function attachBow(host, { reduceMotion = false } = {}) {
  const svg = host.querySelector('svg');
  if (!svg || reduceMotion) return () => {};
  const T = q(svg, 'torso');
  if (!T) return () => {};
  const s = Spring.fromFeel({ settle: 1.1, overshoot: 0.12 });
  let raf = 0, last = 0, alive = true, timer = 0;
  function loop(now) {
    if (!alive) return;
    const dt = safeDt((now - (last || now)) / 1000); last = now;
    const v = s.step(dt);
    T.style.transform = `rotate(${v}deg)`;
    if (!s.isSettled(0.02, 0.2)) raf = requestAnimationFrame(loop); else { raf = 0; last = 0; }
  }
  function kick() {
    s.setTarget(14);
    clearTimeout(timer);
    timer = setTimeout(() => s.setTarget(0), 900);
    if (!raf) raf = requestAnimationFrame(loop);
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) kick(); });
  }, { threshold: 0.5 });
  io.observe(host);
  return () => { alive = false; io.disconnect(); cancelAnimationFrame(raf); clearTimeout(timer); };
}

/* ---------------------------------------------------------------------------
   指さしの腕。場所は動かさず、腕だけをゆっくり上下させる。
   周期の違う2つの波を重ねて、往復に見えないようにする
   --------------------------------------------------------------------------- */
export function attachPointing(host, { reduceMotion = false } = {}) {
  const svg = host.querySelector('svg');
  if (!svg || reduceMotion) return () => {};
  const A = q(svg, 'arm-left'), F = q(svg, 'arm-left-fore'), T = q(svg, 'torso');
  if (!A) return () => {};
  let alive = true, raf = 0;
  const t0 = performance.now();
  function tick(now) {
    if (!alive) return;
    const t = (now - t0) / 1000;
    const a = Math.sin(t * 1.15) * 5.2 + Math.sin(t * 0.47 + 1.1) * 2.4;
    A.style.transform = `rotate(${a.toFixed(2)}deg)`;
    if (F) F.style.transform = `rotate(${(a * 0.55).toFixed(2)}deg)`;
    if (T) T.style.transform = `rotate(${(Math.sin(t * 0.63) * 1.1).toFixed(2)}deg)`;
    raf = requestAnimationFrame(tick);
  }
  const stopLoop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const startLoop = () => { if (!raf && alive) raf = requestAnimationFrame(tick); };
  const detach = whileVisible(host, startLoop, stopLoop);
  return () => { alive = false; detach(); };
}

// ---------------------------------------------------------------------------
// ジャンプ: 画面に入ったとき一度だけ、膝を曲げて跳ぶ
//   ・位置  … バネ（速度を保持するのでスクロールで割り込まれても破綻しない）
//   ・膝    … もう1本のバネ。1本のスカラー bend（+1 しゃがみ / 0 休止 / -1 伸び）を
//              各関節の角度へ区分線形で写す。時刻でなくバネで駆動するので位置と食い違わない
//   ★-rev リグなので rotJoint で白フチ層も一緒に回す（本体だけだと白い影が残る）
//   ★箱ごとの scale（潰し伸び）はやめた。顔と板まで潰れてゴムに見え、
//     それが「形が変わらず上下しているだけ」の正体だった
// ---------------------------------------------------------------------------
/* 休止角はリグの静止姿勢から「指差しポーズ」を作る差分。
   crouch は bend>0 側のゲイン、stretch は bend<0 側のゲイン（×|bend|）。
   ★足裏が動かない組み合わせを総当たりで出してある（腿を外へ・脛を真下へ）。
     脛を腰側へ畳むと足が浮いて「空中タック」になり、しゃがみに読めない */
const JUMP_JOINTS = {
  'leg-left':       { rest: 0, crouch: 20, stretch: -8 },
  'leg-left-fore':  { rest: 0, crouch: -20, stretch: -17 },
  'leg-right':      { rest: 0, crouch: -20, stretch: 8 },
  'leg-right-fore': { rest: 0, crouch: 20, stretch: 29 },
  /* ★rest は applyPose('point') と同じ 6 度。-16 のままだと跳ぶ最初の1フレームで
     左腕が22度飛び、着地後も静止ポーズに戻らない（跳ぶ前と後で姿勢が変わる） */
  'arm-left':       { rest: 6, crouch: -12, stretch: 8 },
  'arm-right':      { rest: -56, crouch: 10, stretch: -8 },
};
const SINK_UNITS = 60;     /* しゃがみで沈む量。viewBox 単位 */
const VIEWBOX_W = 1420;

export function attachJump(host, { reduceMotion = false, height = 100 } = {}) {
  const lift = host.closest('.intro__buddy-lift');
  const svg = host.querySelector('svg');
  if (!lift || !svg || reduceMotion || !('IntersectionObserver' in window)) return () => {};

  const pos = Spring.fromFeel({ settle: 0.5, overshoot: 0.05 });   /* 位置 */
  const knee = Spring.fromFeel({ settle: 0.3, overshoot: 0.08 });  /* 膝 */
  const LAUNCH_AT = 0.85;   /* しゃがみがここまで入ったら蹴る */
  const SAFETY = 160;       /* 念のための上限（ms） */
  const BELOW = 0.6;        /* ★落下の目標は地面の下。0 だと着地直前に減速してふわっと置かれる */
  const MIN_H = 28;
  let raf = 0, last = 0, alive = true, fired = false;
  let phase = 'ground', timer = 0, H = height, landed = false;

  /* ★跳躍中に幅は変わらないので kick() で一度だけ測る。draw() で毎フレーム
     getBoundingClientRect を呼ぶと、その都度レイアウトが強制される */
  let sink = 0;
  const measureSink = () => { sink = SINK_UNITS * (host.getBoundingClientRect().width || 96) / VIEWBOX_W; };

  function draw() {
    const b = knee.value;
    for (const id in JUMP_JOINTS) {
      const j = JUMP_JOINTS[id];
      rotJoint(svg, id, j.rest + (b >= 0 ? j.crouch * b : j.stretch * -b));
    }
    /* 沈みは lift に乗せる。torso を下げると腕は兄弟なので宙に残る */
    const y = Math.min(0, pos.value) + sink * Math.max(0, b);
    lift.style.transform = `translateY(${y.toFixed(2)}px)`;
  }

  function loop(now) {
    if (!alive) return;
    const dt = safeDt((now - (last || now)) / 1000); last = now;
    knee.step(dt);
    if (phase === 'crouch' && knee.value >= LAUNCH_AT) launch();
    if (phase === 'up' || phase === 'down') {
      const v = pos.step(dt);
      if (phase === 'up' && pos.velocity > 0) { phase = 'down'; pos.setTarget(BELOW * H); }  /* 頂点＝速度の反転 */
      if (phase === 'down' && v >= 0) {
        /* ★着地はキーフレームの時刻でなくバネが 0 を横切った瞬間。重い処理で遅れても
           吸収の曲げが空中で起きない */
        phase = 'land'; landed = true; pos.snap(0);
        knee.snap(0.6).setTarget(0);
      }
    }
    draw();
    if (phase === 'land' && knee.isSettled(0.004, 0.02)) {
      knee.snap(0); draw(); lift.style.transform = ''; raf = 0; return;
    }
    raf = requestAnimationFrame(loop);
  }

  function launch() {
    phase = 'up';
    clearTimeout(timer);
    pos.snap(0).setTarget(-H);
    knee.setTarget(-1);
  }

  function kick() {
    const bar = document.getElementById('bar');
    const barH = (bar && bar.offsetHeight) || 64;
    /* 頂点が上部バーの下に潜らないよう、その場の余白で跳ぶ高さを頭打ちにする */
    H = Math.max(MIN_H, Math.min(height, host.getBoundingClientRect().top - barH - 8));
    measureSink();
    phase = 'crouch'; last = 0;
    knee.snap(0).setTarget(1);
    timer = setTimeout(() => { if (alive && phase === 'crouch') launch(); }, SAFETY);
    raf = requestAnimationFrame(loop);
  }

  const io = new IntersectionObserver((entries) => {
    if (fired || !entries.some((e) => e.isIntersecting)) return;
    /* 幕の裏や非表示タブで跳ぶと、出てきたときには終わっている。観測を消費せず張り直す */
    if (document.hidden || document.documentElement.classList.contains('is-veiled')) {
      setTimeout(() => { if (!fired) { io.unobserve(host); io.observe(host); } }, 400);
      return;
    }
    fired = true; io.disconnect(); kick();
    /* ★2026-10-01: 0.9 / -25% から緩めた。-25% は「画面の上から75%の帯に入るまで待つ」
       という意味で、そのぶん余計にスクロールが要っていた（390px幅で実測 scrollY 2060）。
       跳ぶ高さ H は host.top から算出するので、発火が下に寄るほど頭上の余白はむしろ増える。
       つまりこの緩和で跳ねが潰れることはない */
  }, { threshold: 0.8, rootMargin: '0px 0px -12% 0px' });
  io.observe(host);

  return () => { alive = false; io.disconnect(); cancelAnimationFrame(raf); clearTimeout(timer); };
}
