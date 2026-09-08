/* =============================================================================
   eye.js — FV の「目」

   ポートフォリオ（Desktop/Web制作/ポートフォリオ/_proto/index.html の目玉モジュール）
   から移植した。球の幾何・瞬き・首振り・視線・睨み・呼吸の演技はそのまま。
   変えたのは次の3点だけ:
     ① 画面いっぱいの固定 canvas → FV の中に置く小さな canvas（大きさは呼び出し側）
     ② スクロール位置で場所を移す place() → 箱の中央に固定
     ③ 視線の合わせ先を、このLPの FV の要素（リード・申込ボタン・日程）に向けた
   テクスチャは img/eye_equirect.webp（正距円筒の1枚。球は JS で作るので GLB は要らない）
   ============================================================================= */

export function initEye({ canvas: cv, reduceMotion = false } = {}) {

  if (!cv) return null;
  var gl = cv.getContext('webgl2', {alpha:true, premultipliedAlpha:false, antialias:true, depth:false});
  if (!gl) { cv.style.display = 'none'; return null; }
  var PRM = reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  function sh(t, src){
    var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  var P = new Float32Array(16);
  function persp(fovy, aspect, near, far){
    var f = 1 / Math.tan(fovy / 2); P.fill(0);
    P[0]=f/aspect; P[5]=f; P[10]=(far+near)/(near-far); P[11]=-1; P[14]=(2*far*near)/(near-far);
  }
  var dirty = true, raf = 0;
  function kick(){ if(!raf) raf = requestAnimationFrame(frame); }

  /* ============================================================
     目玉の球。円相の消失点に置いて、スクロールのあいだ常に見えている。
     ★幾何は JS で作る。UV球は数式で書けるので GLB を配る必要がない
       （Blender 版 models/eye_ball_geo.glb は 265KB。ここでは 0 バイト）。
       配るのはテクスチャ1枚（images/eye_equirect.webp・151KB）だけ。
     ★深度バッファが無い（context は depth:false）ので、
       ①裏面はシェーダーで捨てる ②粒より先に描いて、粒に上を通させる。
       結果として「粒の向こうに大きな目がある」ように見える。
     ============================================================ */
  var EYE = {
    /* 画面上の直径[px] = r / (0.5206 * dist) * 画面高
       ★小さいと粒の密度に負けて「暗い染み」にしか見えない。実測で 37% では潰れ、
         54%（dist15 / r4.2 → 430px）でようやく目として読める */
    dist:  15.0,   /* カメラからの距離。近づけるほど画面で大きくなる */
    /* r / x / y は画面幅で切り替える（resize() が入れる）。
       画面上のずれ[px] = 単位 * 1.9209 * 画面高 / (2 * dist) */
    r:      4.2,   /* 半径 */
    x:      5.0,   /* 右へずらす量。PCは右に寄せる */
    y:      1.6,   /* 上へずらす量 */
    dim:   0.97,   /* 全体の濃さ。円相の霞に馴染ませるため少しだけ透かす */
    /* ★球としての動き。瞬きや視線とは別に、球そのものが動く */
    drift: 0.30,   /* 漂う量[単位]。ゆっくり8の字を描いて浮く（1280x800で横±15px） */
    tumble:0.075,  /* ゆっくり向きを変える量[rad]。周期の違う波を重ねて反復に見せない */
    breath:0.035,  /* わずかに大きさが呼吸する割合 */
    idle:  5.6     /* 触られていないときに瞬きする間隔[秒]。0で「スクロール時のみ」 */
  };
  window.__eye = EYE;   /* コンソールから詰められるようにする（window.__fvRot と同じ流儀） */
  /* ★何pxスクロールするごとに1回瞬くか */
  var BLINK_EVERY = 880;
  var BLINK_DUR = 0.34;                   /* 1回の瞬きにかける秒数 */

  function sm(x){ x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); }
  /* 閉じるのは速く、開くのはゆっくり。等速だと機械の絞りに見える */
  function blinkShape(x){ return x < 0.34 ? sm(x/0.34) : 1 - sm((x-0.34)/0.66); }

  /* ★スクロール位置は「引き金」だけに使い、瞬き自体は実時間で演じる。
     進捗そのものを瞬きの時間軸にすると、速く送れば一瞬で終わり、ゆっくり送れば
     間延びして、同じ演出に見えない。跨いだ点で発火させれば速度によらず一定になる。
     戻り方向に跨いだときも発火するので、行き来しても反応する */
  function frac(x){ return x - Math.floor(x); }
  function hash(n){ return frac(Math.sin(n * 127.1) * 43758.5453); }

  var blinkPh = 2, lastIdx = -1, lastT = -1, idleAcc = 0;
  /* ★視線手がかり効果（gaze cueing）を使う。
     人は見られている方向へ反射的に注意を向ける（約100msで発動）。
     さらに「直視」はそれ自体が注意を捕捉する。
     そこで FV では 直視で捕まえる → キャッチコピーへ落とす → CTA へ送る
     の順で見る。乱数のサッカードでは、この最強の誘導装置を遊ばせることになる。 */
  var LOOK = [
    {sel:null,           hold:1.7},   /* 直視。まずこちらを捕まえる */
    {sel:'.fv__lead',    hold:2.6},   /* リード文へ */
    {sel:null,           hold:0.9},
    {sel:'.fv__ctas .btn', hold:2.2}, /* 申し込みボタンへ送る */
    {sel:'.fv__meta',    hold:1.6}    /* 日程へ */
  ];
  var lookI = 0, lookAcc = 0;
  function lookTarget(cx, cy, rpx){
    var L = LOOK[lookI % LOOK.length];
    if(!L.sel) return [0, 0];                       /* 直視 */
    var el = document.querySelector(L.sel);
    if(!el) return [0, 0];
    var r = el.getBoundingClientRect();
    if(r.width < 1) return [0, 0];
    var vx = (r.left + r.width * 0.5) - cx, vy = (r.top + r.height * 0.5) - cy;
    var m = Math.hypot(vx, vy) || 1;
    /* 目の中で瞳が動ける範囲は狭いので、方向だけ使って振れ幅は固定する */
    var A = 0.085;
    return [ (vx / m) * A, -(vy / m) * A ];          /* 画面のyは下向き、絵のyは上向き */
  }

  var gz = [0,0], gzT = [0,0], mic = [0,0];
  var accG = 9, accMic = 0, accGl = 0, accTr = 0, sacc = 0, micro = 0, pupRelax = 9;
  EYE.turn = [0,0]; EYE.gaze = [0,0]; EYE.glare = 0; EYE.b = 0; EYE.pupil = 1; EYE.flut = 1; EYE.breathNow = 1;

  /* ★1フレームぶんの「生きている感じ」をまとめて進める。
     瞬き・首振り・視線・睨み・震えを1か所で持つ（dt を各所で数えないため） */
  function eyeTick(p, tsec){
    if(PRM){ EYE.b = 0; EYE.turn[0] = EYE.turn[1] = 0; EYE.gaze[0] = EYE.gaze[1] = 0;
             EYE.glare = 0; EYE.pupil = 1; EYE.flut = 0; EYE.breathNow = 1; return; }
    /* 調整用。window.__eye.freeze = true にすると値の更新を止めるので、
       コンソールから b / glare / pupil を直接置いて見た目を確かめられる */
    if(EYE.freeze) return;
    var dt = (lastT < 0) ? 0 : Math.min(0.05, Math.max(0, tsec - lastT));

    EYE.b = blinkStep(p, tsec, dt);

    /* ★視線は2層で作る。人の目が「ぎょろぎょろ」して見えるのは、
       大きく跳ぶ主サッカードと、止まっている間も細かく震える微細サッカードの
       二重構造だから。片方だけだと、のっぺりするか痙攣して見える。
       いずれも「速く跳んで止まる」＝滑らかに動かさないのが要点 */
    if(EYE.aim){
      /* ★FVでは意味のある順に見る。乱数でなく要素を狙う */
      lookAcc += dt;
      if(lookAcc > LOOK[lookI % LOOK.length].hold){ lookAcc = 0; lookI++; }
      EYE.look = lookI % LOOK.length;   /* 確認用: いま何を見ているか */
      var tg = lookTarget(EYE.cx, EYE.cy, EYE.sr * W);
      gzT[0] = tg[0]; gzT[1] = tg[1];
    }else{
      accG += dt;
      var iv = 0.62 + hash(sacc * 3.7) * 1.5;      /* 0.62〜2.1秒。間隔も一定にしない */
      if(accG > iv){
        accG = 0; sacc++;
        var big = hash(sacc * 5.1) > 0.62;         /* たまに大きく振る */
        var amp = big ? 0.20 : 0.105;
        gzT[0] = (hash(sacc) - 0.5) * amp;
        gzT[1] = (hash(sacc + 91.3) - 0.5) * amp * 0.62;
      }
    }
    accMic += dt;
    if(accMic > 0.16 + hash(sacc * 11.3 + micro) * 0.22){
      accMic = 0; micro++;
      mic[0] = (hash(micro * 2.3) - 0.5) * 0.019;
      mic[1] = (hash(micro * 7.9) - 0.5) * 0.013;
    }
    var k = 1 - Math.pow(0.001, dt / 0.085);       /* 跳ぶ速さ。人の眼球運動は速い */
    gz[0] += (gzT[0] + mic[0] - gz[0]) * k;
    gz[1] += (gzT[1] + mic[1] - gz[1]) * k;
    /* ★ベル現象: 瞬きのあいだ眼球はわずかに上を向く。これが無いと瞼だけが動いて見える */
    EYE.gaze[0] = gz[0];
    EYE.gaze[1] = gz[1] + EYE.b * 0.028;

    /* ★瞳孔。ゆっくりした呼吸のような開閉に、瞬き直後の一瞬の開きを足す。
       まったく動かないと生き物に見えない */
    pupRelax += dt;
    if(EYE.b > 0.6) pupRelax = 0;                  /* 瞬いたら開き直す */
    var after = Math.exp(-pupRelax / 0.75) * 0.16;
    EYE.pupil = 1.0 + Math.sin(tsec * 0.47) * 0.055 + Math.sin(tsec * 1.13 + 1.2) * 0.022
                + after - EYE.glare * 0.22;        /* 睨むときは縮む */

    /* 睨み。11秒ごとに1.8秒だけ、上まぶたを途中まで下ろして保つ */
    accGl += dt;
    var cg = accGl % 11.0;
    EYE.glare = cg < 1.8 ? Math.sin(cg / 1.8 * Math.PI) * 0.34 : 0;

    /* 震え。7.5秒ごとに0.45秒だけ、高い周波数で細かく揺らす */
    accTr += dt;
    var ct = accTr % 7.5;
    var tr = ct < 0.45 ? Math.sin(ct / 0.45 * Math.PI) : 0;
    var jit = tr * 0.013 * Math.sin(tsec * 58.0);

    /* 首振り。ゆっくりした漂い＋視線に少し追従＋震え。
       合計でも 0.14rad（約8度）程度に収まるので、正面から外れて見えなくならない */
    /* ★球としての向きの変化。周期の違う2つの波を重ねると、
       単一の正弦のような「行ったり来たり」に見えず、ゆっくり漂うように見える。
       合計でも 0.2rad（約11度）程度なので、正面から外れて目が見えなくなることはない */
    EYE.turn[0] = Math.sin(tsec * 0.21) * 0.085
                + Math.sin(tsec * 0.083 + 1.1) * EYE.tumble + gz[0] * 0.9 + jit;
    EYE.turn[1] = Math.sin(tsec * 0.17 + 2.1) * 0.055
                + Math.sin(tsec * 0.061 + 0.4) * EYE.tumble * 0.66 + gz[1] * 0.7 + jit * 0.6;
    /* 呼吸。止まった球は模型に見えるので、ごくわずかに膨らませる */
    EYE.breathNow = 1 + Math.sin(tsec * 0.29 + 0.8) * EYE.breath;
  }

  function blinkStep(p, tsec, dt){
    /* ★経過時間は必ず刻む。壁時計で「開始からの経過」を引くと、1フレームが
       BLINK_DUR を超える環境で瞬きが1度も描かれずに飛ぶ（実測で6回中4回が消えた）。
       dt を 0.05秒で頭打ちにすれば、重い端末では遅く見えるだけで必ず全部演じる。
       dt は eyeTick が刻んで渡す */
    lastT = tsec;

    /* p は「スクロール量 / BLINK_EVERY」。またぐたびに1回発火する。
       サイト全体では進捗の固定6点では足りないので、距離で刻む */
    var idx = Math.floor(p);
    if(idx !== lastIdx){ blinkPh = 0; idleAcc = 0; lastIdx = idx; }

    /* スクロールを止めても絵が死なないよう、間が空いたら自分から瞬く
       （粒の「止めても揺れる」と同じ考え） */
    idleAcc += dt;
    if(EYE.idle > 0 && idleAcc > EYE.idle){ blinkPh = 0; idleAcc = 0; }

    if(blinkPh > 1) return 0;
    var b = blinkShape(blinkPh);
    blinkPh += dt / BLINK_DUR;
    return b;
  }

  /* UV球。u=経度 / v=緯度 の正距円筒。u=0.5 が +Z（＝カメラ側）を向く */
  function makeSphere(seg, ring){
    var pos = [], uv = [], idx = [], x, y;
    for(y=0; y<=ring; y++){
      var phi = y/ring * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
      for(x=0; x<=seg; x++){
        var u = x/seg, th = (u - 0.5) * Math.PI * 2;
        pos.push(sp*Math.sin(th), cp, sp*Math.cos(th));
        uv.push(u, 1 - y/ring);           /* 画像の上を球の上に */
      }
    }
    for(y=0; y<ring; y++){
      for(x=0; x<seg; x++){
        var a = y*(seg+1)+x, b2 = a+seg+1;
        idx.push(a, b2, a+1, a+1, b2, b2+1);
      }
    }
    return {pos:new Float32Array(pos), uv:new Float32Array(uv), idx:new Uint16Array(idx)};
  }

  var EYE_VS = `#version 300 es
  in vec3 aPos; in vec2 aUv;
  uniform mat4 uProj; uniform vec3 uCenter; uniform float uR;
  uniform vec2 uTurn;               /* 首振り（yaw, pitch）。ラジアン */
  uniform vec2 uShift;              /* 画面上のずらし（NDC）。★ここが真円を保つ鍵 */
  out vec2 vUv; out vec3 vN; out vec3 vP;
  vec3 rotY(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z); }
  vec3 rotX(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(p.x, c*p.y-s*p.z, s*p.y+c*p.z); }
  void main(){
    /* ★球ごと回す。UV は頂点に付いているので、絵もいっしょに回る。
       振り幅を小さく保てば、目が正面から外れて見えなくなることはない */
    vec3 q = rotX(rotY(aPos, uTurn.x), uTurn.y);
    vN = normalize(q);
    vP = uCenter + q * uR;
    vUv = aUv;
    /* ★球は必ず光軸上（uCenter.xy = 0）に置き、投影したあとに画面上でずらす。
       ワールド座標で横へ動かすと、透視投影は光軸から外れた球を「楕円」に写す。
       x=-9.6 / dist=15 は光軸から32.6度も外れるので、はっきり潰れて見えていた。
       w を掛けないとクリップ空間でずれない（棒の uNudge と同じ） */
    gl_Position = uProj * vec4(vP, 1.0);
    gl_Position.xy += uShift * gl_Position.w;
  }`;

  var EYE_FS = `#version 300 es
  precision highp float;
  in vec2 vUv; in vec3 vN; in vec3 vP;
  uniform sampler2D uTex; uniform float uBlink; uniform float uFade;
  uniform vec2 uGaze;               /* 瞳の移動。絵の中の座標系でのずれ */
  uniform float uGlare;             /* 睨み。上まぶたを途中まで下ろしたまま保つ */
  uniform float uPupil;             /* 瞳孔の開き。1=そのまま >1で開く <1で縮む */
  uniform float uTime;              /* まつげの揺らぎ用 */
  uniform float uFlut;              /* まつげの揺らぎの強さ */
  out vec4 o;
  /* 目の絵がテクスチャ上で占める矩形。build_eye_texture.py の EYE_W_RATIO と揃える */
  const float EW = 0.2998;
  const float EH = 0.4072;
  /* ★絵の中の位置。0=絵の上端 / 1=下端。すべて eye.png の輝度プロファイルから実測。
     瞳孔を通る縦線で、開口は y 0.26〜0.52、下まぶたは 0.53 から明るくなる */
  /* ★白目が出ている行を耳側で走査して求めた実測値。ここが命。
     0.28（まつげの束の途中）で切ると、まつげが横一文字に断ち切られて段差が見える。
     0.335＝まつげの先端＝まぶたの縁で切ると、切り口が不揃いなまつげ先端に隠れる */
  const float LID_OPEN = 0.335;  /* 開いているときの上まぶたの縁 */
  const float LID_SHUT = 0.598;  /* 閉じたとき＝下まぶたの縁に接する。
                                    以前 0.69 にしていたのが「ゆっくり瞬きの違和感」の主因で、
                                    まぶたが下まぶたを越えて頬まで滑っていた */
  const float LID_LOW  = 0.598;  /* 下まぶたの縁 */
  const vec2  IRIS = vec2(0.412, 0.537);  /* 瞳孔の中心（e座標。y は下から） */
  const float PUP_R = 0.0536;    /* 瞳孔の半径（絵の幅に対する比） */
  const float EASP  = 0.679;     /* 570/840。e座標のyを幅と同じ尺へ直す係数 */
  void main(){
    /* ★深度バッファが無いので、裏側の面は自分で捨てる。
       面の巻き方に依存しないよう、法線と視線の向きで判定する */
    if(dot(vN, normalize(vP)) > 0.0) discard;

    /* 目の絵の中のローカル座標（0..1）。t は絵の上端からの距離 */
    vec2 e = vec2((vUv.x-0.5)/EW + 0.5, (vUv.y-0.5)/EH + 0.5);
    float t = 1.0 - e.y;

    /* ★瞬きは「上まぶたを下へずらす」だけで作る。閉じた絵は要らない。
       まぶたより上を丸ごと下へ平行移動すると、睫毛が伸びずにそのまま降りてくる。
       縁で急に切れると縦の継ぎ目が出るので、横方向に減衰させる。
       減衰のおかげで、まぶたの線が中央で低く両端で高い＝自然な弧を描く */
    float wx = 1.0 - smoothstep(0.36, 0.50, abs(e.x - 0.5));
    float wy = smoothstep(-0.05, 0.06, e.y) * (1.0 - smoothstep(0.94, 1.05, e.y));
    /* 睨みは「途中まで閉じたまま保つ」＝瞬きと同じ仕組みを浅く効かせる */
    float close = max(uBlink, uGlare);

    /* ★まつげの揺らぎ。まぶたの縁を x 方向に波打たせる。閉じるほど収まる */
    float flut = uFlut * (1.0 - close) * 0.009 *
                 (sin(e.x * 21.0 + uTime * 5.1) * 0.6 + sin(e.x * 37.0 - uTime * 3.3) * 0.4);
    /* ★まぶたの縁は水平な直線ではなく弧。中央がいちばん下がり、目頭・目尻は下がらない。
       一定量で下ろすと真横一直線の段差になり、シャッターにしか見えない */
    float ax  = clamp(abs(e.x - 0.5) * 2.0, 0.0, 1.0);
    float arc = 1.0 - 0.44 * ax * ax;
    float closeX = close * arc * wy;
    float lid = mix(LID_OPEN, LID_SHUT, closeX) + flut;

    /* ★上まぶたは「平行移動」でなく「圧縮しながら下ろす」。
       まぶたが眼球の上を転がると、まつげは手前へ倒れて短く見える（前縮み）。
       平行移動だけだと帯がそのまま滑るので、ゆっくり閉じたとき作り物に見える */
    float comp  = 1.0 - 0.36 * closeX;
    float tsLid = max(0.0, LID_OPEN - (lid - t) / max(0.30, comp));
    /* ★下まぶたも少し持ち上がる。上だけ動くと「蓋」に見える */
    float low   = smoothstep(LID_LOW - 0.10, LID_LOW + 0.06, t);
    float tsOpen = t + (LID_SHUT - LID_OPEN) * 0.16 * closeX * low;
    /* 縁は数千分の一だけ跨いで混ぜる。切り替えを固くするとジャギーな段差が出る */
    float ts = mix(tsLid, tsOpen, smoothstep(lid - 0.004, lid + 0.004, t));
    vec2 ee = vec2(e.x, 1.0 - ts);

    /* ★視線。虹彩の中心まわりだけガウスで引っぱる。
       まぶたを動かしたあとの座標に掛けるので、まぶたの線は歪まない。
       e座標は縦横で尺が違うので、距離は幅の尺に揃えてから測る */
    vec2 rel = ee - IRIS;
    vec2 relW = vec2(rel.x, rel.y * EASP);
    ee -= uGaze * exp(-dot(relW, relW) / (0.155 * 0.155));

    /* ★瞳孔の開き。瞳孔の中心まわりだけ拡大／縮小する。
       中心ほど強く効かせ、半径の2.4倍で元に戻すので虹彩の外周は歪まない */
    rel  = ee - IRIS;
    relW = vec2(rel.x, rel.y * EASP);
    float ks = mix(1.0 / max(0.40, uPupil), 1.0,
                   smoothstep(0.0, 1.0, clamp(length(relW) / (PUP_R * 2.4), 0.0, 1.0)));
    ee = IRIS + rel * ks;

    vec2 uv2 = vec2((ee.x - 0.5) * EW + 0.5, (ee.y - 0.5) * EH + 0.5);

    vec3 base = texture(uTex, uv2).rgb;
    /* ★半ランバート。max(0.0, dot) のクランプは dot=0 の大円で勾配が折れ、
       球の上に「直線の境目」として出る（実際にそう見えていた）。
       0.5*dot+0.5 は折れがどこにも無いので境目が生まれない */
    vec3 L = normalize(vec3(-0.38, 0.46, 0.80));
    float lam = 0.47 + 0.60 * pow(0.5 * dot(vN, L) + 0.5, 1.45);
    /* 縁は締める。明るいリムを足すと光の輪に見えて球が発光してしまう */
    float edge = 1.0 - 0.30 * pow(1.0 - max(0.0, vN.z), 3.0);
    /* 非premultiplied の文脈なので、色にアルファを掛けない（罠12と対） */
    o = vec4(base * lam * edge, uFade);
  }`;

  var eyeProg = null, eyeVao = null, eyeTex = null, eyeCount = 0, EU = {};
  (function initEye(){
    try{ eyeProg = (function(){
      var pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, EYE_VS));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, EYE_FS));
      ['aPos','aUv'].forEach(function(n,i){ gl.bindAttribLocation(pr, i, n); });
      gl.linkProgram(pr);
      if(!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      return pr;
    })(); }catch(e){ eyeProg = null; return; }

    var S = makeSphere(96, 48);
    eyeCount = S.idx.length;
    eyeVao = gl.createVertexArray(); gl.bindVertexArray(eyeVao);
    function ab(data, loc, size){
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    ab(S.pos, 0, 3); ab(S.uv, 1, 2);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, S.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    ['uProj','uCenter','uR','uTex','uBlink','uFade','uTurn','uGaze','uGlare',
     'uPupil','uTime','uFlut','uShift'].forEach(function(n){
      EU[n] = gl.getUniformLocation(eyeProg, n);
    });

    /* テクスチャ。読み込み前でも描けるよう、まず下地の色1pxを入れておく */
    eyeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, eyeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                  new Uint8Array([167,133,119,255]));   /* 目の下の肌の色 */
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);       /* 経度は一周する */
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);/* 極ははみ出させない */
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    var im = new Image();
    im.onload = function(){
      gl.bindTexture(gl.TEXTURE_2D, eyeTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   /* v=1 を画像の上に */
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);  /* 他の読み込みに漏らさない */
      dirty = true; kick();
    };
    im.src = 'img/eye_equirect.webp';
  })();

  function drawEye(p, tsec){
    if(!eyeProg) return;
    gl.useProgram(eyeProg);
    gl.bindVertexArray(eyeVao);
    gl.uniformMatrix4fv(EU.uProj, false, P);
    /* ★漂い。縦の周期を横のちょうど2倍にすると8の字になり、
       直線を往復しているようには見えない（リサージュ） */
    var dx = PRM ? 0 : Math.sin(tsec*0.155) * EYE.drift;
    var dy = PRM ? 0 : Math.sin(tsec*0.310 + 1.7) * EYE.drift * 0.55;
    gl.uniform3f(EU.uCenter, 0, 0, -EYE.dist);
    /* 単位→NDC。従来の見た目の位置をそのまま保つ換算:
       画面px = 単位 * 1.9209 * H / (2*dist) なので、NDCは x が /(W/2)、y が /(H/2) */
    var f = 1.9209 / EYE.dist;
    /* 画面比→NDC。半径は逆算してワールド単位へ戻す（画面px = r*f*H/2 なので r = sr*W*2/(f*H)） */
    EYE.r = (EYE.sr * W) * 2 / (f * H) * (EYE.breathNow || 1);
    gl.uniform2f(EU.uShift, (2*EYE.sx - 1) + dx*f*H/W, (1 - 2*EYE.sy) + dy*f);
    gl.uniform1f(EU.uR, EYE.r);
    eyeTick(p, tsec);                    /* 瞬き・首振り・視線・睨み・震えを進める */
    gl.uniform1f(EU.uBlink, EYE.b);      /* 0=開 1=閉。確認用に window.__eye.b で読める */
    gl.uniform2f(EU.uTurn,  EYE.turn[0], EYE.turn[1]);
    gl.uniform2f(EU.uGaze,  EYE.gaze[0], EYE.gaze[1]);
    gl.uniform1f(EU.uGlare, EYE.glare);
    gl.uniform1f(EU.uPupil, EYE.pupil);
    gl.uniform1f(EU.uTime,  tsec);
    gl.uniform1f(EU.uFlut,  EYE.flut);
    gl.uniform1f(EU.uFade, EYE.dim);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, eyeTex);
    gl.uniform1i(EU.uTex, 0);
    gl.drawElements(gl.TRIANGLES, eyeCount, gl.UNSIGNED_SHORT, 0);
  }



  /* ---------- 置き場所。箱の中央に固定する ----------
     元は画面をスクロールに合わせて渡り歩いていたが、ここでは FV の中の
     決まった場所に居るだけなので、中央・一定の大きさでよい */
  function place(){
    EYE.sx = 0.5; EYE.sy = 0.5; EYE.sr = 0.415; EYE.dim = 1;
    var r = cv.getBoundingClientRect();
    EYE.cx = r.left + r.width * 0.5;   /* 視線の計算は画面の座標で行う */
    EYE.cy = r.top + r.height * 0.5;
    EYE.aim = true;
  }

  /* ---------- 画面と描画ループ ---------- */
  var dpr = 1, W = 0, H = 0;
  function resize(){
    dpr = Math.min(devicePixelRatio || 1, 2);
    var r = cv.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    gl.viewport(0, 0, cv.width, cv.height);
    persp(55 * Math.PI / 180, W / Math.max(1, H), 0.1, 260);
    dirty = true; kick();
  }
  addEventListener('resize', resize, { passive: true });

  var t0 = performance.now(), running = false;
  function frame(now){
    raf = 0;
    if (!running) return;
    place();
    gl.clear(gl.COLOR_BUFFER_BIT);
    /* 瞬きは元はスクロール量で刻んでいた。FV は動かないので実時間で刻む */
    drawEye((now - t0) * 0.001 * 0.9, PRM ? 0 : (now - t0) * 0.001);
    if(!PRM) raf = requestAnimationFrame(frame);
  }

  function start(){ if (running) return; running = true; t0 = performance.now(); kick(); }
  function stop(){ running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  resize();
  /* 画面に入っているあいだだけ回す（FV を通り過ぎたら止める） */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function(es){
      es.forEach(function(e){ e.isIntersecting ? start() : stop(); });
    }, { rootMargin: '10% 0px' }).observe(cv);
  } else start();
  document.addEventListener('visibilitychange', function(){ document.hidden ? stop() : start(); });

  return { start: start, stop: stop, resize: resize };
}
