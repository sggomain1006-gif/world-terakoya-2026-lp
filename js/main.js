/* =============================================================================
   main.js — 起動と結線
   幕 → 覗き穴 → スクロール進捗 → 章の色 → 各UI
   ============================================================================= */

import { createDoorScene } from './door.js?v=2026090924';
import { mountRigs, attachFace, attachWalker, attachBow, attachPointing } from './mascot.js?v=2026090924';
import { initSpiral } from './spiral.js?v=2026090924';
import { initEye } from './eye.js?v=2026090924';
import {
  reduceMotion, finePointer, track, splitChars, initTabs, initFaq, initGates,
  initReveal, initCounters, initClips, initMagnets, initTilt, initCursor, initShare, initCtas,
  initVoiceSlider, initTicketTouch,
} from './ui.js?v=2026090924';

const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);

const veil = $('#veil');
const canvas = $('#stage');
const video = $('#doorVideo');
const fv = $('#top');
const fvSticky = $('.fv__sticky');
const final = $('#cta-final');
const bar = $('#bar');
const rail = $('#rail');
const sideCta = $('#sideCta');
const foot = $('#foot');
const spiralEl = $('#spiral');
const purposeEl = $('#purpose');

/* ------------------------------ 文字の分割（幕の前に） ------------------------------ */
splitChars(fv);

/* --------------------------- 扉（WebGL・最終CTA だけ） ---------------------------
   FV は CSS の正方形の覗き穴に変えたので、WebGL の扉は最終CTA（THE DOOR, AGAIN）
   でだけ使う。WebGL が無い環境ではその節の扉が出ないだけで、他は何も変わらない */
let scene = null;
try {
  scene = createDoorScene({ canvas, video, poster: 'img/poster-door.webp', reduceMotion: reduceMotion.matches });
} catch (e) {
  console.warn('[door] WebGL を使わない表示に切り替えます:', e && e.message);
  scene = null;
}
if (scene) { root.classList.add('has-gl'); scene.setMode('final'); }

const band = $('#stageBand');
const BAND_R = 799 / 695;   // 曲線の帯の縦横比。ここを崩すと形が変わる
/* 帯の広がり方。近づくほど速く広がる（見かけの大きさは距離に反比例する）。
   2カラムになる幅では本文が左半分に来るので、帯を右へ逃がしてから中央へ戻す */
function drawBand(p, vw, vh) {
  if (!band) return;
  // 最初は画面いっぱいの横幅。縦は素の比より少し詰めた帯にする。
  // 画面が横長だと素の高さが画面を越えて曲線が見えなくなるので、画面高さでも頭を押さえる
  const h0 = Math.min(vw / BAND_R * 0.85, vh * 0.42);
  // 覆いきる高さ。曲線がいちばん下がるのは帯の左端（帯座標で 152.3 / 695 = 0.219）。
  // そこが画面の上へ抜ける条件 (vh-H)/2 + 0.219H ≤ 0 を解くと H ≥ vh/0.5618 になる
  const h1 = vh * 1.80;
  const q = Math.min(1, Math.max(0, p / 0.82));
  const k = 1 / (1 - q * (1 - h0 / h1));   // 近づくほど速く広がる（見かけは距離に反比例）
  band.style.setProperty('--bandW', (vw * k).toFixed(1) + 'px');
  band.style.setProperty('--bandH', (h0 * k).toFixed(1) + 'px');
  // 映像も少しだけ寄せる。帯の広がりに全部合わせると画が破綻するので抑える
  if (video) video.style.setProperty('--vz', (1 + 0.20 * q * q).toFixed(3));
}

/* ---------------------------------- 映像の読み込み ---------------------------------- */
let videoWanted = false;
function loadVideo() {
  if (!video || video.dataset.loaded) return;
  const n = navigator.connection;
  if (n && (n.saveData || /(^|-)2g$/.test(n.effectiveType || ''))) return;   // 節約設定ではポスターで足りる
  video.dataset.loaded = '1';
  const s = document.createElement('source');
  s.type = 'video/mp4'; s.src = video.getAttribute('data-src');
  video.appendChild(s);
  video.preload = 'auto';
  video.load();
}
function playVideo() {
  if (!video || reduceMotion.matches || !videoWanted) return;
  if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
}
function pauseVideo() { if (video && !video.paused) video.pause(); }

