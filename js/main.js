/* =============================================================================
   main.js — 起動と結線
   幕 → 覗き穴 → スクロール進捗 → 章の色 → 各UI
   ============================================================================= */

import { createDoorScene } from './door.js?v=2026091198';
import { mountRigs, attachFace, attachWalker, attachBow, attachPointing } from './mascot.js?v=2026091198';
import { initSpiral } from './spiral.js?v=2026091198';
import { initEye } from './eye.js?v=2026091198';
import { Spring, safeDt } from './lib/spring.js?v=2026091198';
import {
  reduceMotion, finePointer, track, splitChars, initTabs, initFaq, initGates,
  initReveal, initCounters, initClips, initMagnets, initTilt, initCursor, initShare, initCtas,
  initVoiceGallery, initTicketTouch, initProgramAutoOpen, initProgramFolds,
} from './ui.js?v=2026091198';

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
/* 追従CTA の表示区間の境目。節の上端で切り替える */
const progSfEl  = $('#prog-sf');
const voicesEl  = $('#voices');
const briefEl   = $('#briefing');

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
/* 樽型の歪み。--lens-k は ball_css.py が CSS に出した「変位マップの最大変位（半径比）」。
   feDisplacementMap の scale は user space の px なので、球の直径に比例して毎フレーム組み立てる */
const lensNode = document.querySelector('#ballLens feDisplacementMap');
const LENS_K = band ? parseFloat(getComputedStyle(band).getPropertyValue('--lens-k')) || 0 : 0;
let lensScale = -1, lensOn = false;
/* 奥行き（--dz）と2人の濃さ（--people-a）は :root でなく、この3枚に直接書く。
   :root の変数を毎フレーム変えると文書全体のスタイル再計算になる（CPU 4倍抑制で rAF 54→45Hz に落ちた） */
const depthEls = [$('.fv-bg'), ...document.querySelectorAll('.fv-person')].filter(Boolean);
/* 覗き穴の広がり方は updateFixed の中（バネ追従）。大きさは CSS の --scope-d、ぼけは --fog */

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
    if (sideCta) setTimeout(requestFrame, 900);
    requestFrame();
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

let lastTheme = '';
let lastRail = '';
let stageOn = false;
let videoOn = false;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ez = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };

/* ------------------------------ 覗き穴（バネ追従） ------------------------------
   つまみは「何秒で止まるか」と「何%行き過ぎるか」の2つ。距離に依らない。
     --scope-d  直径。初期は画面幅の52%、最後は画面の対角より少し大きく
     bottom     円の中心の高さ。2人の顔の中点 → 画面の中央
     --fog      覗いている像のぼけ。3px → 0。速く送るとそのぶん流れる（最大+1.6px）
     --mask-s   縁が溶ける帯の大きさ。100% だと縁が円の中、340% 足すと外へ出る
     --rim-a    縁の暗がり・黒枠・ガラスの照り返し。広がるにつれて消す
     --people-a 手前の2人。円より前の層なので、消さないと映像の上に残る
     --dz       奥行き（0→1）。橋は遠く小さく動き、2人は近く大きく外へ動く
     --vz       映像の寄り。1.30 → 1（ボールレンズの拡大が解けていく）。止まっている間は呼吸で±1%
     --vr       映像の向き。180deg → 0deg。水晶の中は実像で逆さ。0.68 で戻し切る
     （歪み）   樽型。#ballLens の scale を直径に比例させる。0.55 で抜けフィルタごと外す
     --ca       速さで出る縁の色ずれ（0→1）
     --glow     穴から漏れる光。中盤だけ */
const SCOPE_FEEL = { settle: 0.42, overshoot: 0.035 };
const SCOPE_LAG = 0.07;          // 指の位置からこれ以上は遅れない（進捗の単位）
const SCOPE_SPEED_FULL = 2.2;    // この速さ（進捗/秒）で流れの効果が頭打ち
const BREATH_PERIOD = 5.5;       // 呼吸の周期（秒）
const scopeSpring = Spring.fromFeel(SCOPE_FEEL);
let scopeTarget = 0;
let scopeSeen = false;           // 直前の描画で FV が見えていたか
let scopeInit = false;           // 一度でも書いたか
let scopeAnimating = false;      // 次のフレームも描く必要があるか（バネが動いている／呼吸中）
let scopeLast = 0;
const scopeT0 = performance.now();
let vbBase = 1;                  // 映像の明るさ（呼吸を掛ける前）

