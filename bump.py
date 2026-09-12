#!/usr/bin/env python3
"""版番号を1か所で揃える。

index.html の ?v= だけを上げても、main.js が読む ./ui.js などは
版番号が付いておらず、ブラウザが古いまま使う。新しい main.js が
古い ui.js に無い名前を import すると、その瞬間に全部のJSが止まり、
幕が上がらず「ページが開けない」状態になる。
そこで HTML のリンクと、JS どうしの import の両方に同じ版を書く。

  python3 bump.py            # 今日の日付＋連番で自動採番
  python3 bump.py 2026090918 # 明示指定
"""
import re, sys, pathlib, datetime

HERE = pathlib.Path(__file__).resolve().parent
HTML = HERE / 'index.html'

def current():
    m = re.search(r'\?v=(\d+)', HTML.read_text(encoding='utf-8'))
    return m.group(1) if m else None

def next_version():
    cur = current()
    today = datetime.date.today().strftime('%Y%m%d')
    if cur and cur.startswith(today):
        return today + f'{int(cur[len(today):] or 0) + 1:02d}'
    return today + '01'

def main():
    ver = sys.argv[1] if len(sys.argv) > 1 else next_version()
    # 1) HTML の ?v=
    h = HTML.read_text(encoding='utf-8')
    h2 = re.sub(r'\?v=\d+', f'?v={ver}', h)
    # modulepreload は版番号が付いていないことがある。付いていないと
    # 版付きの import と別物として二重に取りに行くので、ここでも揃える
    h2 = re.sub(r'(<link rel="modulepreload" href="[^"]+?\.js)(\?v=\d+)?"',
                lambda m: f'{m.group(1)}?v={ver}"', h2)
    # ★版を meta と version.txt にも書く。GitHub Pages は HTML に
    #   cache-control: max-age=600 を付けるので、押した直後は古い HTML が出る。
    #   js/fresh.js がこの2つを突き合わせ、食い違ったら1回だけ読み直す
    h2 = re.sub(r'<meta name="build" content="\d*">', f'<meta name="build" content="{ver}">', h2)
    HTML.write_text(h2, encoding='utf-8')
    (HERE / 'version.txt').write_text(ver + '\n', encoding='utf-8')
    n_html = len(re.findall(r'\?v=\d+', h2))

    # 2) JS どうしの相対 import
    n_js = 0
    for f in list((HERE / 'js').glob('*.js')) + list((HERE / 'js' / 'lib').glob('*.js')):
        s = f.read_text(encoding='utf-8')
        s2 = re.sub(r"(from\s+'\.{1,2}/[^']+?\.js)(\?v=\d+)?'",
                    lambda m: f"{m.group(1)}?v={ver}'", s)
        if s2 != s:
            f.write_text(s2, encoding='utf-8')
        n_js += len(re.findall(r"from\s+'\.{1,2}/[^']+?\.js\?v=\d+'", s2))
    print(f'版 {ver} に統一: HTML {n_html} 箇所 / JS の import {n_js} 箇所')

if __name__ == '__main__':
    main()
