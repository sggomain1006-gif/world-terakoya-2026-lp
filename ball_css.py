#!/usr/bin/env python3
"""FV の覗き穴を「水晶玉」に見せる層を css/fv.css に生成する。

なぜスクリプトか:
    5層あわせて 100 を超えるカラーストップがある。手で直すと必ずどこかで
    単調性が崩れてグラデーションに段が出る。つまみは下の P だけにして、
    ストップは毎回ここから作り直す。生成範囲は fv.css の BALL:BEGIN 〜 BALL:END。

物理の根拠（lp-knowledge/04_engineering/physics/05_optics.md）:
  §2 Fresnel — 球を正面から見ると画面上の正規化半径 r での入射角は sinθ = r。
      Schlick F = F0 + (1-F0)(1-cosθ)^5、ガラス IOR 1.5 → F0 = 0.04。
      F(0.90)=0.095 / F(0.95)=0.188 / F(0.99)=0.489 / F(1.0)=1.0
      ＝光るのは外側 6% だけ。★太らせると水晶でなく真珠になる（実測で確認済み）。
  §6 Beer-Lambert — ガラスの色は色でなく「厚み × 吸収係数」。
      球の中を通る光路長は 2R√(1-r²) で、★縁でなく中心がいちばん厚い。
      縁を緑に濁らせる作りは物理的に逆。
  ボールレンズ — n=1.5 の球の焦点距離は EFL = nR/(2(n-1)) = 1.5R。
      遠景の像は実像で、上下左右とも反転する（＝180°回転）。中の像は拡大される。
      これが --vr（回転）と --vz（拡大）の根拠。

使い方:  python3 ball_css.py && python3 bump.py
"""
import math, io, re

P = dict(
    # --- 映像（水晶の中身） ---
    mask_core  = 0.93,   # 映像が不透明でいる半径。縁まで届かせる。下げると霜のような帯が出る
    mask_curve = 2.2,    # 落ちのカーブ。09-10 に決めた値

    # --- ガラスの身（Beer-Lambert） ---
    body_k     = 0.34,   # 吸収の強さ。中心がいちばん厚いので中心が濃くなる
    body_rgb   = "176,206,198",  # 水晶のわずかな青緑。0 にしたいなら body_k を 0 に

    # --- 全反射側の暗い帯 ---
    dark_at    = 0.955,  # 中心。縁のすぐ内側
    dark_w     = 0.035,  # 幅。広げると鏡餅になる
    dark_a     = 0.52,   # 濃さ

    # --- Fresnel の縁 ---
    rim_from   = 0.955,  # 立ち上がる半径。下げると太る
    rim_cap    = 0.97,   # 最大不透明度
    outline_px = 1.6,    # 輪郭の芯。水晶に見えるかはここがいちばん効く（下の ref_d のときの px）
    ref_d      = 203,    # 上の px 値を決めたときの直径。これで割って比率にする

    # --- 分散（色収差）。alche-study 由来の RGB 1:2:4 ---
    disp_unit  = 0.006,  # 1単位。R は 1、G は 2、B は 4 だけ内側へずらす
    disp_a     = 0.20,

    # --- 樽型の歪み（SVG の変位マップ。img/lens-map.png を生成する） ---
    warp_a     = 0.45,   # R(r)=r^(1+a)。大きいほど中心が拡大して縁が詰まる。0 で歪みなし
    warp_px    = 256,    # 変位マップの解像度。円の直径に対して十分

    # --- 環境の圧縮リング（レンズらしさの本体） ---
    env_from   = 0.875,  # リングの内側
    env_a      = 0.90,
)
F0 = 0.04
def fres(r):
    r = min(r, 1.0); c = math.sqrt(max(0.0, 1 - r*r))
    return F0 + (1-F0)*(1-c)**5

def _stops(pairs, ind="    "):
    out = []
    for i, (r, css) in enumerate(pairs):
        out.append(f"{ind}{css} {r*100:.2f}%" + (")" if i == len(pairs)-1 else ","))
    return "\n".join(out)

def mask_stops(ind="    ", n=10):
    core, curve = P["mask_core"], P["mask_curve"]
    out = [f"{ind}#000 0 {core*100:.0f}%,"]
    for k in range(1, n+1):
        r = core + (1-core)*k/n
        a = 1 - ((r-core)/(1-core))**curve
        out.append(f"{ind}transparent {r*100:.1f}%)" if k == n
                   else f"{ind}rgba(0,0,0,{a:.3f}) {r*100:.1f}%,")
    return "\n".join(out)

def body_stops(ind="    ", n=12):
    """ガラスの身。光路長 √(1-r²) に Beer-Lambert を掛ける。中心がいちばん濃い"""
    ps = []
    for k in range(0, n+1):
        r = k/n
        d = math.sqrt(max(0.0, 1 - r*r))
        a = (1 - math.exp(-P["body_k"]*d)) * 0.42
        ps.append((r, f"rgba({P['body_rgb']},{a:.3f})"))
    return _stops(ps, ind)

