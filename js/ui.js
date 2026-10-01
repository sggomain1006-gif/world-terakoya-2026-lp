/* =============================================================================
   ui.js — DOM 側の振る舞い
   タブ / 開閉（FAQ・扉カード）/ 出現 / 数字のカウント / 動画の遅延再生 /
   マグネットボタン / チケットの傾き / カーソル / 共有 / 計測
   ============================================================================= */

import { Spring, expSmooth, safeDt } from './lib/spring.js?v=2026100188';

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

/* ------------------------------------ 計測 ------------------------------------ */
let currentPersona = 'student';
export function track(event, params) {
  const payload = { event, current_tab: currentPersona, ...(params || {}) };
  try { window.dataLayer.push(payload); } catch (e) { /* 計測でUIを止めない */ }
}

/* ----------------------------------- 文字の分割 ---------------------------------- */
export function splitChars(root = document) {
  root.querySelectorAll('[data-split]').forEach((el) => {
    const text = el.textContent;
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const ch of text) {
      const w = document.createElement('span');
      w.className = 'ch-w';
      const c = document.createElement('span');
      c.className = 'ch-c';
      c.textContent = ch === ' ' ? ' ' : ch;
      c.style.transitionDelay = (i * 0.028) + 's';
      w.appendChild(c);
      frag.appendChild(w);
      i++;
    }
    el.textContent = '';
    el.appendChild(frag);
    el.setAttribute('aria-label', text);
  });
}

/* ------------------------------------- タブ ------------------------------------ */
/* ★initTabs（高校生／大学生のタブ）は 2026-09-30 に廃止。
   残るのが大学生・社会人の1本になり、選ばせる仕掛けが要らなくなった */


/* ------------------------------ 開閉（FAQ・扉カード） ------------------------------ */
function setOpen(container, body, button, on, cls = 'is-open') {
  button.setAttribute('aria-expanded', on ? 'true' : 'false');
  if (on) {
    body.hidden = false;
    // display が戻ってから次のフレームで開く（でないと transition が走らない）
    requestAnimationFrame(() => requestAnimationFrame(() => container.classList.add(cls)));
  } else {
    container.classList.remove(cls);
    const done = () => { if (!container.classList.contains(cls)) body.hidden = true; };
    if (reduceMotion.matches) done();
    else {
      let fired = false;
      const onEnd = (e) => { if (e.target !== body || fired) return; fired = true; body.removeEventListener('transitionend', onEnd); done(); };
      body.addEventListener('transitionend', onEnd);
      setTimeout(() => { if (!fired) { fired = true; body.removeEventListener('transitionend', onEnd); done(); } }, 900);
    }
  }
}

export function initFaq() {
  document.querySelectorAll('.faq__item').forEach((item) => {
    const btn = item.querySelector('.faq__q');
    const body = item.querySelector('.faq__a');
    if (!btn || !body) return;
    const initiallyOpen = btn.getAttribute('aria-expanded') === 'true';
    if (initiallyOpen) { body.hidden = false; item.classList.add('is-open'); }
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-expanded') !== 'true';
      setOpen(item, body, btn, on);
      if (on) track('faq_open', { id: body.id });
    });
  });
}

export function initGates(cursor) {
  document.querySelectorAll('.gate').forEach((gate) => {
    const btn = gate.querySelector('[data-gate]');
    const body = gate.querySelector('.gate__body');
    if (!btn || !body) return;
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-expanded') !== 'true';
      setOpen(gate, body, btn, on);
      btn.querySelector('.gate__open').textContent = on ? 'CLOSE' : 'OPEN';
      if (cursor) cursor.setLabel(on ? 'CLOSE' : 'OPEN');
      if (on) track('dispatch_open', { id: gate.id });
    });
  });
}