function writeScope(s, vel, now) {
  scopeInit = true;
  const vw = window.innerWidth, vh = window.innerHeight;
  const wide = vw >= 768;
  const still = reduceMotion.matches;
  const q = ez(clamp01(s / 0.78));
  /* SP は2人の手のあいだに収める大きさ。肌色の無い帯を画素で実測して 21.00〜31.75vw、
     すき間 10.75vw。上下に 0.8vw ずつ余白を残して直径 9.1vw、中心は床から 26.38vw */
  const d0 = wide ? Math.min(vw * 0.34, 520) : vw * 0.091;
  const d1 = Math.hypot(vw, vh) * 1.06;
  const scopeD = d0 + (d1 - d0) * Math.pow(q, 1.5);
  band.style.setProperty('--scope-d', scopeD.toFixed(1) + 'px');
  /* ★SP の初期の高さは「2人の顔の中点」。CSS の .fv-scope の bottom と同じ値を持つ。
     素材を差し替えたら css/fv.css の式で出し直して両方そろえること（ここだけ直すと
     読み込み直後の1フレームがずれる。CSSだけ直すと JS に上書きされて効かない）*/
  /* 玉は女子の切れ目から 26.38vw 上。切れ目は syncFvCut と同じ式で出す（css/fv.css の --fv-cut）*/
  const cut = Math.max(vw * 2.1674, vh) * 0.765 - vw * 0.138;
  const b0 = wide ? vh / 2 : vh - (cut - vw * 0.2638);
  band.style.bottom = (b0 + (vh / 2 - b0) * q).toFixed(1) + 'px';
  // 速さ。バネの速度は進捗/秒。全画面に近いほど効かせない
  const speed = still ? 0 : Math.min(1, Math.abs(vel) / SCOPE_SPEED_FULL) * (1 - q);
  /* ぼけも直径に比例させる。px 固定だと小さいときに玉が真っ白に溶ける
     （直径 203px のとき 1.1px / 速さの分 1.6px だった比率をそのまま使う）*/
  const fogK = scopeD / 203;
  const fog = fogK * (1.1 * (1 - ez(clamp01(s / 0.52))) + 1.6 * speed);
  band.style.setProperty('--fog', fog.toFixed(2) + 'px');
  band.style.setProperty('--mask-s', (100 + 340 * ez(clamp01((s - 0.20) / 0.56))).toFixed(0) + '%');
  const rim = 1 - ez(clamp01((s - 0.18) / 0.55));
  band.style.setProperty('--rim-a', rim.toFixed(3));
  band.style.setProperty('--ca', (speed * rim).toFixed(3));
  // 穴から漏れる光。s=0.05 から立ち上がり 0.38 で最大、0.72 で消える
  const glow = ez(clamp01((s - 0.05) / 0.33)) * (1 - ez(clamp01((s - 0.42) / 0.30)));
  band.style.setProperty('--glow', glow.toFixed(3));
  const peopleA = (1 - ez(clamp01((s - 0.30) / 0.36))).toFixed(3);
  const dz = still ? '0' : ez(clamp01(s / 0.70)).toFixed(3);
  for (const el of depthEls) { el.style.setProperty('--people-a', peopleA); el.style.setProperty('--dz', dz); }
  // 呼吸。止まっている間だけ分かる程度。全画面では止める
  const t = (now - scopeT0) / 1000;
  const breath = still ? 0 : Math.sin(t * 2 * Math.PI / BREATH_PERIOD) * (1 - q);
  const vz = (1.30 - 0.30 * q) * (1 + 0.010 * breath);
  band.style.setProperty('--vz', vz.toFixed(4));
  /* 中の像の向き。ボールレンズの実像は上下左右とも反転する（＝180°回転）ので、
     止まっている水晶の中は逆さに見える。広がるにつれて半回転して本来の向きへ戻す。
     ★0.68 で戻し切る。全画面（0.78）に着いてから回すと画面全体が回って酔うため。
     動きを減らす設定では回さない（逆さのまま置かず 0 にする）*/
  band.style.setProperty('--vr', (still ? 0 : 180 * (1 - ez(clamp01((s - 0.04) / 0.64)))).toFixed(2) + 'deg');
  /* 樽型の歪みの強さ。0.55 で抜け切る（そこから先は球でなく「広がる映像」なので歪ませない）。
     属性の書き換えはフィルタの作り直しを起こすので、0.15px 以上変わったときだけ書く */
  if (lensNode && video) {
    const ls = still ? 0 : LENS_K * scopeD * (1 - ez(clamp01(s / 0.55)));
    if (Math.abs(ls - lensScale) > 0.15) { lensNode.setAttribute('scale', ls.toFixed(2)); lensScale = ls; }
    const on = ls > 0.3;
    if (on !== lensOn) { video.classList.toggle('is-lens', on); lensOn = on; }
  }
  band.style.setProperty('--vb', (vbBase * (1 + 0.025 * Math.sin(t * 2 * Math.PI / BREATH_PERIOD + 0.9) * (1 - q))).toFixed(3));
}
/* バネを1段進めて描く。updateFixed の「書く」段から毎フレーム呼ぶ */
function stepScope(p, now) {
  const dt = safeDt((now - scopeLast) / 1000);
  scopeSpring.setTarget(p).step(dt);
  // 速いフリックで置いていかれないよう、描く値だけ遅れの上限で挟む（バネの状態は触らない）
  const s = Math.min(p + SCOPE_LAG, Math.max(p - SCOPE_LAG, scopeSpring.value));
  writeScope(s, scopeSpring.velocity, now);
}