def dark_stops(ind="    ", n=16):
    lo = max(0.0, P["dark_at"] - 3.4*P["dark_w"])
    ps = [(lo, "transparent")]
    for k in range(1, n+1):
        r = lo + (1-lo)*k/n
        a = P["dark_a"] * math.exp(-((r-P["dark_at"])/P["dark_w"])**2)
        ps.append((r, f"rgba(10,6,5,{a:.3f})"))
    return _stops(ps, ind)

def rim_stops(ind="    ", n=10):
    lo = P["rim_from"]
    ps = [(lo, "transparent")]
    for k in range(1, n+1):
        r = lo + (1-lo)*k/n
        ps.append((r, f"rgba(255,252,247,{min(P['rim_cap'], fres(r)):.3f})"))
    return _stops(ps, ind)

def disp_ring(color, units, a):
    """分散の1本。単位 × units だけ内側にずらした細いリング"""
    off = P["disp_unit"] * units
    c0, c1, c2 = 1.0 - off - 0.016, 1.0 - off - 0.006, 1.0 - off
    return (f"radial-gradient(circle closest-side at 50% 50%,"
            f"transparent 0 {c0*100:.2f}%,rgba({color},{a:.3f}) {c1*100:.2f}%,"
            f"rgba({color},0) {c2*100:.2f}%)")

def write_lens_map():
    """樽型の変位マップを img/lens-map.png に書く。

    表示半径 r に対し元画像の R(r) = r^(1+a) を読む。R(0)=0・R(1)=1 で両端が固定されるので
    ★円の外を読まない（読むと縁が透明に欠ける）。R<r なので中心ほど拡大＝樽型。

    feDisplacementMap は P'(x,y) = P(x + scale*(R-0.5), y + scale*(G-0.5)) で参照する。
    変位を最大値で正規化して格納するので、JS 側は scale = 2 * maxd * (直径/2) を渡せばよい。
    その maxd を CSS の --lens-k に出して、JS はそれを1回だけ読む。
    """
    from PIL import Image
    a, n = P["warp_a"], P["warp_px"]
    rb = (1/(1+a))**(1/a)
    maxd = abs(rb**(1+a) - rb)
    im = Image.new("RGBA", (n, n), (128, 128, 0, 255))
    px = im.load()
    for j in range(n):
        v = (j + 0.5)/n*2 - 1
        for i in range(n):
            u = (i + 0.5)/n*2 - 1
            r = math.hypot(u, v)
            if r < 1e-6 or r > 1.0:
                px[i, j] = (128, 128, 0, 255); continue
            d = r**(1+a) - r                      # 負（内側へ寄る）
            dx, dy = d*(u/r)/maxd, d*(v/r)/maxd   # [-1,1] に正規化
            px[i, j] = (int(round((dx*0.5 + 0.5)*255)),
                        int(round((dy*0.5 + 0.5)*255)), 0, 255)
    im.save("img/lens-map.png")
    # data URI で埋めるので、そのままだと HTML が太る。あれば可逆圧縮を掛ける
    import shutil, subprocess
    if shutil.which("oxipng"):
        subprocess.run(["oxipng", "-o", "4", "--strip", "safe", "-q", "img/lens-map.png"], check=False)
    return maxd