/* --------------------------------- 出現（IO） --------------------------------- */
export function initReveal() {
  const targets = () => Array.from(document.querySelectorAll('[data-reveal]:not(.is-in), .ph:not(.is-in)'));
  if (!('IntersectionObserver' in window) || reduceMotion.matches) {
    targets().forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    // 同じ親の中で同時に入ったものは少しずつずらす
    const byParent = new Map();
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const key = en.target.parentElement;
      const n = byParent.get(key) || 0;
      byParent.set(key, n + 1);
      const el = en.target;
      el.style.transitionDelay = (n * 0.09) + 's';
      el.classList.add('is-in');
      io.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  const observe = () => targets().forEach((el) => io.observe(el));
  observe();
  document.addEventListener('lp:panelchange', observe);
  // 保険: 高速スクロールで観測をまたいだ要素を無条件で出す
  let sweeping = false;
  function sweep() {
    sweeping = false;
    targets().forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.98 && r.bottom > 0 && r.width > 0) { el.classList.add('is-in'); io.unobserve(el); }
    });
  }
  const queue = () => { if (!sweeping) { sweeping = true; requestAnimationFrame(sweep); } };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  window.addEventListener('load', () => setTimeout(queue, 300));
}

/* ------------------------------- 数字のカウント ------------------------------- */
export function initCounters() {
  const els = Array.from(document.querySelectorAll('[data-count]'));
  if (!els.length) return;
  const run = (el) => {
    const to = parseFloat(el.getAttribute('data-count'));
    const dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
    // 円グラフの弧も同じ数え上げに乗せる。--pct は親の li が持っている
    const dial = el.closest('.dial');
    const pct = dial ? parseFloat(dial.dataset.pct) : NaN;
    const setPct = (v) => { if (dial && Number.isFinite(pct)) dial.style.setProperty('--pct', v.toFixed(2)); };
    if (reduceMotion.matches || !Number.isFinite(to)) {
      el.textContent = to.toFixed(dec); setPct(pct || 0); return;
    }
    setPct(0);
    const t0 = performance.now(), dur = 1400;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = (to * e).toFixed(dec);
      setPct((pct || 0) * e);
      if (t < 1) requestAnimationFrame(step);
      else { el.textContent = to.toFixed(dec); setPct(pct || 0); }
    };
    requestAnimationFrame(step);
  };
  /* JS が無いときのために HTML には実値を書いてある。動かせる環境では
     観測前に 0 へ戻しておく（先に実値が見えてから 0 に飛ぶのを防ぐ） */
  if (!reduceMotion.matches) {
    els.forEach((el) => {
      const dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
      el.textContent = (0).toFixed(dec);
      const d = el.closest('.dial');
      if (d) d.style.setProperty('--pct', '0');
    });
  }
  /* ★参加者の声の数字は4つが同じマスに重なっているので、交差監視だと一度に4つとも
     走ってしまう（3つは見えないまま数え終わる）。data-count-defer の中は監視から外し、
     表に出た最初の一度だけ外から呼べるようにする */
  els.forEach((el) => { el.runCount = () => run(el); });
  const deferred = (el) => !!el.closest('[data-count-defer]');
  if (!('IntersectionObserver' in window)) { els.forEach(run); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } });
  }, { threshold: 0.6 });
  els.forEach((el) => { if (!deferred(el)) io.observe(el); });
  document.addEventListener('lp:panelchange', () => els.forEach((el) => { if (el.textContent === '0') io.observe(el); }));
}

/* ------------------------------- 動画の遅延再生 ------------------------------- */
/* data-src を <source> に差し込んで読み込ませる。initClips と initShow で共用する。
   ★<video src> でなく <source> なのは、読み込みを始めるまで一切取りに行かせないため */
function loadClip(v) {
  if (!v || v.dataset.loaded) return;
  v.dataset.loaded = '1';
  const s = document.createElement('source');
  s.type = 'video/mp4'; s.src = v.getAttribute('data-src');
  v.appendChild(s);
  v.load();
}
function playClip(v) {
  if (!v || reduceMotion.matches) return;
  const p = v.play();
  if (p && p.catch) p.catch(() => {});
}

export function initClips({ skip = null } = {}) {
  // skip: この要素の中の映像は呼び出し側が自分で面倒を見る（螺旋は前面の1枚だけ動かす）
  let clips = Array.from(document.querySelectorAll('video.clip[data-src]'));
  if (skip) clips = clips.filter((v) => !v.closest(skip));
  if (!clips.length) return;
  const load = loadClip, play = playClip;
  if (!('IntersectionObserver' in window)) { clips.forEach((v) => { load(v); play(v); }); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const v = en.target;
      if (en.isIntersecting) { load(v); play(v); } else if (!v.paused) v.pause();
    });
  }, { rootMargin: '160px 0px' });
  clips.forEach((v) => io.observe(v));
}