/* --------------------------------------- 幕 --------------------------------------- */
const V = window.__veil || { t0: Date.now(), MIN: 500, MAX: 1900, release() {} };
let opened = false;
function openVeil() {
  if (opened) return;
  opened = true;
  const wait = Math.max(0, V.MIN - (Date.now() - V.t0));
  setTimeout(() => {
    if (veil) veil.classList.add('is-out');
    root.classList.remove('is-veiled');
    V.release();
    videoWanted = true;
    playVideo();
    if (scene) scene.intro();
    setTimeout(() => fv && fv.classList.add('is-in'), 120);
    if (sideCta) setTimeout(() => updateFixed(), 900);
    if (V.deepLink) {
      const go = () => { const t = $(location.hash); if (t) t.scrollIntoView({ behavior: 'auto', block: 'start' }); };
      go(); setTimeout(go, 600);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(go);
    }
    track('lp_open', {});
  }, wait);
}
setTimeout(openVeil, V.MAX);
if (video) {
  video.addEventListener('canplay', openVeil, { once: true });
  video.addEventListener('error', openVeil, { once: true });
  loadVideo();
} else openVeil();

/* ---------------------------- スクロール: 進捗・章の色・レール ---------------------------- */
const THEMES = [
  ['#top', 'dark', 'top'],
  ['#spiral', 'dark', 'flow'],
  ['#purpose', 'light', 'flow'],
  // 3つのプログラムの一覧は白い章の中にある。レールの「3つの派遣」はここで光る
  ['#dispatch', 'light', 'dispatch'],
  ['#who', 'light', 'who'],
  ['#voices', 'dark', 'who'],
  // 代表メッセージは白地。ここを入れておかないと、どの章にも当たらず既定の dark に落ちる
  ['#founder', 'light', 'who'],
  ['#trust', 'light', 'fee'],
  ['#briefing', 'dark', 'briefing'],
  ['#faq', 'light', 'faq'],
  ['#cta-final', 'dark', 'faq'],
  ['#foot', 'dark', 'faq'],
].map(([sel, theme, railId]) => ({ el: $(sel), theme, railId })).filter((t) => t.el);
const railLinks = rail ? Array.from(rail.querySelectorAll('[data-rail]')) : [];