def build():
    mask = "radial-gradient(circle closest-side,\n" + mask_stops() + ";"

    body = (".fv-scope__rim{position:absolute;inset:0;pointer-events:none;opacity:var(--rim-a,1);\n"
            "  /* 上から順に重なる。\n"
            "     1本目＝全反射側の暗い帯。縁のすぐ内側がいちばん暗い。純黒で締めない（締めると穴に戻る）。\n"
            "     2本目＝球の立体。主光源のある左上を持ち上げ、反対の右下を落とす。\n"
            "       ★これが無いと、正しく作っても『ガラスの円盤』にしか見えない（中が一様に明るいため）。\n"
            "     3本目＝ガラスの身（Beer-Lambert）。球の中を通る光路長は 2R√(1-r²) なので\n"
            "       ★縁でなく中心がいちばん厚い。縁を緑に濁らせる作りは物理的に逆 */\n"
            "  background:\n"
            "    radial-gradient(circle closest-side at 50% 50%,\n" + dark_stops() + ",\n"
            "    linear-gradient(135deg,rgba(255,252,246,.13) 0%,rgba(255,252,246,.04) 26%,"
            "rgba(255,252,246,0) 42%,rgba(10,6,5,.06) 60%,rgba(10,6,5,.15) 80%,rgba(10,6,5,.24) 100%),\n"
            "    radial-gradient(circle closest-side at 50% 50%,\n" + body_stops() + "}")

    env = ("/* 圧縮された周囲の映り込み。球の縁では背景が細い輪へ潰れて入る。\n"
           "   ★レンズに見えるかどうかの本体。しかも実像なので上下が逆＝空は輪の「下」に出る。\n"
           "   ★もう1つの役目は「縁の明るさを角度で変えること」。一定の明るさで1周させると\n"
           "     水晶でなくポータルの輪に見える（実測で確認）。主光源のある左上を白く、\n"
           "     反対の右下に回り込みの弱い光、上は地面（反転）で暗く、下は空で青い */\n"
           ".fv-scope__lens{position:absolute;inset:0;border-radius:inherit;pointer-events:none;\n"
           "  opacity:calc(var(--rim-a,1) * %.2f);\n"
           "  background:conic-gradient(from 0deg at 50%% 50%%,\n"
           "    rgba(46,24,20,.88) 0deg, rgba(70,38,30,.74) 42deg, rgba(150,124,108,.56) 84deg,\n"
           "    rgba(236,231,223,.80) 118deg, rgba(176,212,244,.94) 162deg, rgba(186,220,248,.98) 180deg,\n"
           "    rgba(176,212,244,.94) 198deg, rgba(198,194,188,.64) 242deg, rgba(255,253,248,.99) 302deg,\n"
           "    rgba(255,253,248,.92) 326deg, rgba(120,72,54,.74) 350deg, rgba(46,24,20,.88) 360deg);\n"
           "  -webkit-mask-image:radial-gradient(circle closest-side,transparent 0 %.2f%%,rgba(0,0,0,.55) %.2f%%,#000 %.2f%%,#000 99.3%%,transparent 100%%);\n"
           "          mask-image:radial-gradient(circle closest-side,transparent 0 %.2f%%,rgba(0,0,0,.55) %.2f%%,#000 %.2f%%,#000 99.3%%,transparent 100%%)}"
           ) % (P["env_a"], P["env_from"]*100, (P["env_from"]+0.030)*100, (P["env_from"]+0.058)*100,
                P["env_from"]*100, (P["env_from"]+0.030)*100, (P["env_from"]+0.058)*100)

    edge = ("/* Fresnel の縁と輪郭の芯、そして分散。\n"
            "   Schlick を r=%.3f〜1.00 に実数で置いた。外側 %.1f%% だけが光る。\n"
            "   ★輪郭の芯（inset の %.1fpx）が水晶に見えるかの決め手。これが無いと霜のドームになる。\n"
            "   分散は RGB を 1:2:4 でずらす（青がいちばん強く曲がる）*/\n"
            ".fv-scope__edge{position:absolute;inset:0;border-radius:inherit;pointer-events:none;\n"
            "  opacity:var(--rim-a,1);\n"
            "  /* ★px 固定にしない。玉は 6.4vw〜画面対角まで 40倍近く伸縮するので、\n"
            "     固定値だと小さいときに輪郭と内側の光が玉を塗りつぶして白い粒になる。\n"
            "     直径 %.0fpx のときの見え方を基準に比率へ直した（下限だけ 0.8px で残す）*/\n"
            "  box-shadow:inset 0 0 0 clamp(.8px,calc(var(--scope-d,52vw) * %.5f),3px) rgba(255,253,250,.92),\n"
            "             inset 0 0 calc(var(--scope-d,52vw) * %.5f) calc(var(--scope-d,52vw) * %.5f) rgba(255,250,242,.34);\n"
            "  background:\n"
            "    %s,\n    %s,\n    %s,\n"
            "    radial-gradient(circle closest-side at 50%% 50%%,\n"
            ) % (P["rim_from"], (1-P["rim_from"])*100, P["outline_px"], P["ref_d"],
                 P["outline_px"]/P["ref_d"], P["outline_px"]*5.5/P["ref_d"], P["outline_px"]*1.2/P["ref_d"],
                 disp_ring("255,72,48", 1, P["disp_a"]),
                 disp_ring("86,255,132", 2, P["disp_a"]*0.72),
                 disp_ring("64,150,255", 4, P["disp_a"])) + rim_stops() + "}"

    glass = ("/* 光源の映り込み。球は曲率が強いので光源は小さく鋭く写る。\n"
             "   1本目＝主光源の芯（ほぼ白飛び）。2本目＝その滲み。\n"
             "   3本目＝裏面で1回反射して戻る像（主光源の反対側に小さく暗く出る。ガラスの厚みの証拠）。\n"
             "   4本目＝下へ回り込む戻り光。★ここを広げると一気に濁って真珠になる */\n"
             ".fv-scope__glass{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:var(--rim-a,1);\n"
             "  background:\n"
             "    radial-gradient(ellipse 5.4% 4.0% at 29% 20%,rgba(255,255,255,1),rgba(255,255,254,.72) 48%,rgba(255,255,254,0) 80%),\n"
             "    radial-gradient(ellipse 13% 9.5% at 30% 21%,rgba(255,252,246,.20),rgba(255,252,246,0) 76%),\n"
             "    radial-gradient(ellipse 2.4% 1.8% at 66% 74%,rgba(255,248,236,.52),rgba(255,248,236,0) 84%),\n"
             "    radial-gradient(ellipse 24% 16% at 70% 80%,rgba(255,238,209,.10),rgba(255,238,209,0) 74%)}")

    maxd = write_lens_map()
    lens_k = (".fv-scope{--lens-k:%.5f}  /* 変位マップの最大変位（半径比）。JS が scale を組み立てる */"
              % maxd)
    return mask, "\n".join([lens_k, body, env, edge, glass])