function updateFixed(now = performance.now()) {
  const vh = window.innerHeight;
  /* ===== 読む（測る）。書く前に全部済ませる。
     書いたあとに getBoundingClientRect を呼ぶと、そのたびにスタイルの再計算が強制される ===== */
  let p = 0, fvVisible = false;
  if (fv) {
    const r = fv.getBoundingClientRect();
    const span = r.height - vh;
    p = span > 2 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
    fvVisible = r.bottom > 0;
  }
  let finalVisible = false;
  if (final) { const r = final.getBoundingClientRect(); finalVisible = r.top < vh && r.bottom > 0; }
  // 螺旋の章は地を透かして映像を見せるので、その間も舞台を回したままにする
  let spiralVisible = false, sp = 0;
  if (spiralEl && spiralEl.classList.contains('is-3d')) {
    const sr = spiralEl.getBoundingClientRect();
    spiralVisible = sr.top < vh && sr.bottom > 0;
    if (spiralVisible) {
      const tr = spiralEl.querySelector('.spiral__track');
      const span = (tr ? tr.offsetHeight : sr.height) - vh;
      sp = span > 2 ? clamp01(-sr.top / span) : 0;
    }
  }
  // 章の色（上部バーの真下に何があるか）と、レール（画面の 40% 位置にある章）
  const probeY = (bar ? bar.offsetHeight : 64) * 0.5;
  const probe2 = vh * 0.4;
  let theme = 'dark', railId = 'top', railId2 = '';
  for (const t of THEMES) {
    const r = t.el.getBoundingClientRect();
    if (r.top <= probeY && r.bottom > probeY) { theme = t.theme; railId = t.railId; }
    if (r.top <= probe2 && r.bottom > probe2) railId2 = t.railId;
  }
  if (railId2) railId = railId2;
  // 通り抜けの間はバーとレールを引っ込める
  const through = fvVisible && p > 0.3 && p < 0.97;
  /* 追従CTA（右端）の出し入れ。★2026-09-11 に「重なりそうな要素を列挙して避ける」方式をやめた。
     要素が増えるたびに当たり判定が変わり、出たり消えたりが読めなくなっていた
     （実際 .faq__q i というセレクタが実物と違っていて、FAQ では一度も避けていなかった）。
     いまは節の上端だけで2区間を決め打ちする。判定の線は画面の 62%（ボタンの中心の高さ）。
       区間A: グローバル探究の節 〜 サンフランシスコの折りたたみ
       区間B: 数字と参加者の声の節 〜 まずはオンライン説明会への節 */
  const refY = vh * 0.62;
  const entered = (el) => (el ? el.getBoundingClientRect().top <= refY : false);
  const sideOn = !!sideCta && opened && !through
    && ((entered(purposeEl) && !entered(progSfEl)) || (entered(voicesEl) && !entered(briefEl)));

  /* ===== 書く ===== */
  if (fv) {
    const fp = Math.min(1, Math.max(0, (p - 0.02) / 0.28));
    fv.style.setProperty('--fp', fp.toFixed(3));
    fv.classList.toggle('is-through', p > 0.78);
    // 透明になったリンクは押せてしまうので、消えたら当たり判定も外す
    fv.classList.toggle('is-dim', fp >= 0.32);
  }

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
     幕を敷かずに映像そのものの明るさで作る。
     FV の間は writeScope が呼吸を掛けて --vb を書くので、ここでは基準値だけ持つ */
  if (band) {
    let vb = 1;
    if (fvVisible) vb = 1.02 + 0.10 * ez(p / 0.18);   // 覗き穴の中は明るく見せる
    if (spiralVisible) vb = Math.min(vb, 1 - 0.38 * ez(sp / 0.06));
    vbBase = vb;
    if (!fvVisible) band.style.setProperty('--vb', vb.toFixed(3));
  }

  /* ---- 覗き穴の動き ----
     スクロールに連れて、少し上がりながら大きくなり、曇りが取れて全画面になる。
     直接 p を書かず、バネ（settle 0.42s・行き過ぎ 3.5%）に p を目標として渡す。
     指を止めても円は少し遅れて止まり、速く送れば速さのぶんだけ像が流れる。
     ★FV を抜ける前に必ず全画面へ。p が 0.93 を越えたらバネを使わず直書きし、
       FV が画面から消えた瞬間にも 1 で書き切る（螺旋の章がこの映像を地に使う） */
  scopeAnimating = false;
  if (band) {
    if (fvVisible) {
      scopeTarget = p;
      scopeSeen = true;
      if (reduceMotion.matches || p >= 0.93) { scopeSpring.snap(p); writeScope(p, 0, now); }
      else {
        stepScope(p, now);
        // バネが動いている間、または止まって呼吸している間（全画面になるまで）は次のフレームも描く
        scopeAnimating = !scopeSpring.isSettled(1e-3, 1e-2) || (!document.hidden && p < 0.78);
      }
    } else if (scopeSeen || !scopeInit) {
      // FV を抜けた（または最初から下にいる）。全画面の状態で止める
      scopeSeen = false; scopeTarget = 1;
      scopeSpring.snap(1); writeScope(1, 0, now);
    }
  }
  scopeLast = now;

  // ---- 舞台（最終CTAの扉だけ）----
  if (scene && finalVisible !== stageOn) {
    stageOn = finalVisible;
    canvas.classList.toggle('is-on', finalVisible);
    if (finalVisible) scene.start(); else scene.stop();
  }

  // ---- 章の色・レール ----
  if (theme !== lastTheme) {
    lastTheme = theme;
    if (bar) bar.classList.toggle('is-light', theme === 'light');
    if (rail) rail.classList.toggle('is-light', theme === 'light');
  }
  if (railId !== lastRail) {
    lastRail = railId;
    railLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('data-rail') === railId));
  }
  if (bar) bar.classList.toggle('is-hidden', through);
  if (rail) rail.classList.toggle('is-hidden', through || finalVisible);
  if (sideCta) sideCta.classList.toggle('is-on', sideOn);
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

