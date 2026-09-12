#!/usr/bin/env python3
"""fonts/fonts.css と fonts/*.woff2 を再生成する（自己ホスト・サブセット）。

実装済みの index.html を実際にブラウザで描画し、
「どの書体のどのウェイトで、どの文字が使われているか」を採取してから
Google Fonts の text= サブセットAPIで face ごとに1ファイル作らせ、
woff2 をこのフォルダに落として CSS の url() を相対パスに書き換える。
→ 配信時に外部（fonts.gstatic.com）へ一切出ない。

コピーやマークアップを変えたら必ず再実行すること。
（サブセットに無い文字はフォールバック書体で描かれる＝面が崩れる）

前提: build-fable/ を http://127.0.0.1:8961 で配信していること。
  cd build-fable && python3 -m http.server 8961
実行:
  python3 fonts/build_fonts.py
"""
import pathlib
import hashlib
import re
import subprocess
import sys

URL = "http://127.0.0.1:8961/index.html"
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "fonts.css"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# どの face にも必ず入れる文字（★空白 U+0020 を落とすとフォールバックが多発する）
SAFE = (" 　!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]_"
        "abcdefghijklmnopqrstuvwxyz、。「」『』（）・／〜％：；！？…—–‐※©＋−›①②③④⑤#")

FAMILIES = {
    "Noto Serif JP": "noto-serif-jp",
    "Zen Kaku Gothic New": "zen-kaku-gothic-new",
    "IBM Plex Mono": "ibm-plex-mono",
    "Kalam": "kalam",
    "Oswald": "oswald",
}

COLLECT_JS = r"""() => {
  const acc = {};
  const add = (fam, w, txt) => {
    const k = fam + '|' + w;
    acc[k] = acc[k] || new Set();
    for (const c of txt) acc[k].add(c);
  };
  /* ★欧文だけの書体（IBM Plex Mono / Kalam）に和文を投げてはいけない。
     投げると、その字はどの subset にも入らないまま落ち、実機では Osaka や
     MS ゴシックで描かれる。指定と違う書体になるが、
     ローカルに和文が入っている Mac では気づけない。
     和文はスタックの中で最初に見つかった和文書体へ渡す */
  const JP_FAMS = ['Zen Kaku Gothic New', 'Noto Serif JP'];
  const isJP = (c) => /[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF]/.test(c);
  const route = (stack, w, txt) => {
    const jpFam = stack.find((f) => JP_FAMS.indexOf(f) >= 0) || JP_FAMS[0];
    let latin = '', jp = '';
    for (const c of txt) { if (isJP(c)) jp += c; else latin += c; }
    if (latin) add(stack[0], w, latin);
    if (jp) add(JP_FAMS.indexOf(stack[0]) >= 0 ? stack[0] : jpFam, w, jp);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue;
    if (!t || !t.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    const stack = cs.fontFamily.split(',').map(s => s.replace(/['"]/g, '').trim());
    route(stack, cs.fontWeight, t);
  }
  document.querySelectorAll('*').forEach(el => {
    ['::before', '::after'].forEach(pe => {
      const cs = getComputedStyle(el, pe);
      const c = cs.content;
      if (c && c !== 'none' && c !== 'normal' && c.startsWith('"')) {
        const stack = cs.fontFamily.split(',').map(s => s.replace(/['"]/g, '').trim());
        route(stack, cs.fontWeight, c.slice(1, -1));
      }
    });
  });
  // 属性から差し込まれる文字（aria-label は描画しないので不要。data-count の数値は描画する）
  document.querySelectorAll('[data-count]').forEach(el => {
    const cs = getComputedStyle(el);
    const stack = cs.fontFamily.split(',').map(s => s.replace(/['"]/g, '').trim());
    route(stack, cs.fontWeight, el.getAttribute('data-count') + '0123456789.');
  });
  // 扉カードの OPEN/CLOSE 切り替え
  document.querySelectorAll('.gate__open').forEach(el => {
    const cs = getComputedStyle(el);
    const stack = cs.fontFamily.split(',').map(s => s.replace(/['"]/g, '').trim());
    route(stack, cs.fontWeight, 'OPENCLOSE');
  });
  const out = {};
  Object.keys(acc).forEach(k => { out[k] = [...acc[k]].sort().join(''); });
  return out;
}"""