H_BEGIN = "<!-- ==== BALL:BEGIN  ball_css.py が生成。手で直さない ==== -->"
H_END   = "<!-- ==== BALL:END ==== -->"

def write_filter_html():
    """樽型の SVG フィルタを index.html の末尾に書く。

    ★変位マップは data URI で埋める。外部ファイル参照にすると、読み込みに失敗したときに
      feDisplacementMap の in2 が透明（R=G=0）になり、変位が -scale/2 の一定値になって
      映像全体がずれる。原因の分かりにくい壊れ方なので、そもそも読み込みを発生させない。
    """
    import base64
    b64 = base64.b64encode(io.open("img/lens-map.png", "rb").read()).decode()
    svg = (H_BEGIN + "\n"
           '<svg width="0" height="0" aria-hidden="true" focusable="false"\n'
           '     style="position:absolute;width:0;height:0;overflow:hidden">\n'
           '  <filter id="ballLens" color-interpolation-filters="sRGB">\n'
           '    <feImage preserveAspectRatio="none" x="0" y="0" width="100%" height="100%"\n'
           '             href="data:image/png;base64,' + b64 + '" result="lensMap"/>\n'
           '    <feDisplacementMap in="SourceGraphic" in2="lensMap"\n'
           '                       xChannelSelector="R" yChannelSelector="G" scale="0"/>\n'
           '  </filter>\n'
           "</svg>\n" + H_END)
    h = io.open("index.html", encoding="utf-8").read()
    if H_BEGIN in h:
        import re as _re
        h = _re.sub(_re.escape(H_BEGIN) + r"[\s\S]*?" + _re.escape(H_END), lambda _: svg, h, count=1)
    else:
        assert h.count("</body>") == 1
        h = h.replace("</body>", svg + "\n</body>")
    io.open("index.html", "w", encoding="utf-8").write(h)
    print("index.html: 変位マップ入りフィルタを書いた（base64 %.1fKB）" % (len(b64)/1024))


BEGIN = "/* ==== BALL:BEGIN  ball_css.py が生成。手で直さない（つまみは ball_css.py の P）==== */"
END   = "/* ==== BALL:END ==== */"

def main():
    path = "css/fv.css"
    s = io.open(path, encoding="utf-8").read()
    mask, block = build()

    pat_mask = r"radial-gradient\(circle closest-side,\n(?:\s+(?:#000|rgba\(0,0,0|transparent)[^\n]*\n)+"
    n = len(re.findall(pat_mask, s))
    assert n == 2, f"マスクの一致数が {n}（期待 2: -webkit- と標準）"
    s = re.sub(pat_mask, lambda _: mask + "\n", s)

    if BEGIN in s:
        s = re.sub(re.escape(BEGIN) + r"[\s\S]*?" + re.escape(END),
                   lambda _: BEGIN + "\n" + block + "\n" + END, s, count=1)
    else:
        # 初回。既存の3ブロックを取り除いて、その場所に生成範囲を作る
        for pat, label in [
            (r"\.fv-scope__rim\{[\s\S]*?\}", "rim"),
            (r"/\* Fresnel の明るい縁[\s\S]*?\.fv-scope__edge\{[\s\S]*?\}", "edge"),
            (r"/\* 光源そのものの映り込み[\s\S]*?\.fv-scope__glass\{[\s\S]*?\}", "glass"),
        ]:
            assert len(re.findall(pat, s)) == 1, f"初回置換で {label} が一意でない"
            s = re.sub(pat, lambda _: "\x00", s, count=1)
        first = s.index("\x00")
        s = s[:first] + BEGIN + "\n" + block + "\n" + END + s[first+1:]
        s = s.replace("\x00\n", "").replace("\x00", "")
    io.open(path, "w", encoding="utf-8").write(s)
    write_filter_html()
    print("生成:", ", ".join(f"{k}={v}" for k, v in P.items()))

if __name__ == "__main__":
    main()