/* ------------------------------ マグネットボタン ------------------------------ */
export function initMagnets() {
  if (!finePointer.matches || reduceMotion.matches) return;
  document.querySelectorAll('[data-magnet]').forEach((el) => {
    /* ★data-magnet="glow" は「動かさず、カーソル位置の光りだけ」。
       --mx/--my は base.css の .btn の光り（radial-gradient）が読むので、
       位置だけ書いて transform には触れない */
    const glowOnly = el.getAttribute('data-magnet') === 'glow';
    if (glowOnly) {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
        el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
      });
      el.addEventListener('pointerleave', () => {
        el.style.removeProperty('--mx'); el.style.removeProperty('--my');
      });
      return;
    }
    const sx = Spring.fromFeel({ settle: 0.5, overshoot: 0.12 });
    const sy = Spring.fromFeel({ settle: 0.5, overshoot: 0.12 });
    let raf = 0, last = 0;
    const loop = (now) => {
      const dt = safeDt((now - (last || now)) / 1000); last = now;
      sx.step(dt); sy.step(dt);
      el.style.transform = `translate(${sx.value.toFixed(2)}px,${sy.value.toFixed(2)}px)`;
      if (sx.isSettled(0.05, 0.5) && sy.isSettled(0.05, 0.5)) { raf = 0; last = 0; el.style.transform = ''; return; }
      raf = requestAnimationFrame(loop);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      sx.setTarget(dx * 0.34); sy.setTarget(dy * 0.34);
      el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
      el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
      kick();
    });
    el.addEventListener('pointerleave', () => { sx.setTarget(0); sy.setTarget(0); kick(); });
  });
}

/* -------------------------------- チケットの傾き -------------------------------- */
export function initTilt() {
  if (!finePointer.matches || reduceMotion.matches) return;
  document.querySelectorAll('[data-tilt]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--ty', (x * 10) + 'deg');
      el.style.setProperty('--tx', (-y * 8) + 'deg');
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--tx', '0deg'); el.style.setProperty('--ty', '0deg'); });
  });
}

/* ------------------------------------ カーソル ----------------------------------- */
export function initCursor() {
  const el = document.getElementById('cursor');
  const api = { setLabel() {}, hide() {}, show() {} };
  if (!el || !finePointer.matches || reduceMotion.matches) return api;
  document.documentElement.classList.add('has-cursor');
  const dot = el.querySelector('i'), ring = el.querySelector('span');
  let tx = -100, ty = -100, dx = -100, dy = -100, rx = -100, ry = -100, seen = false;
  let last = 0, raf = 0;
  const loop = (now) => {
    const dt = safeDt((now - (last || now)) / 1000); last = now;
    dx = expSmooth(dx, tx, 0.02, dt); dy = expSmooth(dy, ty, 0.02, dt);
    rx = expSmooth(rx, tx, 0.07, dt); ry = expSmooth(ry, ty, 0.07, dt);
    dot.style.transform = `translate(${dx}px,${dy}px)`;
    ring.style.transform = `translate(${rx}px,${ry}px) ${ring.dataset.scale || ''}`;
    raf = requestAnimationFrame(loop);
  };
  window.addEventListener('pointermove', (e) => {
    tx = e.clientX; ty = e.clientY;
    if (!seen) { seen = true; dx = rx = tx; dy = ry = ty; raf = requestAnimationFrame(loop); }
  }, { passive: true });
  document.addEventListener('pointerleave', () => el.classList.add('is-hidden'));
  document.addEventListener('pointerenter', () => el.classList.remove('is-hidden'));
  const LABELS = [
    ['[data-gate]', (t) => (t.getAttribute('aria-expanded') === 'true' ? 'CLOSE' : 'OPEN')],
    ['.fv__sticky', () => 'SCROLL'],
    ['.ticket', () => 'ONLINE'],
  ];
  let labelTarget = null;
  document.addEventListener('pointerover', (e) => {
    const t = e.target;
    const link = t.closest && t.closest('a, button, [role="tab"]');
    el.classList.toggle('is-link', !!link);
    let label = '';
    labelTarget = null;
    for (const [sel, fn] of LABELS) {
      const m = t.closest && t.closest(sel);
      if (m) { label = fn(m); labelTarget = m; break; }
    }
    if (link && link.closest('.fv__sticky')) label = '';
    ring.textContent = label;
    el.classList.toggle('is-label', !!label);
  });
  api.setLabel = (text) => { ring.textContent = text; el.classList.toggle('is-label', !!text); };
  api.hide = () => el.classList.add('is-hidden');
  api.show = () => el.classList.remove('is-hidden');
  return api;
}