REVEAL_JS = r"""() => {
  document.querySelectorAll('[role=tabpanel]').forEach(e => { e.hidden = false; });
  document.querySelectorAll('.faq__a, .gate__body').forEach(e => { e.hidden = false; });
  document.querySelectorAll('[data-split]').forEach(e => {});
}"""


def collect():
    from playwright.sync_api import sync_playwright
    merged = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for vp in ((390, 844), (1280, 800)):
            page = browser.new_page(viewport={"width": vp[0], "height": vp[1]})
            page.goto(URL, wait_until="networkidle")
            page.wait_for_timeout(2500)
            page.evaluate(REVEAL_JS)
            page.wait_for_timeout(300)
            got = page.evaluate(COLLECT_JS)
            for k, v in got.items():
                merged[k] = merged.get(k, "") + v
            page.close()
        browser.close()
    return {k: "".join(sorted(set(v))) for k, v in merged.items()}


def fetch_css(family, weight, text):
    r = subprocess.run(
        ["curl", "-sS", "-A", UA, "-G",
         "--data-urlencode", f"family={family}:wght@{weight}",
         "--data-urlencode", "display=swap",
         "--data-urlencode", f"text={text}",
         "https://fonts.googleapis.com/css2"],
        capture_output=True, text=True)
    if "@font-face" not in r.stdout:
        raise SystemExit(f"failed: {family} {weight}\n{r.stdout[:400]}{r.stderr[:200]}")
    return r.stdout


def download(url, dst):
    r = subprocess.run(["curl", "-sS", "-A", UA, "-o", str(dst), url], capture_output=True, text=True)
    if r.returncode != 0 or not dst.exists() or dst.stat().st_size < 1000:
        raise SystemExit(f"download failed: {url}\n{r.stderr[:300]}")


def main():
    sets = collect()
    print("collected:", {k: len(v) for k, v in sorted(sets.items())})
    faces = []
    for key, chars in sorted(sets.items()):
        family, weight = key.split("|")
        if family not in FAMILIES:
            print("  skip (fallback family):", key)
            continue
        if not re.fullmatch(r"\d{3}", weight):
            weight = {"normal": "400", "bold": "700"}.get(weight, "400")
        faces.append((family, weight, chars))

    # 同じ face が別ウェイトのフォールバック先になるので、和文2書体は 400/500/700 を全部持つ
    parts = []
    for old in HERE.glob("*.woff2"):
        old.unlink()
    for family, weight, chars in faces:
        text = "".join(sorted(set(chars) | set(SAFE)))
        css = fetch_css(family, weight, text)
        urls = re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", css)
        if not urls:
            raise SystemExit(f"no url in css for {family} {weight}")
        # text= 指定では 1 face = 1 url。複数来たら先頭を使う（unicode-range 分割はされない）
        url = urls[0]
        fname = f"{FAMILIES[family]}-{weight}.woff2"
        download(url, HERE / fname)
        size = (HERE / fname).stat().st_size
        print(f"  {family} {weight}: {len(text)} chars → {fname} {size:,} bytes")
        # ★ url に中身のハッシュを付ける。fonts.css だけ更新してもブラウザは
        #    woff2 を古いまま使い続けるので、字を足しても足りないまま描かれて
        #    その字だけ代替書体に落ちる（別のフォントに見える原因になる）
        digest = hashlib.sha1((HERE / fname).read_bytes()).hexdigest()[:8]
        parts.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:swap;"
            "src:url(%s?v=%s) format('woff2');}" % (family, weight, fname, digest))
    OUT.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    sys.exit(main())