let ticking = false;
let lastTheme = '';
let lastRail = '';
let stageOn = false;
let videoOn = false;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function updateFixed() {
  const vh = window.innerHeight;
  // ---- FV 進捗 ----
  let p = 0;
  if (fv) {
    const r = fv.getBoundingClientRect();
    const span = r.height - vh;
    p = span > 2 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
    const fp = Math.min(1, Math.max(0, (p - 0.02) / 0.28));
    fv.style.setProperty('--fp', fp.toFixed(3));
    fv.classList.toggle('is-through', p > 0.78);
    // 透明になったリンクは押せてしまうので、消えたら当たり判定も外す
    fv.classList.toggle('is-dim', fp >= 0.32);
  }
  const fvVisible = fv ? fv.getBoundingClientRect().bottom > 0 : false;
  const finalVisible = final ? (final.getBoundingClientRect().top < vh && final.getBoundingClientRect().bottom > 0) : false;
  // 螺旋の章は地を透かして映像を見せるので、その間も舞台を回したままにする
  const spiralVisible = spiralEl && spiralEl.classList.contains('is-3d')
    ? (spiralEl.getBoundingClientRect().top < vh && spiralEl.getBoundingClientRect().bottom > 0)
    : false;

  // ---- 曲線の帯 ----
  if (fvVisible) drawBand(p, window.innerWidth, vh);

  // ---- 地の映像（FV と螺旋で見せる。最終CTAでは扉のテクスチャとして要る）----
  const videoShow = fvVisible || spiralVisible;
  if (videoShow !== videoOn) {
    videoOn = videoShow;
    if (band) band.classList.toggle('is-on', videoShow);
  }
  if (videoShow || finalVisible) playVideo(); else pauseVideo();

  /* ---- 地の映像の明るさ ----
     最初は少し暗く。スクロールが始まるとすぐ明るくなり、螺旋で1枚目のカードが
     出てくるところからまた落とす。カードと文字を前に出すための落とし方なので、
     幕を敷かずに映像そのものの明るさで作る */
  if (band) {
    const ease = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };
    let vb = 1;
    if (fvVisible) vb = 0.72 + 0.28 * ease(p / 0.18);
    if (spiralVisible && spiralEl) {
      const sr = spiralEl.getBoundingClientRect();
      const tr = spiralEl.querySelector('.spiral__track');
      const span = (tr ? tr.offsetHeight : sr.height) - vh;
      const sp = span > 2 ? clamp01(-sr.top / span) : 0;
      vb = Math.min(vb, 1 - 0.38 * ease(sp / 0.06));
    }
    band.style.setProperty('--vb', vb.toFixed(3));
  }

  // ---- 舞台（最終CTAの扉だけ）----
  if (scene && finalVisible !== stageOn) {
    stageOn = finalVisible;
    canvas.classList.toggle('is-on', finalVisible);
    if (finalVisible) scene.start(); else scene.stop();
  }

  // ---- 章の色（上部バーの真下に何があるか） ----
  const probeY = (bar ? bar.offsetHeight : 64) * 0.5;
  let theme = 'dark', railId = 'top';
  for (const t of THEMES) {
    const r = t.el.getBoundingClientRect();
    if (r.top <= probeY && r.bottom > probeY) { theme = t.theme; railId = t.railId; }
  }
  // レール: 画面の 40% 位置にある章
  const probe2 = vh * 0.4;
  for (const t of THEMES) {
    const r = t.el.getBoundingClientRect();
    if (r.top <= probe2 && r.bottom > probe2) railId = t.railId;
  }
  if (theme !== lastTheme) {
    lastTheme = theme;
    if (bar) bar.classList.toggle('is-light', theme === 'light');
    if (rail) rail.classList.toggle('is-light', theme === 'light');
  }
  if (railId !== lastRail) {
    lastRail = railId;
    railLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('data-rail') === railId));
  }
  // ---- 通り抜けの間はバーとレールを引っ込める ----
  const through = fvVisible && p > 0.3 && p < 0.97;
  if (bar) bar.classList.toggle('is-hidden', through);
  if (rail) rail.classList.toggle('is-hidden', through || finalVisible);

  // ---- 追従CTA（右端）: 幕が開いてから、最終CTA が画面の上まで来るまで ----
  //  交差監視で「最終CTA が見えているか」を見ると、通り過ぎてフッターまで来たときに
  //  「見えていない」に戻って再表示されてしまう。位置で判定する。
  if (sideCta) {
    const footVisible = foot ? foot.getBoundingClientRect().top < vh : false;
    // 白い章（グローバル探究）に届くまでは出さない。それより前は FV と螺旋で、
    // 追従ボタンが映像とカードの上に重なってしまう
    const reached = purposeEl ? purposeEl.getBoundingClientRect().top <= vh * 0.6 : true;
    const on = opened && reached && !finalVisible && !footVisible && !through && !overlapsProtected();
    sideCta.classList.toggle('is-on', on);
  }
}
/* 右端で追従CTAに隠されると困るもの。CTA の縦の帯にかかる間だけ引っ込める。
     .tbl      … 隠れると金額が読めなくなる
     .ticket__date … 説明会の日付。右端に大きく出るので CTA の真下に入る
     .faq__q i … 開閉の記号。右端にあるので CTA の真下に入る
     .endorsements__names / .endorsement-logo / .media-logo
               … 後援とメディアのロゴと団体名。右端まで並ぶので CTA に隠れる
     .purpose__lead / .purpose__note / .purpose__h--next / .purpose__guide / .plist
     .founder-card__meta / .founder-card__message … 代表メッセージ。SP は全幅に流れる
               … 白い章の本文・袋文字・案内のキャラクター。画面の端まで届くので CTA に食われる
     .scr__detail … 3つのプログラムの読み物（日程・宿泊・行程・発着・担当者）。舞台では
               右の柱／下の欄に出るので、画面の端まで届く */