/* ------------------------------------ 共有 ------------------------------------ */
export function initShare() {
  document.querySelectorAll('[data-share]').forEach((btn) => {
    btn.addEventListener('click', () => {
      track('share_click', {});
      /* ★'#parent' は実在しないアンカーだった。タブを含む節は #who */
      const data = { title: document.title, url: location.href.split('#')[0] + '#who' };
      if (navigator.share) navigator.share(data).catch(() => {});
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(data.url).catch(() => {});
      else window.prompt('このURLをコピーしてください', data.url);
    });
  });
}

/* ------------------------------------ CTA ------------------------------------ */
export function initCtas() {
  document.querySelectorAll('[data-cta]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const kind = el.getAttribute('data-cta');
      track('cta_click', { cta_position: el.getAttribute('data-cta-pos') || 'inline', cta_kind: kind });
      if (kind === 'form') track('form_start', { cta_position: el.getAttribute('data-cta-pos') || 'inline' });
      if (el.getAttribute('href') === '#') e.preventDefault();   /* フォームURL未確定の間は飛ばさない */
    });
  });
}

/* --------------------------- 参加者の声（紐で吊るした札） ---------------------------
   ★2026-09-12 に作り直した。それまでは帯を sticky で画面に貼り付け、pin に持たせた
     高さぶんの縦スクロールを横送りに変換していた。読む側から見ると、この区間では
     下へスクロールしても次のセクションへ進めない（札が横に流れるだけ）状態だった。
     いまは縦スクロールを素通しにして、札は 4 秒ごとの自動送りと指のスワイプだけで動く。

   ・送りは transform ＋ CSS の transition。1回につき1枚ぶん動く
   ・両端でつなぎ目が出ないよう、先頭と末尾に1枚ずつ複製を置く。複製の上で止まった
     瞬間に transition を切り、見た目を変えずに本物の同じ札へ番号を付け替える
   ・段差（札ごとに紐の長さを変えて吊り位置をずらしていた分）は CSS 側で撤去済み */
/* ★initVoiceGallery（4秒の自動送り・端の複製・スワイプ）は 2026-09-30 に廃止した。
   参加者の声は素の横スクロール1本で、JS は関与しない */


/* --------------------------- 折りたたみを開くときの動き ---------------------------
   <details> は open を付けた瞬間に高さが確定するので、何もしないと中身が一段で
   飛び出す。中身側に 0.34s のフェードだけ掛けてあったため、枠は即座に伸びて
   中身だけ遅れて現れ、不具合のように見えていた。
   高さを実測して 0 から本来の高さまで動かし、枠と中身を同じ時間で揃える。
   ★閉じるほうは触らない（閉じるのは待たされないほうがよい）。
   ★動きを減らす設定では即開きにする */
const FOLD_MS = 560;
function openFoldAnimated(fold, body) {
  fold.open = true;
  if (!body || reduceMotion.matches || typeof body.animate !== 'function') return;
  const h = body.scrollHeight;
  if (!h) return;
  const prev = body.style.overflow;
  body.style.overflow = 'hidden';   // 伸びきる前の中身を枠から出さない
  const a = body.animate(
    [{ height: '0px', opacity: 0, transform: 'translateY(-8px)' },
     { height: `${h}px`, opacity: 1, transform: 'none' }],
    { duration: FOLD_MS, easing: 'cubic-bezier(.22,.61,.36,1)' },
  );
  const done = () => { body.style.overflow = prev; };
  a.addEventListener('finish', done);
  a.addEventListener('cancel', done);
}

