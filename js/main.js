/* =============================================================================
   main.js — 起動と結線
   幕 → 地の映像 → スクロール進捗 → 章の色 → 各UI
   ============================================================================= */

import { mountRigs, attachFace, attachWalker, attachBow, attachPointing } from './mascot.js?v=2026093015';
import { Spring, safeDt } from './lib/spring.js?v=2026093015';
import { reduceMotion, finePointer, track, splitChars, initTabs, initFaq, initGates, initReveal, initCounters, initClips, initMagnets, initTilt, initCursor, initShare, initCtas, initTicketTouch, initProgramAutoOpen, initProgramFolds, initVoiceFolds, initTypewriter } from './ui.js?v=2026093015';

const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s);

const veil = $('#veil');
const video = $('#fvVideo');
const fv = $('#top');
const fvSticky = $('.fv__sticky');
const final = $('#cta-final');
const bar = $('#bar');
const rail = $('#rail');
const sideCta = $('#sideCta');
const foot = $('#foot');
const introHeroEl = $('#introHero');
const purposeEl = $('#purpose');
/* 追従CTA の表示区間の境目。節の上端で切り替える */
const progSfEl  = $('#prog-sf');
const voicesEl  = $('#voices');
const briefEl   = $('#briefing');

/* ------------------------------ 文字の分割（幕の前に） ------------------------------ */
splitChars(fv);

/* ★扉（WebGL・旧「THE DOOR, AGAIN」）は 2026-09-30 に撤去した。
   FV の地は素の縦映像1本になったので、このLPは WebGL を一切使わない。
   js/door.js は削除済み（戻すときは git 履歴から。最後に在るのは 03abd66） */

const band = $('#stageBand');
/* 奥行き（--dz）と2人の濃さ（--people-a）は :root でなく、この3枚に直接書く。
   :root の変数を毎フレーム変えると文書全体のスタイル再計算になる（CPU 4倍抑制で rAF 54→45Hz に落ちた） */
const depthEls = [$('.fv-bg'), ...document.querySelectorAll('.fv-person')].filter(Boolean);
/* 映像の立ち上がり方は updateFixed の中（バネ追従）。濃さは --va、寄りは --vz */

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
  // 導入の章。ほぼ白地だが、最初の問いかけだけ映像の上に置くので暗い扱いにする。
  // ★後にある方が勝つので、内側の #introHero を #intro の後ろに置くこと
  ['#intro', 'light', 'flow'],
  ['#introHero', 'dark', 'flow'],
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
let videoOn = false;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ez = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };

/* ------------------------------ 地の映像（バネ追従） ------------------------------
   ★2026-09-13: 水晶玉をやめた。FV には物体を置かず、スクロールに合わせて
     映像そのものが全画面へ立ち上がる。入れ替わりに地の写真と2人が奥へ引いて薄れる。
   つまみは「何秒で止まるか」と「何%行き過ぎるか」の2つ。距離に依らない。
     --va       映像の濃さ。0 → 1（0.56 で出し切る）
     --vz       映像の寄り。1.08 → 1.00（0.78 でちょうど等倍＝変形なし）
     --people-a 手前の2人。0.40 で消える。映像より後ろの層なので先に消す
     --dz       奥行き（0→1）。地の写真は遠いので小さく寄り、2人は近いので大きく外へ出る
   ★p=0.78 で --va=1 / --vz=1 に着く。ここから先は螺旋の章がこの映像を地に使うので、
     この2つの着地点は動かさないこと（動かすと章の入りが飛ぶ）*/
const SCOPE_FEEL = { settle: 0.42, overshoot: 0.035 };
const SCOPE_LAG = 0.07;          // 指の位置からこれ以上は遅れない（進捗の単位）
const VZ_FROM = 1.08;            // 映像の入りの寄り。等倍へ寄りながら濃くなる
const scopeSpring = Spring.fromFeel(SCOPE_FEEL);
let scopeTarget = 0;
let scopeSeen = false;           // 直前の描画で FV が見えていたか
let scopeInit = false;           // 一度でも書いたか
let scopeAnimating = false;      // 次のフレームも描く必要があるか（バネが動いている）
let scopeLast = 0;

