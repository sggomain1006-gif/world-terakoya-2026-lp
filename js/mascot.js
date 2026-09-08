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

import { Spring, expSmooth, safeDt } from './lib/spring.js?v=2026090924';

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

/** 静止ポーズ（リグの静止角からの差分・度） */
function applyPose(svg, pose) {
  const set = (id, deg) => { const el = q(svg, id); if (el) el.style.transform = `rotate(${deg}deg)`; };
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
export function attachFace(host, { reduceMotion = false } = {}) {
  const svg = host.querySelector('svg');
  if (!svg || reduceMotion) return () => {};
  const EL = q(svg, 'eye-left'), ER = q(svg, 'eye-right');
  const PL = q(svg, 'pupil-left'), PR = q(svg, 'pupil-right');
  const F = q(svg, 'face'), M = q(svg, 'mouth');
  if (!EL || !ER || !PL || !PR || !F || !M) return () => {};

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
    ex = halfLife(ex, px * 16, 0.09, h);
    ey = halfLife(ey, py * 12, 0.09, h);
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
  raf = requestAnimationFrame(tick);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
  };
}

// ---------------------------------------------------------------------------
// 歩き: スクロール量で歩く。着地のたびに足あとを置く
// ---------------------------------------------------------------------------
export function attachWalker(host, { column, footprintSrc, reduceMotion = false, maxPrints = 90 } = {}) {
  const svg = host.querySelector('svg');
  if (!svg || !column) return () => {};
  const L = q(svg, 'leg-left'), R = q(svg, 'leg-right');
  const AL = q(svg, 'arm-left'), AR = q(svg, 'arm-right');
  const T = q(svg, 'torso');
  if (!L || !R || !AL || !AR || !T) return () => {};
  // 靴 = 脚グループの最後の子（チューブ → ワイン → クリーム部品の順に描いている）
  const shoeL = L.lastElementChild, shoeR = R.lastElementChild;

  const LEG = 17, ARM = 15, BOB = 6;
  const STRIDE_PX = 96;          // 1 周期（2歩）に要するスクロール量
  let phase = 0;                 // 周期 [0,1)
  let lastY = window.scrollY;
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
    const y = window.scrollY;
    const dy = y - lastY; lastY = y;
    vel = expSmooth(vel, dy / Math.max(dt, 1e-3), 0.08, dt);
    const moving = Math.abs(vel) > 40 ? 1 : 0;
    amp = expSmooth(amp, moving, 0.14, dt);
    // 進んだぶんだけ歩く（戻るときも脚は動くが足あとは置かない）
    if (dy !== 0) phase = ((phase + dy / STRIDE_PX) % 1 + 1) % 1;
    const sw = Math.sin(phase * Math.PI * 2) * amp;
    L.style.transform = `rotate(${LEG * sw}deg)`;
    R.style.transform = `rotate(${-LEG * sw}deg)`;
    AL.style.transform = `rotate(${-ARM * sw}deg)`;
    AR.style.transform = `rotate(${ARM * sw}deg)`;
    const bob = -BOB * Math.abs(Math.cos(phase * Math.PI * 2)) * amp;
    T.style.transform = `rotate(${vel > 0 ? 3 * amp : -2 * amp}deg) translateY(${bob}px)`;

    // 着地 = sin が ±1 の位相（0.25: 右足前, 0.75: 左足前）。前進中のみ置く
    if (dy > 0 && amp > 0.35) {
      const k = Math.floor(phase * 2 - 0.5);
      const landIndex = Math.floor((y + STRIDE_PX * 0.25) / (STRIDE_PX / 2));
      if (landIndex !== lastLand) {
        lastLand = landIndex;
        const r = host.getBoundingClientRect();
        const inView = r.bottom > 0 && r.top < window.innerHeight;
        if (inView) stamp(landIndex % 2 ? shoeL : shoeR, landIndex % 2 ? -1 : 1);
      }
      void k;
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
  raf = requestAnimationFrame(tick);
  return () => { alive = false; if (raf) cancelAnimationFrame(raf); };
}