/* 手で開くときも同じ動きにする。閉じるのは既定のまま */
export function initProgramFolds() {
  document.querySelectorAll('.plist__fold').forEach((fold) => {
    const summary = fold.querySelector('summary');
    const body = fold.querySelector('.plist__body');
    if (!summary || !body) return;
    summary.addEventListener('click', (e) => {
      if (fold.open) return;
      e.preventDefault();
      openFoldAnimated(fold, body);
    });
  });
}

/* --------------------------- 最初のプログラムの自動展開 ---------------------------
   サンフランシスコの錠剤は、以前は open を付けて最初から開いていた。
   スクロールが行に届いたときに開くようにする。開くのは一度だけで、
   手で開け閉めしたあとは触らない（読み手の操作を上書きしない）。
   行が画面の下寄りに入った時点で開くので、伸びるのは画面の外。
   読んでいる位置が飛ばない */
export function initProgramAutoOpen() {
  const fold = document.getElementById('prog-sf');
  if (!fold || fold.open) return;
  if (!('IntersectionObserver' in window)) { fold.open = true; return; }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    io.disconnect();
    fold.removeEventListener('toggle', finish);
  };
  /* 先に手で触られたら、こちらからは開けない */
  fold.addEventListener('toggle', finish);

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting || done) return;
      finish();
      openFoldAnimated(fold, fold.querySelector('.plist__body'));
    });
  }, { rootMargin: '0px 0px -20% 0px', threshold: 0.4 });
  io.observe(fold.querySelector('summary') || fold);
}

/* --------------------------- チケットの枠（触れている間） ---------------------------
   :hover は指で触れたあと残る機種があるので、指のときは JS で付け外しする。
   マウスは CSS の :hover に任せる */
export function initTicketTouch() {
  document.querySelectorAll('.ticket').forEach((el) => {
    const on = (e) => { if (e.pointerType !== 'mouse') el.classList.add('is-touched'); };
    const off = () => el.classList.remove('is-touched');
    el.addEventListener('pointerdown', on, { passive: true });
    el.addEventListener('pointerup', off, { passive: true });
    el.addEventListener('pointercancel', off, { passive: true });
    el.addEventListener('pointerleave', off, { passive: true });
  });
}

/* ------------------------- 参加者の声: 長い札を畳む -------------------------
   手で送る横スクロールにしたので、1枚が画面より高いと「縦に読むか、横へ送るか」の
   二択になり、送った先にも空きが出る。既定の行数を超える札だけ畳んで開けるようにする。
   ★行数で判定せず実測の高さで判定する。文言を差し替えても自動で効く */