let protectedEls = [];
function collectProtected() {
  protectedEls = Array.prototype.slice.call(document.querySelectorAll('.ticket, .sched-note, .schol, .ch--voices .wrap, .faq__q i, .endorsements__names, .endorsement-logo, .media-logo, .purpose__lead, .purpose__note, .purpose__h--next, .purpose__guide, .plist, .founder-card__meta, .founder-card__message, .scr__detail'));
}
function overlapsProtected() {
  if (!sideCta) return false;
  if (!protectedEls.length) collectProtected();
  if (!protectedEls.length) return false;
  const box = sideCta.getBoundingClientRect();
  /* 隠れている間は画面外にあるので、出したときの縦位置を計算で出す */
  const mid = window.innerHeight * 0.62;
  const half = (box.height || 158) / 2;
  const top = mid - half, bottom = mid + half;
  for (let i = 0; i < protectedEls.length; i++) {
    const el = protectedEls[i];
    if (!el.offsetParent && el.offsetWidth === 0) continue;   // 閉じたタブの中は無視
    const r = el.getBoundingClientRect();
    if (r.width < 1) continue;
    if (r.bottom > top && r.top < bottom) return true;
  }
  return false;
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; updateFixed(); });
}
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);
updateFixed();

/* --------------------------------- ポインタ → 扉 --------------------------------- */
if (scene) {
  window.addEventListener('pointermove', (e) => {
    scene.setPointer(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight * 2 - 1), true);
  }, { passive: true });
  document.addEventListener('pointerleave', () => scene.setPointer(0, 0, false));
}
// タブが隠れたら止める（WebGL の有無に関わらず映像は止める）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (scene) scene.stop(); pauseVideo(); }
  else { stageOn = false; videoOn = false; updateFixed(); }
});

/* ------------------------------------- UI ------------------------------------- */
const cursor = initCursor();
initTabs();
initFaq();
initGates(cursor);
initReveal();
initCounters();
initVoiceSlider();
initTicketTouch();
const spiral = initSpiral({ reduceMotion: reduceMotion.matches });
initClips({ skip: spiral ? '#spiral' : null });
initMagnets();
initTilt();
initShare();
initCtas();

/* ------------------------------------ FV の目 ------------------------------------ */
// ポートフォリオから移植。WebGL2 が無ければ null が返るだけで、他には影響しない
try { initEye({ canvas: $('#fvEye'), reduceMotion: reduceMotion.matches }); }
catch (e) { console.warn('[eye]', e && e.message); }

/* ----------------------------------- マスコット ----------------------------------- */
mountRigs().then((hosts) => {
  hosts.forEach((host) => {
    if (host.classList.contains('rig--face')) attachFace(host, { reduceMotion: reduceMotion.matches });
    if (host.classList.contains('rig--walk')) {
      attachWalker(host, {
        column: host.closest('.spiral__ground') || $('#trailCol'),
        footprintSrc: 'assets/mascot/footprint.svg',
        reduceMotion: reduceMotion.matches,
        maxPrints: 26,
      });
    }
    if (host.classList.contains('rig--point')) attachPointing(host, { reduceMotion: reduceMotion.matches });
    if (host.classList.contains('rig--bow')) attachBow(host, { reduceMotion: reduceMotion.matches });
  });
}).catch((e) => console.warn('[mascot]', e));

/* ------------------------------- セクション到達の計測 ------------------------------- */
if ('IntersectionObserver' in window) {
  const seen = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting || seen.has(en.target.id)) return;
      seen.add(en.target.id);
      track(en.target.id === 'fee' ? 'fee_section_view' : 'section_view', { section: en.target.id });
    });
  }, { threshold: 0, rootMargin: '0px 0px -25% 0px' });
  ['flow', 'purpose', 'dispatch', 'who', 'fee', 'trust', 'briefing', 'faq', 'cta-final', 'foot'].forEach((id) => {
    const el = document.getElementById(id); if (el) io.observe(el);
  });
}

void finePointer;