/* 1フレームに updateFixed を1回だけ。scroll/resize も、バネの続きも、同じ入口を通す。
   （scroll の rAF とバネの rAF を別々に持つと、書いた直後に測る形になって
     スタイル再計算が毎フレーム2回走る） */
let frameQueued = false;
function frame(now) {
  frameQueued = false;
  updateFixed(now);
  if (scopeAnimating) requestFrame();
}
function requestFrame() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(frame);
}
window.addEventListener('scroll', requestFrame, { passive: true });
/* ------------------------- FV の切れ目を橋の車道に合わせる -------------------------
   地の写真は 1290x2796 で、幅に合わせると高さは 216.74vw。車道は画像の 76.5% の位置。
   ★画面が 216.74vw より縦に長い機種（Pixel 7/8/9 など）では min-height:100% と cover で
     写真が引き伸ばされ、車道だけが下がる。実測で SE/iPhone14 が 165.8vw、Pixel 9 が 171.8vw。
     切れ目を固定値にしていると、その機種でだけ道より上に外れる。
   道から 13.8vw 上（SE で見え方が決まった値）を切れ目にして、CSS へ px で渡す */
const FV_IMG_RATIO = 2796 / 1290;   // 地の写真の縦横比
const FV_ROAD = 0.765;              // 画像の上から車道までの割合
const FV_ABOVE_ROAD = 0.138;        // 切れ目を道より上に置く量（画面幅に対する比）
function syncFvCut() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const imgH = Math.max(vw * FV_IMG_RATIO, vh);
  const cut = imgH * FV_ROAD - vw * FV_ABOVE_ROAD;
  document.documentElement.style.setProperty('--fv-cut', cut.toFixed(1) + 'px');
}
syncFvCut();
window.addEventListener('resize', syncFvCut, { passive: true });
window.addEventListener('orientationchange', syncFvCut, { passive: true });

window.addEventListener('resize', requestFrame);
updateFixed();
if (scopeAnimating) requestFrame();

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
  else { stageOn = false; videoOn = false; scopeLast = performance.now(); requestFrame(); }
});

/* ------------------------------------- UI ------------------------------------- */
const cursor = initCursor();
initTabs();
initFaq();
initGates(cursor);
initReveal();
initCounters();
initVoiceGallery();
initProgramFolds();
initProgramAutoOpen();
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
        strideX: 56,   // 1周期(2歩)で横に進む距離。背丈 84px に合わせた歩幅
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