export function initVoiceFolds({ lines = 8 } = {}) {
  const cards = Array.from(document.querySelectorAll('.vcard'));
  if (!cards.length) return;
  cards.forEach((card) => {
    const quote = card.querySelector('.vcard__quote');
    if (!quote) return;
    card.style.setProperty('--fold-lines', String(lines));
    /* 畳んだときの高さを CSS に決めさせてから、中身がはみ出すかを見る */
    card.classList.add('is-foldable');
    if (quote.scrollHeight <= quote.clientHeight + 4) {
      card.classList.remove('is-foldable');   /* 畳む必要がない札は元に戻す */
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vcard__more';
    btn.textContent = '続きを読む';
    btn.setAttribute('aria-expanded', 'false');
    const id = 'vq-' + Math.random().toString(36).slice(2, 8);
    quote.id = id;
    btn.setAttribute('aria-controls', id);
    btn.addEventListener('click', () => {
      const open = card.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '閉じる' : '続きを読む';
      track('voice_expand', { open: open ? 1 : 0 });
    });
    quote.insertAdjacentElement('afterend', btn);
  });
}

/* --------------------- FV の吹き出しを1文字ずつ出す ---------------------
   ★先に全文を span に割ってから隠す。あとから足すと吹き出しが打つたびに広がり、
     マスコットと CTA の位置がずれる。箱の大きさは最初から最終形で確定させる。
   ★モーション低減では何もしない（全文がそのまま出る） */
export function initTypewriter({ selector = '.fv__buddy-say', speed = 58, delay = 650 } = {}) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (reduceMotion.matches) return;

  const chars = [];
  const walk = (node) => {
    Array.from(node.childNodes).forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const ch of n.nodeValue) {
          const s = document.createElement('span');
          s.className = 'tw';
          s.textContent = ch;
          frag.appendChild(s);
          chars.push(s);
        }
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') {
        walk(n);
      }
    });
  };
  walk(el);
  if (!chars.length) return;

  el.classList.add('is-typing');
  let i = 0;
  let timer = 0;
  const step = () => {
    chars[i].classList.add('is-on');
    i += 1;
    if (i < chars.length) timer = setTimeout(step, speed);
    else el.classList.remove('is-typing');
  };
  /* 幕が上がって FV の中身が出そろってから打ち始める */
  const start = () => { timer = setTimeout(step, delay); };
  if (document.querySelector('.fv.is-in')) start();
  else {
    const mo = new MutationObserver(() => {
      if (document.querySelector('.fv.is-in')) { mo.disconnect(); start(); }
    });
    const fv = document.querySelector('.fv');
    if (fv) mo.observe(fv, { attributes: true, attributeFilter: ['class'] });
    else start();
  }
  /* 画面外へ出たら打つのをやめる（戻ってきたら全文を出す） */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && timer) { clearTimeout(timer); timer = 0;
      chars.forEach((c) => c.classList.add('is-on')); el.classList.remove('is-typing'); }
  });
}

/* ------------------- 案内役が見せる2つの吹き出しを順に送る -------------------
   上（映像/写真）は右から左へ移り変わり、下（セリフ）は同時にポップで差し替わる。
   ★画面に入っている間だけ回す。出る前から送っていると、現れたときには一周している。
   ★モーション低減では送らない（1組目のまま） */
export function initShow({ interval = 4200 } = {}) {
  const root = document.querySelector('[data-show]');
  if (!root) return;
  const items = Array.from(root.querySelectorAll('.show__item'));
  /* 映像と一緒に切り替える連れ（セリフ・縦書きの題）。同じ順番で並んでいることだけが前提 */
  const tracks = [
    Array.from(root.querySelectorAll('.show__line')),
    Array.from(root.querySelectorAll('.show__ttl')),
  ].filter((t) => t.length);
  if (items.length < 2) return;

  let i = 0, timer = 0, visible = false, steps = 0;

  /* ★映像は表に出ている1枚だけ動かす。.show__item は全部同じマスに重なっていて
     位置が同じなので、initClips の交差監視に任せると全枚ぶんを同時に読み込んで
     同時に再生してしまう（実測で4本・計5.4MB を一度に取得し、デコーダも4本立っていた）。
     次の1枚だけ先に読んでおくと、切り替わった瞬間にポスターが出ることもない。
     main.js 側は initClips({ skip: '[data-show]' }) でこの節を除外してある */
  const videoOf = (el) => el.querySelector('video.clip[data-src]');
  const syncVideos = () => {
    const next = (i + 1) % items.length;
    items.forEach((el, k) => {
      const v = videoOf(el);
      if (!v) return;
      if (visible && (k === i || k === next)) loadClip(v);
      if (visible && k === i) playClip(v);
      else if (!v.paused) v.pause();
    });
  };

  const show = (next) => {
    const prev = i; i = (next + items.length) % items.length;
    if (prev === i) return;
    items[prev].classList.remove('is-on');
    items[prev].classList.add('is-out');
    items[i].classList.remove('is-out');
    items[i].classList.add('is-on');
    for (const t of tracks) {
      if (t[prev]) t[prev].classList.remove('is-on');
      if (t[i]) t[i].classList.add('is-on');
    }
    syncVideos();
    /* 出ていった札は、次に右から入れるよう印を落としておく */
    setTimeout(() => { if (i !== prev) items[prev].classList.remove('is-out'); }, 1350);
    /* ★計測は最初の一周だけ。見えている間ずっと送ると 4.2 秒ごとに増え続け、
       GA4 を結線した瞬間に 1 セッションの上限を食い潰す */
    if (steps < items.length) { steps++; track('show_step', { i }); }
  };
  const tick = () => { show(i + 1); timer = setTimeout(tick, interval); };
  const start = () => { syncVideos(); if (!timer && !reduceMotion.matches) timer = setTimeout(tick, interval); };
  const stop = () => {
    clearTimeout(timer); timer = 0;
    items.forEach((el) => { const v = videoOf(el); if (v && !v.paused) v.pause(); });
  };

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      visible = es.some((e) => e.isIntersecting);
      if (visible) start(); else stop();
    }, { threshold: 0.3 }).observe(root);
  } else start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else if (visible) start();
  });
}

