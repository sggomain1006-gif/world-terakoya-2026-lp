/* =============================================================================
   ui.js — DOM 側の振る舞い
   タブ / 開閉（FAQ・扉カード）/ 出現 / 数字のカウント / 動画の遅延再生 /
   マグネットボタン / チケットの傾き / カーソル / 共有 / 計測
   ============================================================================= */

import { Spring, expSmooth, safeDt } from './lib/spring.js?v=2026091192';

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
const PERSONAS = ['student', 'parent', 'university'];
export function initTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  if (!tabs.length) return { open() {} };
  const ink = document.querySelector('.tabs__ink');
  const list = document.querySelector('[role="tablist"]');
  const panels = {};
  const byPersona = {};
  tabs.forEach((t) => {
    const p = t.getAttribute('data-tab');
    byPersona[p] = t;
    panels[p] = document.getElementById(t.getAttribute('aria-controls'));
  });
  let hashLock = false;

  function moveInk(tab) {
    if (!ink || !list) return;
    const lr = list.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    ink.style.width = tr.width + 'px';
    ink.style.transform = `translateX(${tr.left - lr.left}px)`;
  }

  function open(persona, src, opts = {}) {
    if (!PERSONAS.includes(persona)) return;
    const changed = persona !== currentPersona;
    currentPersona = persona;
    PERSONAS.forEach((p) => {
      const t = byPersona[p], pane = panels[p];
      if (!t || !pane) return;
      const on = p === persona;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
      if (on && pane.hidden) {
        pane.hidden = false;
        // 出現アニメを毎回走らせる
        pane.style.animation = 'none';
        void pane.offsetWidth;
        pane.style.animation = '';
      } else if (!on) pane.hidden = true;
    });
    moveInk(byPersona[persona]);
    if (opts.updateHash !== false && (location.hash || '').replace('#', '') !== persona) {
      hashLock = true;
      try { history.replaceState(null, '', '#' + persona); } catch (e) { location.hash = persona; }
      setTimeout(() => { hashLock = false; }, 0);
    }
    if (changed) track('persona_tab_open', { persona, source: src || 'tab' });
    // 新しく見えた要素の出現・動画を拾う
    document.dispatchEvent(new CustomEvent('lp:panelchange'));
  }

  tabs.forEach((t) => t.addEventListener('click', () => open(t.getAttribute('data-tab'), 'tab')));
  if (list) {
    list.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next === -1) return;
      e.preventDefault();
      tabs[next].focus();
      open(tabs[next].getAttribute('data-tab'), 'tab');
    });
  }
  const fromHash = () => { const h = (location.hash || '').replace('#', ''); return PERSONAS.includes(h) ? h : null; };
  window.addEventListener('hashchange', () => { if (!hashLock) { const p = fromHash(); if (p) open(p, 'hash', { updateHash: false }); } });
  window.addEventListener('resize', () => moveInk(byPersona[currentPersona]));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveInk(byPersona[currentPersona]));
  open(fromHash() || 'student', 'default', { updateHash: false });
  return { open };
}

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
export function initClips({ skip = null } = {}) {
  // skip: この要素の中の映像は呼び出し側が自分で面倒を見る（螺旋は前面の1枚だけ動かす）
  let clips = Array.from(document.querySelectorAll('video.clip[data-src]'));
  if (skip) clips = clips.filter((v) => !v.closest(skip));
  if (!clips.length) return;
  const load = (v) => {
    if (v.dataset.loaded) return;
    v.dataset.loaded = '1';
    const s = document.createElement('source');
    s.type = 'video/mp4'; s.src = v.getAttribute('data-src');
    v.appendChild(s);
    v.load();
  };
  const play = (v) => { if (reduceMotion.matches) return; const p = v.play(); if (p && p.catch) p.catch(() => {}); };
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
      const data = { title: document.title, url: location.href.split('#')[0] + '#parent' };
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
   縦にスクロールすると札が横へ流れる。
   ★2026-09-11 に振り子の揺れ（速さに応じた回転）を外した。単純な横移動だけにしている。
     札の意匠・位置・段差は CSS 側なので、そのまま残っている。

   帯は sticky で画面に貼り付け、pin の高さで「横に流すぶんの縦の距離」を確保する。
   sticky はブラウザ自身が固定するので、毎フレーム transform で留めるのと違って
   スクロールと1フレームもずれない */
export function initVoiceGallery() {
  const pin = document.querySelector('.vcards__pin');
  if (!pin) return;
  const stage = pin.querySelector('.vcards__stage');
  const track = pin.querySelector('.vcards__track');
  if (!stage || !track) return;
  const cards = Array.from(track.children);
  if (cards.length < 2) return;

  /* モーション低減の設定では動かさない。横スクロールで全部読める形に戻す（紐は残る） */
  if (reduceMotion.matches) { pin.classList.add('is-static'); return; }

  /* ★追従は「1フレームごとに何割詰めるか」でなく半減期で書く。
     割合だと 60Hz と 120Hz で追従が倍違い、同じ指の動きでも機種によって重さが変わる
     （実測: 旧 SCRUB=0.14 は 60Hz で半減期 77ms、120Hz で 38ms）*/
  const HALF_LIFE = 0.045; // 秒。小さいほど指にぴったり付く
  const TAIL = 1.04;       // 横に流す距離に対する縦の余裕。1.15 だと最後の2割が動かない帯になっていた

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  let maxShift = 0, travel = 0, pinTop = 0;
  let rendered = 0;
  let lastNow = 0;
  let snapNext = true;     // 画面に入った最初の1フレームは追従させず即座に合わせる

  const barH = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h')) || 64;

  /* 帯の貼り付け位置と pin の高さを実測して入れる。
     帯は画面の中ほどに置く。上部バーの下にはもぐらせない */
  const layout = () => {
    pin.style.height = '';
    const stageH = stage.offsetHeight;
    const centre = Math.round((window.innerHeight - stageH) / 2);
    /* 上部バーの下に収まる高さなら、バーを避けて中ほどに置く。
       収まらない背の低い機種（SEなど）では、下がはみ出す方が読めないので上へ詰める */
    pinTop = stageH <= window.innerHeight - barH() - 24
      ? Math.max(barH() + 12, centre)
      : Math.max(8, centre);
    stage.style.setProperty('--vc-top', pinTop + 'px');
    /* 送り箱の左端は画面の左端とは限らない（PCでは .wrap が中央寄せなので内側から始まる）。
       0 と決めつけると、最後の札が画面の右へはみ出したまま止まる。
       いま当てている送り量を足し戻して、変形なしの左端を出してから測る */
    const left = track.getBoundingClientRect().left + maxShift * rendered;
    /* ★端の札も画面の中心に来られるよう、送り箱の左右に余白を入れる。
       入れないと1枚目と最後の札は中心に届かず、そこに対応する数字が一度も出ない
       （実測: PC で 1つ目「挑戦意欲の変化」と4つ目「全体満足度」が出なかった）。
       余白は padding なので、ここで測った border box の左端（left）は動かない */
    const cw = cards[0].getBoundingClientRect().width;
    const pad = Math.max(0, Math.round(window.innerWidth / 2 - cw / 2 - left));
    track.style.paddingLeft = pad + 'px';
    track.style.paddingRight = pad + 'px';
    maxShift = Math.max(0, Math.round(left + track.scrollWidth - document.documentElement.clientWidth));
    travel = Math.round(maxShift * TAIL);
    pin.style.height = (stageH + travel) + 'px';
  };

  /* 送り箱ごと横へ動かすだけ。札には何も書かない（回転を外したのはここ） */
  const paint = () => {
    track.style.transform = 'translate3d(' + (-maxShift * rendered).toFixed(1) + 'px,0,0)';
  };

  let near = false;
  let rafId = null;

  /* 1フレームにつき読み取りを先にまとめ、そのあとに書き込む。
     交互にやると強制同期レイアウトでスクロールがカクつく */
  const frame = (now) => {
    rafId = null;
    if (!near) return;

    const top = pin.getBoundingClientRect().top;      // 読み取り
    const target = travel > 0 ? clamp01((pinTop - top) / travel) : 0;
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    /* ★入り直したときは詰めずに合わせる。詰めると、前に見終わった位置（右端）から
       左へ巻き戻る動きが見えてしまう */
    if (snapNext || dt === 0) { rendered = target; snapNext = false; }
    else rendered += (target - rendered) * (1 - Math.pow(0.5, dt / HALF_LIFE));
    if (Math.abs(rendered - target) < 0.0002) rendered = target;

    paint();                                          // 書き込み
    rafId = requestAnimationFrame(frame);
  };

  const sync = () => {
    if (near && rafId === null) rafId = requestAnimationFrame(frame);
    else if (!near && rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  };

  layout();
  paint();

  /* 画面から遠い間はループごと止める */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (e.isIntersecting && !near) { snapNext = true; lastNow = 0; }
        near = e.isIntersecting;
      });
      sync();
    }, { rootMargin: '300px 0px 300px 0px' }).observe(pin);
  } else {
    near = true;
    sync();
  }

  let rt = 0;
  const relayout = () => { clearTimeout(rt); rt = setTimeout(() => { layout(); paint(); }, 120); };
  window.addEventListener('resize', relayout, { passive: true });
  window.addEventListener('orientationchange', relayout, { passive: true });
  /* 写真とフォントが入ると札の高さが変わる。変わったら測り直す */
  if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(stage);
  track.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', relayout, { once: true });
  });
}

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