function writeScope(s) {
  scopeInit = true;
  const still = reduceMotion.matches;
  const q = ez(clamp01(s / 0.78));
  /* 濃さ。0.08 から立ち上がり 0.56 で出し切る。
     ★2人と地の写真の引きより少し遅らせてある。同時に動かすと、橋と2人と映像が
       3枚とも半透明で重なる帯が長く、二重写しに見えた */
  band.style.setProperty('--va', ez(clamp01((s - 0.08) / 0.48)).toFixed(3));
  /* 寄り。1.08 から等倍へ。0.78（全画面）でちょうど変形なしに着く */
  band.style.setProperty('--vz', (VZ_FROM - (VZ_FROM - 1) * q).toFixed(4));
  const peopleA = (1 - ez(clamp01((s - 0.05) / 0.35))).toFixed(3);
  const dz = still ? '0' : ez(clamp01(s / 0.70)).toFixed(3);
  for (const el of depthEls) { el.style.setProperty('--people-a', peopleA); el.style.setProperty('--dz', dz); }
}
/* バネを1段進めて描く。updateFixed の「書く」段から毎フレーム呼ぶ */
function stepScope(p, now) {
  const dt = safeDt((now - scopeLast) / 1000);
  scopeSpring.setTarget(p).step(dt);
  // 速いフリックで置いていかれないよう、描く値だけ遅れの上限で挟む（バネの状態は触らない）
  const s = Math.min(p + SCOPE_LAG, Math.max(p - SCOPE_LAG, scopeSpring.value));
  writeScope(s);
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
  // 導入の問いかけは地を敷かず映像の上に出すので、その間も舞台を回したままにする
  let heroVisible = false;
  if (introHeroEl) {
    const hr = introHeroEl.getBoundingClientRect();
    heroVisible = hr.top < vh && hr.bottom > 0;
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
  const videoShow = fvVisible || heroVisible;
  if (videoShow !== videoOn) {
    videoOn = videoShow;
    if (band) band.classList.toggle('is-on', videoShow);
  }
  if (videoShow || finalVisible) playVideo(); else pauseVideo();

  /* ---- 地の映像の明るさ ----
     最初は少し暗く。スクロールが始まるとすぐ明るくなり、螺旋で1枚目のカードが
     出てくるところからまた落とす。カードと文字を前に出すための落とし方なので、
     幕を敷かずに映像そのものの明るさで作る。
     ★呼吸（水晶玉が止まっている間の揺らぎ）はやめたので、ここで書き切る */
  if (band) {
    let vb = 1;
    if (fvVisible) vb = 1.02 + 0.10 * ez(p / 0.18);   // 立ち上がりぎわは少し明るく
    // 問いかけの文字を前に出すため、映像は一段落とす（螺旋のときの進捗連動はやめ、固定値にした）
    if (heroVisible) vb = Math.min(vb, 0.62);
    band.style.setProperty('--vb', vb.toFixed(3));
  }

  /* ---- 地の映像の立ち上がり ----
     スクロールに連れて濃くなりながら等倍へ寄り、全画面になる。
     直接 p を書かず、バネ（settle 0.42s・行き過ぎ 3.5%）に p を目標として渡す。
     指を止めても濃さは少し遅れて追いつく。
     ★FV を抜ける前に必ず全画面へ。p が 0.93 を越えたらバネを使わず直書きし、
       FV が画面から消えた瞬間にも 1 で書き切る（螺旋の章がこの映像を地に使う） */
  scopeAnimating = false;
  if (band) {
    if (fvVisible) {
      scopeTarget = p;
      scopeSeen = true;
      if (reduceMotion.matches || p >= 0.93) { scopeSpring.snap(p); writeScope(p); }
      else {
        stepScope(p, now);
        scopeAnimating = !scopeSpring.isSettled(1e-3, 1e-2);
      }
    } else if (scopeSeen || !scopeInit) {
      // FV を抜けた（または最初から下にいる）。全画面の状態で止める
      scopeSeen = false; scopeTarget = 1;
      scopeSpring.snap(1); writeScope(1);
    }
  }
  scopeLast = now;

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
  /* ★追従CTAは幅57pxで、本文の右端まで 20px しかない（実測で37px被る）。
     出ている間だけ html に印を付け、CSS 側で当たる本文の右余白を広げる */
  document.documentElement.classList.toggle('has-side-cta', sideOn);
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

// タブが隠れたら止める（WebGL の有無に関わらず映像は止める）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pauseVideo(); }
  else { videoOn = false; scopeLast = performance.now(); requestFrame(); }
});

/* ------------------------------------- UI ------------------------------------- */
const cursor = initCursor();
initTabs();
initFaq();
initGates(cursor);
initReveal();
initCounters();
initProgramFolds();
initProgramAutoOpen();
initTicketTouch();
initClips();
/* ★16行。2〜4枚目（200〜230字）は全文が収まり、長い1枚目（約600字）だけが畳まれる。
   結果として札の高さも揃う */
initVoiceFolds({ lines: 16 });
initTypewriter();
initMagnets();
initTilt();
initShare();
initCtas();

/* ★FV の目（#fvEye）は 2026-09-28 にマスコットごと作り替えたときに外した。
   canvas も initEye の呼び出しも無いので、eye.js は読み込まない
   （js/eye.js と CSS の .fv__eye は戻せるように残してある） */

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