/* ------------------ 映像の節: 案内役の受け渡し ------------------
   2人目（右・左向き）が画面に入ったら、1人目と吹き出し2つを引っ込める。
   ★rootMargin を下だけ -20% にしてある。これで「下から入ってきたとき」は画面の
     8割の高さで切り替わり、「上へ抜けたとき」は完全に画面の外へ出てから戻る。
     素の threshold で往復させると、上へ抜ける途中（まだ4割見えている）で
     2人目が消え始めてしまう */
export function initHandoff() {
  const hero = document.querySelector('.intro__hero');
  const next = document.querySelector('.intro__buddy--r');
  if (!hero || !next) return;
  if (!('IntersectionObserver' in window)) { hero.classList.add('is-handed'); return; }
  new IntersectionObserver((es) => {
    es.forEach((e) => hero.classList.toggle('is-handed', e.isIntersecting));
  }, { threshold: 0, rootMargin: '0px 0px -20% 0px' }).observe(next);
}

/* ------------------ 問いかけの上の吹き出しを LINE のように出す ------------------
   1つ目は「2つ目が出る位置」に現れ、2つ目が出た瞬間に押し上げられる。
   ★間（gap）は 700ms では2つが同時に出たように見えたので 1500ms にした。
     LINE で相手が打ち終えるまでの間に近く、1つ目を目で追う余裕ができる。
   ★上げ幅は2つ目の実寸＋隙間から出す。決め打ちだと文言を変えた瞬間にずれる
   ★モーション低減では何もしない（CSS 側で最初から見えている） */
export function initSays({ gap = 1500 } = {}) {
  const wrap = document.querySelector('.intro__says');
  if (!wrap || reduceMotion.matches) return;
  const bubbles = Array.from(wrap.children).filter((el) => el.classList.contains('say'));
  if (!bubbles.length) return;

  const setRise = () => {
    const styles = getComputedStyle(wrap);
    const g = parseFloat(styles.rowGap || styles.gap) || 0;
    /* 自分より下に出る吹き出しの高さぶんだけ、最初は下げておく */
    let below = 0;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      bubbles[i].style.setProperty('--rise', `${below.toFixed(1)}px`);
      below += bubbles[i].offsetHeight + g;
    }
  };
  setRise();
  window.addEventListener('resize', () => { if (!wrap.dataset.done) setRise(); }, { passive: true });

  let fired = false;
  const run = () => {
    if (fired) return;
    fired = true;
    bubbles.forEach((el, i) => {
      setTimeout(() => {
        el.classList.add('is-pop');
        /* 自分が出たら、上にいる吹き出しを押し上げる */
        for (let k = 0; k < i; k++) bubbles[k].style.setProperty('--rise', '0px');
        if (i === bubbles.length - 1) wrap.dataset.done = '1';
      }, i * gap);
    });
  };

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      if (document.documentElement.classList.contains('is-veiled')) return;  /* 幕の裏では出さない */
      io.disconnect(); run();
      /* ★発火の線は「画面の下から35%」。それより上に吹き出しの頭が来たら出す。
         ここを下げすぎると、1つ目は画面の外でポップを済ませてしまい、
         スクロールして辿り着いたときには「もう出ている」状態になる
         （1つ目は --rise で2つ目の位置まで下げてあるので、束の上端より
          さらに150px 下に居る。実測で下端は上端+245px）。
         0.25 や先回り80px では実際そうなっていたので、-35% まで引き上げた */
    }, { threshold: 0, rootMargin: '0px 0px -35% 0px' });
    io.observe(wrap);
  } else run();
}
